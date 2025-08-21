;; -------------------------------------------------------------------
;; File: contracts/market.clar
;; Binary YES/NO LMSR market with admin controls, per-user caps,
;; auto-buy with max-cost (slippage guard), and fee routing.
;; -------------------------------------------------------------------

(define-constant market-principal .market)

;; Ajusta este ADMIN si cambia el deployer:
(define-constant ADMIN 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM)

;; ------------------------- Estado base ------------------------------
(define-data-var paused bool false)
(define-data-var initialized bool false)

;; "open" | "resolved"
(define-data-var status (string-ascii 10) "open")
;; "YES" | "NO" (vacio hasta resolver)
(define-data-var outcome (string-ascii 3) "")

;; Cantidades LMSR
(define-data-var q-yes uint u0)
(define-data-var q-no  uint u0)
(define-data-var pool  uint u0)  ;; sBTC bloqueado en el contrato (colateral LMSR)
(define-data-var b     uint u0)  ;; parametro de liquidez

;; Limite opcional por operacion (0 = sin limite)
(define-data-var max-trade uint u0)

;; ------------------------- Caps & spent -----------------------------
(define-map user-caps  { user: principal } { cap: uint })
(define-map user-spent { user: principal } { spent: uint })

(define-read-only (get-cap (who principal))
  (default-to u0 (get cap (map-get? user-caps { user: who }))))

(define-read-only (get-spent (who principal))
  (default-to u0 (get spent (map-get? user-spent { user: who }))))

;; Cambiamos a bool (no response)
(define-private (bump-cap-if-needed (who principal) (target-cap uint))
  (let ((cur (default-to u0 (get cap (map-get? user-caps { user: who })))))
    (if (> target-cap cur)
        (begin (map-set user-caps { user: who } { cap: target-cap }) true)
        true)))

;; Cambiamos a bool (no response)
(define-private (add-spent (who principal) (delta uint))
  (let ((cur (default-to u0 (get spent (map-get? user-spent { user: who }))))
        (nw  (+ cur delta)))
    (begin (map-set user-spent { user: who } { spent: nw }) true)))

;; ------------------------- Fees ------------------------------------
;; BPS = basis points (1% = 100 bps)
(define-data-var protocol-fee-bps uint u0)  ;; p.ej., 300 = 3%
(define-data-var lp-fee-bps       uint u0)  ;; p.ej., 100 = 1%

;; Split del protocolo: debe sumar 100 (drip+brc+team = 100)
(define-data-var pct-drip uint u50)  ;; 50%
(define-data-var pct-brc  uint u30)  ;; 30%
(define-data-var pct-team uint u20)  ;; 20%

;; Destinatarios (por defecto ADMIN hasta configurar)
(define-data-var DRIP_VAULT principal ADMIN)
(define-data-var BRC20_VAULT principal ADMIN)
(define-data-var TEAM_WALLET principal ADMIN)
(define-data-var LP_WALLET   principal ADMIN)

;; Candado opcional para impedir cambios tras configurar
(define-data-var fees-locked bool false)

(define-private (ceil-div (n uint) (d uint))
  (/ (+ n (- d u1)) d))

(define-private (ceil-bps (amount uint) (bps uint))
  (ceil-div (* amount bps) u10000))

;; ------------------------- Guards ----------------------------------
(define-private (only-admin)
  (begin (asserts! (is-eq tx-sender ADMIN) (err u706)) (ok true)))

;; Devuelve siempre response
(define-private (guard-not-locked)
  (if (is-eq (var-get fees-locked) false)
      (ok true)
      (err u743)))

(define-public (pause)
  (begin (try! (only-admin)) (var-set paused true) (ok true)))

(define-public (unpause)
  (begin (try! (only-admin)) (var-set paused false) (ok true)))

(define-public (set-max-trade (limit uint))
  (begin (try! (only-admin)) (var-set max-trade limit) (ok true)))

(define-public (set-fees (protocol-bps uint) (lp-bps uint))
  (begin
    (try! (only-admin))
    (try! (guard-not-locked))
    (asserts! (<= protocol-bps u10000) (err u740))
    (asserts! (<= lp-bps       u10000) (err u741))
    (var-set protocol-fee-bps protocol-bps)
    (var-set lp-fee-bps       lp-bps)
    (ok true)))

(define-public (set-fee-recipients (drip principal) (brc principal) (team principal) (lp principal))
  (begin
    (try! (only-admin))
    (try! (guard-not-locked))
    (var-set DRIP_VAULT drip)
    (var-set BRC20_VAULT brc)
    (var-set TEAM_WALLET team)
    (var-set LP_WALLET   lp)
    (ok true)))

(define-public (set-protocol-split (pdrip uint) (pbrc uint) (pteam uint))
  (begin
    (try! (only-admin))
    (try! (guard-not-locked))
    (asserts! (is-eq (+ pdrip (+ pbrc pteam)) u100) (err u742))
    (var-set pct-drip pdrip)
    (var-set pct-brc  pbrc)
    (var-set pct-team pteam)
    (ok true)))

(define-public (lock-fees-config)
  (begin (try! (only-admin)) (var-set fees-locked true) (ok true)))

(define-private (ensure-open)
  (begin
    (asserts! (is-eq (var-get status) "open") (err u100))
    (asserts! (is-eq (var-get paused) false)  (err u720))
    (asserts! (is-eq (var-get initialized) true) (err u721))
    (ok true)))

(define-private (check-trade-limit (amount uint))
  (let ((m (var-get max-trade)))
    (if (and (> m u0) (> amount m)) (err u722) (ok true))))

(define-constant ERR-SLIPPAGE (err u732))

;; --------------------- Outcome tokens (YES/NO) ----------------------
(define-fungible-token yes-token)
(define-fungible-token no-token)

;; Read-only wrappers
(define-read-only (get-yes-supply) (ft-get-supply yes-token))
(define-read-only (get-no-supply)  (ft-get-supply no-token))
(define-read-only (get-yes-balance (who principal)) (ft-get-balance yes-token who))

;; --------------------- LMSR helpers (fixed-point) -------------------
(define-constant SCALE u1000000)
(define-constant SCALE-INT (to-int SCALE))
(define-constant LN2-SCALED (to-int u693147)) ;; ~ ln(2)*1e6
(define-constant i2 (to-int u2))
(define-constant i3 (to-int u3))
(define-constant i6 (to-int u6))

;; exp approx: 1 + x + x^2/2 + x^3/6
(define-private (exp-fixed (x int))
  (let ((x2 (/ (* x x) SCALE-INT))
        (x3 (/ (* x2 x) SCALE-INT)))
    (+ SCALE-INT (+ x (+ (/ x2 i2) (/ x3 i6))))))

;; ln approx around 1: ln(1+z) ~ z - z^2/2 + z^3/3
(define-private (ln-fixed (y int))
  (let ((z  (- y SCALE-INT))
        (z1 (/ z SCALE-INT))
        (z2 (/ (* z1 z1) SCALE-INT))
        (z3 (/ (* z2 z1) SCALE-INT)))
    (+ z1 (- (/ z2 i2)) (/ z3 i3))))

(define-private (b-int) (to-int (var-get b)))

;; Cost C(qY, qN) = b * ln( exp(qY/b) + exp(qN/b) )  (int)
(define-private (cost-fn (qY uint) (qN uint))
  (let ((B-INT (b-int))
        (b>0   (> (var-get b) u0))
        (qYsc  (if b>0 (/ (* (to-int qY) SCALE-INT) B-INT) 0))
        (qNsc  (if b>0 (/ (* (to-int qN) SCALE-INT) B-INT) 0))
        (term1 (exp-fixed qYsc))
        (term2 (exp-fixed qNsc))
        (sum   (+ term1 term2))
        (lnsum (ln-fixed sum)))
    (if b>0 (/ (* B-INT lnsum) SCALE-INT) 0)))

;; Incremental cost (floor a 1 si amt>0)
(define-private (calculate-cost (qY uint) (qN uint) (amt uint) (yes? bool))
  (let ((base (cost-fn qY qN))
        (new  (if yes? (cost-fn (+ qY amt) qN) (cost-fn qY (+ qN amt))))
        (diff (- new base)))
    (if (> (to-int amt) 0)
        (if (> diff 0)
            (let ((u (to-uint diff))) (if (> u u0) u u1))
            u1)
        u0)))

;; b = floor(pool / ln2)
(define-private (recompute-b)
  (let ((p (var-get pool)))
    (if (> p u0)
        (let ((num (* (to-int p) SCALE-INT)))
          (var-set b (to-uint (/ num LN2-SCALED))))
        (var-set b u0))))

;; --------------------- Creacion y liquidez --------------------------
(define-public (create (initial-liquidity uint))
  (begin
    (try! (only-admin))
    (asserts! (is-eq (var-get initialized) false) (err u700))
    (asserts! (> initial-liquidity u0) (err u701))
    ;; ADMIN to market
    (try! (contract-call? .sbtc transfer initial-liquidity ADMIN market-principal))
    (var-set pool (+ (var-get pool) initial-liquidity))
    (recompute-b)
    (var-set initialized true)
    (ok (var-get b))))

(define-public (add-liquidity (amount uint))
  (begin
    (try! (only-admin))
    (asserts! (> amount u0) (err u702))
    (try! (contract-call? .sbtc transfer amount ADMIN market-principal))
    (var-set pool (+ (var-get pool) amount))
    (recompute-b)
    (ok (var-get b))))

;; --------------------- Compras (con fees) ---------------------------
(define-public (buy-yes (amount uint))
  (begin
    (try! (ensure-open))
    (try! (check-trade-limit amount))
    (asserts! (> (var-get b) u0) (err u703))
    (asserts! (> amount u0) (err u704))

    (let (
      (c0 (calculate-cost (var-get q-yes) (var-get q-no) amount true))
      (pB (var-get protocol-fee-bps))
      (lB (var-get lp-fee-bps))
    )
      (let (
        (base (if (> c0 u0) c0 u1))
        (feeP (ceil-bps base pB))
        (feeL (ceil-bps base lB))
        (drip (/ (* feeP (var-get pct-drip)) u100))
        (brc  (/ (* feeP (var-get pct-brc))  u100))
        (team (- feeP (+ drip brc)))
        (total (+ base (+ feeP feeL)))
      )
        (let ((cap (get-cap tx-sender)) (spent (get-spent tx-sender)))
          (asserts! (> cap u0) (err u730))
          (asserts! (<= (+ spent total) cap) (err u731))

          (try! (contract-call? .sbtc transfer base tx-sender market-principal))

          ;; protocolo (bool en ambas ramas)
          (if (> feeP u0)
            (begin
              (if (> drip u0) (try! (contract-call? .sbtc transfer drip tx-sender (var-get DRIP_VAULT))) true)
              (if (> brc  u0) (try! (contract-call? .sbtc transfer brc  tx-sender (var-get BRC20_VAULT))) true)
              (if (> team u0) (try! (contract-call? .sbtc transfer team tx-sender (var-get TEAM_WALLET))) true)
              true)
            true)

          ;; LP (bool en ambas ramas)
          (if (> feeL u0)
            (try! (contract-call? .sbtc transfer feeL tx-sender (var-get LP_WALLET)))
            true)

          (try! (ft-mint? yes-token amount tx-sender))
          (var-set q-yes (+ (var-get q-yes) amount))
          (var-set pool  (+ (var-get pool)  base))
          (recompute-b)
          (add-spent tx-sender total)
          (ok amount))))))

(define-public (buy-no (amount uint))
  (begin
    (try! (ensure-open))
    (try! (check-trade-limit amount))
    (asserts! (> (var-get b) u0) (err u703))
    (asserts! (> amount u0) (err u704))

    (let (
      (c0 (calculate-cost (var-get q-yes) (var-get q-no) amount false))
      (pB (var-get protocol-fee-bps))
      (lB (var-get lp-fee-bps))
    )
      (let (
        (base (if (> c0 u0) c0 u1))
        (feeP (ceil-bps base pB))
        (feeL (ceil-bps base lB))
        (drip (/ (* feeP (var-get pct-drip)) u100))
        (brc  (/ (* feeP (var-get pct-brc))  u100))
        (team (- feeP (+ drip brc)))
        (total (+ base (+ feeP feeL)))
      )
        (let ((cap (get-cap tx-sender)) (spent (get-spent tx-sender)))
          (asserts! (> cap u0) (err u730))
          (asserts! (<= (+ spent total) cap) (err u731))

          (try! (contract-call? .sbtc transfer base tx-sender market-principal))

          ;; protocolo
          (if (> feeP u0)
            (begin
              (if (> drip u0) (try! (contract-call? .sbtc transfer drip tx-sender (var-get DRIP_VAULT))) true)
              (if (> brc  u0) (try! (contract-call? .sbtc transfer brc  tx-sender (var-get BRC20_VAULT))) true)
              (if (> team u0) (try! (contract-call? .sbtc transfer team tx-sender (var-get TEAM_WALLET))) true)
              true)
            true)

          ;; LP
          (if (> feeL u0)
            (try! (contract-call? .sbtc transfer feeL tx-sender (var-get LP_WALLET)))
            true)

          (try! (ft-mint? no-token amount tx-sender))
          (var-set q-no  (+ (var-get q-no)  amount))
          (var-set pool  (+ (var-get pool)  base))
          (recompute-b)
          (add-spent tx-sender total)
          (ok amount))))))

;; --------------------- Auto-buy con slippage ------------------------
(define-public (buy-yes-auto (amount uint) (target-cap uint) (max-cost uint))
  (begin
    (try! (ensure-open))
    (try! (check-trade-limit amount))
    (asserts! (> (var-get b) u0) (err u703))
    (asserts! (> amount u0) (err u704))
    (asserts! (> max-cost u0) ERR-SLIPPAGE)
    (bump-cap-if-needed tx-sender target-cap)

    (let (
      (c0 (calculate-cost (var-get q-yes) (var-get q-no) amount true))
      (pB (var-get protocol-fee-bps))
      (lB (var-get lp-fee-bps))
    )
      (let (
        (base (if (> c0 u0) c0 u1))
        (feeP (ceil-bps base pB))
        (feeL (ceil-bps base lB))
        (drip (/ (* feeP (var-get pct-drip)) u100))
        (brc  (/ (* feeP (var-get pct-brc))  u100))
        (team (- feeP (+ drip brc)))
        (total (+ base (+ feeP feeL)))
      )
        (asserts! (<= total max-cost) ERR-SLIPPAGE)

        (let ((cap (get-cap tx-sender)) (spent (get-spent tx-sender)))
          (asserts! (> cap u0) (err u730))
          (asserts! (<= (+ spent total) cap) (err u731))

          (try! (contract-call? .sbtc transfer base tx-sender market-principal))

          ;; protocolo
          (if (> feeP u0)
            (begin
              (if (> drip u0) (try! (contract-call? .sbtc transfer drip tx-sender (var-get DRIP_VAULT))) true)
              (if (> brc  u0) (try! (contract-call? .sbtc transfer brc  tx-sender (var-get BRC20_VAULT))) true)
              (if (> team u0) (try! (contract-call? .sbtc transfer team tx-sender (var-get TEAM_WALLET))) true)
              true)
            true)

          ;; LP
          (if (> feeL u0)
            (try! (contract-call? .sbtc transfer feeL tx-sender (var-get LP_WALLET)))
            true)

          (try! (ft-mint? yes-token amount tx-sender))
          (var-set q-yes (+ (var-get q-yes) amount))
          (var-set pool  (+ (var-get pool)  base))
          (recompute-b)
          (add-spent tx-sender total)
          (ok amount))))))

(define-public (buy-no-auto (amount uint) (target-cap uint) (max-cost uint))
  (begin
    (try! (ensure-open))
    (try! (check-trade-limit amount))
    (asserts! (> (var-get b) u0) (err u703))
    (asserts! (> amount u0) (err u704))
    (asserts! (> max-cost u0) ERR-SLIPPAGE)
    (bump-cap-if-needed tx-sender target-cap)

    (let (
      (c0 (calculate-cost (var-get q-yes) (var-get q-no) amount false))
      (pB (var-get protocol-fee-bps))
      (lB (var-get lp-fee-bps))
    )
      (let (
        (base (if (> c0 u0) c0 u1))
        (feeP (ceil-bps base pB))
        (feeL (ceil-bps base lB))
        (drip (/ (* feeP (var-get pct-drip)) u100))
        (brc  (/ (* feeP (var-get pct-brc))  u100))
        (team (- feeP (+ drip brc)))
        (total (+ base (+ feeP feeL)))
      )
        (asserts! (<= total max-cost) ERR-SLIPPAGE)

        (let ((cap (get-cap tx-sender)) (spent (get-spent tx-sender)))
          (asserts! (> cap u0) (err u730))
          (asserts! (<= (+ spent total) cap) (err u731))

          (try! (contract-call? .sbtc transfer base tx-sender market-principal))

          ;; protocolo
          (if (> feeP u0)
            (begin
              (if (> drip u0) (try! (contract-call? .sbtc transfer drip tx-sender (var-get DRIP_VAULT))) true)
              (if (> brc  u0) (try! (contract-call? .sbtc transfer brc  tx-sender (var-get BRC20_VAULT))) true)
              (if (> team u0) (try! (contract-call? .sbtc transfer team tx-sender (var-get TEAM_WALLET))) true)
              true)
            true)

          ;; LP
          (if (> feeL u0)
            (try! (contract-call? .sbtc transfer feeL tx-sender (var-get LP_WALLET)))
            true)

          (try! (ft-mint? no-token amount tx-sender))
          (var-set q-no  (+ (var-get q-no)  amount))
          (var-set pool  (+ (var-get pool)  base))
          (recompute-b)
          (add-spent tx-sender total)
          (ok amount))))))

;; --------------------- Resolve & Redeem ------------------------------
(define-public (resolve (result (string-ascii 3)))
  (begin
    (try! (only-admin))
    (asserts! (is-eq (var-get status) "open") (err u102))
    (asserts! (or (is-eq result "YES") (is-eq result "NO")) (err u103))
    (var-set outcome result)
    (var-set status  "resolved")
    (ok true)))

(define-public (redeem)
  (begin
    (asserts! (is-eq (var-get status) "resolved") (err u104))
    (if (is-eq (var-get outcome) "YES") (redeem-yes) (redeem-no))))

(define-private (redeem-yes)
  (let ((balance (ft-get-balance yes-token tx-sender))
        (supply  (ft-get-supply   yes-token))
        (p       (var-get pool))
        (rcpt    tx-sender))
    (asserts! (> supply u0) (err u105))
    (let ((is-last (is-eq balance supply))
          (raw     (/ (* balance p) supply))
          (payout  (if is-last p raw)))
      (asserts! (> payout u0) (err u2))
      (try! (ft-burn? yes-token balance tx-sender))
      (as-contract (try! (contract-call? .sbtc transfer payout market-principal rcpt)))
      (var-set pool (- p payout))
      (recompute-b)
      (ok payout))))

(define-private (redeem-no)
  (let ((balance (ft-get-balance no-token tx-sender))
        (supply  (ft-get-supply   no-token))
        (p       (var-get pool))
        (rcpt    tx-sender))
    (asserts! (> supply u0) (err u105))
    (let ((is-last (is-eq balance supply))
          (raw     (/ (* balance p) supply))
          (payout  (if is-last p raw)))
      (asserts! (> payout u0) (err u2))
      (try! (ft-burn? no-token balance tx-sender))
      (as-contract (try! (contract-call? .sbtc transfer payout market-principal rcpt)))
      (var-set pool (- p payout))
      (recompute-b)
      (ok payout))))

;; --------------------- Withdraw surplus (admin) ---------------------
(define-public (withdraw-surplus)
  (let ((ys (ft-get-supply yes-token))
        (ns (ft-get-supply no-token))
        (p  (var-get pool)))
    (begin
      (try! (only-admin))
      (asserts! (is-eq (var-get status) "resolved") (err u707))
      (if (is-eq (var-get outcome) "YES")
          (asserts! (is-eq ys u0) (err u708))
          (asserts! (is-eq ns u0) (err u709)))
      (asserts! (> p u0) (err u710))
      (as-contract (try! (contract-call? .sbtc transfer p market-principal ADMIN)))
      (var-set pool u0)
      (recompute-b)
      (ok true))))

;; --------------------- Quotes (read-only) ---------------------------
(define-read-only (quote-buy-yes (amount uint))
  (let ((c0 (calculate-cost (var-get q-yes) (var-get q-no) amount true))
        (c  (if (> c0 u0) c0 u1))
        (pB (var-get protocol-fee-bps))
        (lB (var-get lp-fee-bps))
        (fP (ceil-bps c pB))
        (fL (ceil-bps c lB))
        (dr (/ (* fP (var-get pct-drip)) u100))
        (br (/ (* fP (var-get pct-brc))  u100))
        (tm (- fP (+ dr br)))
        (tot (+ c (+ fP fL))))
    (ok { cost: c, feeProtocol: fP, feeLP: fL, total: tot, drip: dr, brc20: br, team: tm })))

(define-read-only (quote-buy-no (amount uint))
  (let ((c0 (calculate-cost (var-get q-yes) (var-get q-no) amount false))
        (c  (if (> c0 u0) c0 u1))
        (pB (var-get protocol-fee-bps))
        (lB (var-get lp-fee-bps))
        (fP (ceil-bps c pB))
        (fL (ceil-bps c lB))
        (dr (/ (* fP (var-get pct-drip)) u100))
        (br (/ (* fP (var-get pct-brc))  u100))
        (tm (- fP (+ dr br)))
        (tot (+ c (+ fP fL))))
    (ok { cost: c, feeProtocol: fP, feeLP: fL, total: tot, drip: dr, brc20: br, team: tm })))

;; --------------------- Getters extra --------------------------------
(define-read-only (get-q-yes)   (var-get q-yes))
(define-read-only (get-q-no)    (var-get q-no))
(define-read-only (get-pool)    (var-get pool))
(define-read-only (get-status)  (var-get status))
(define-read-only (get-outcome) (var-get outcome))
(define-read-only (get-b)       (var-get b))
(define-read-only (get-initialized) (var-get initialized))
(define-read-only (get-admin) (some ADMIN))
(define-read-only (get-fee-params)
  { protocolBps: (var-get protocol-fee-bps),
    lpBps:       (var-get lp-fee-bps),
    pctDrip:     (var-get pct-drip),
    pctBrc:      (var-get pct-brc),
    pctTeam:     (var-get pct-team) })
(define-read-only (get-fee-recipients)
  { drip: (var-get DRIP_VAULT), brc20: (var-get BRC20_VAULT),
    team: (var-get TEAM_WALLET), lp: (var-get LP_WALLET),
    locked: (var-get fees-locked) })
