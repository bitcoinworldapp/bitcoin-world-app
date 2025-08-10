;; -------------------------------------------------------------------
;; File: contracts/market.clar
;; Binary YES/NO LMSR market with dynamic b and admin controls
;; -------------------------------------------------------------------

(define-constant market-principal .market)

;; ================= Admin and pause =================================
(define-constant ADMIN 'ST1PSHE32YTEE21FGYEVTA24N681KRGSQM4VF9XZP)

(define-data-var paused bool false)

;; guard: only admin
(define-private (only-admin)
  (begin
    (asserts! (is-eq tx-sender ADMIN) (err u706))
    (ok true)
  )
)

(define-public (pause)
  (begin
    (try! (only-admin))
    (var-set paused true)
    (ok true)
  )
)

(define-public (unpause)
  (begin
    (try! (only-admin))
    (var-set paused false)
    (ok true)
  )
)

;; guard: market must be open and not paused
(define-private (ensure-open)
  (begin
    (asserts! (is-eq (var-get status) "open") (err u100))
    (asserts! (is-eq (var-get paused) false) (err u720))
    (ok true)
  )
)
;; ===================================================================

;; ================= Read-only wrappers for FT balances ===============
(define-read-only (get-yes-supply) (ft-get-supply yes-token))
(define-read-only (get-yes-balance (who principal)) (ft-get-balance yes-token who))
(define-read-only (get-no-supply)  (ft-get-supply no-token))
;; ===================================================================

;; ================= Outcome tokens ==================================
(define-fungible-token yes-token)
(define-fungible-token no-token)
;; ===================================================================

;; ================= Market state ====================================
(define-data-var q-yes   uint           u0)
(define-data-var q-no    uint           u0)
(define-data-var pool    uint           u0)            ;; sBTC held by contract
(define-data-var status  (string-ascii 10) "open")     ;; "open" | "resolved"
(define-data-var outcome (string-ascii 3)  "")         ;; "YES" | "NO"

(define-data-var b uint u0)                             ;; liquidity parameter
(define-data-var initialized bool false)
;; ===================================================================

;; ================= LMSR params and helpers ==========================
;; Fixed-point with SCALE = 1e6
(define-constant SCALE u1000000)
(define-constant SCALE-INT (to-int SCALE))

;; ln(2) scaled: ~693147
(define-constant LN2-SCALED (to-int u693147))

(define-constant i2 (to-int u2))
(define-constant i3 (to-int u3))
(define-constant i6 (to-int u6))

;; exp approx: 1 + x + x^2/2 + x^3/6
(define-private (exp-fixed (x int))
  (let (
    (x2 (/ (* x x) SCALE-INT))
    (x3 (/ (* x2 x) SCALE-INT))
  )
    (+ SCALE-INT (+ x (+ (/ x2 i2) (/ x3 i6))))
  )
)

;; ln approx around 1: ln(1+z) ~ z - z^2/2 + z^3/3
(define-private (ln-fixed (y int))
  (let (
    (z  (- y SCALE-INT))
    (z1 (/ z SCALE-INT))
    (z2 (/ (* z1 z1) SCALE-INT))
    (z3 (/ (* z2 z1) SCALE-INT))
  )
    (+ z1 (- (/ z2 i2)) (/ z3 i3))
  )
)

(define-private (b-int) (to-int (var-get b)))

;; Cost C(qY, qN) = b * ln( exp(qY/b) + exp(qN/b) ), returns int (base units)
(define-private (cost-fn (qY uint) (qN uint))
  (let (
    (B-INT (b-int))
    (qYsc (if (> (var-get b) u0) (/ (* (to-int qY) SCALE-INT) B-INT) 0))
    (qNsc (if (> (var-get b) u0) (/ (* (to-int qN) SCALE-INT) B-INT) 0))
    (term1 (exp-fixed qYsc))
    (term2 (exp-fixed qNsc))
    (sum   (+ term1 term2))
    (lnsum (ln-fixed sum))
  )
    (if (> (var-get b) u0)
        (/ (* B-INT lnsum) SCALE-INT)
        0)
  )
)

;; Incremental cost with cost floor: if amt>0 and diff<=0 then charge 1
(define-private (calculate-cost (qY uint) (qN uint) (amt uint) (yes? bool))
  (let (
    (base (cost-fn qY qN))
    (new  (if yes?
              (cost-fn (+ qY amt) qN)
              (cost-fn qY (+ qN amt))))
    (diff (- new base))
  )
    (if (> (to-int amt) 0)
        (if (> diff 0)
            (let ((u (to-uint diff)))
              (if (> u u0) u u1))
            u1)
        u0)
  )
)

;; Recompute b from pool: b = floor(pool / ln2)
(define-private (recompute-b)
  (let ((p (var-get pool)))
    (if (> p u0)
        (let ((num (* (to-int p) SCALE-INT)))
          (var-set b (to-uint (/ num LN2-SCALED))))
        (var-set b u0))
  )
)
;; ===================================================================

;; ================= Creation and liquidity (admin only) ==============
(define-public (create (initial-liquidity uint))
  (begin
    (try! (only-admin))
    (asserts! (is-eq (var-get initialized) false) (err u700))
    (asserts! (> initial-liquidity u0) (err u701))
    (try! (contract-call? .sbtc transfer initial-liquidity ADMIN market-principal))
    (var-set pool (+ (var-get pool) initial-liquidity))
    (recompute-b)
    (var-set initialized true)
    (ok (var-get b))
  )
)

(define-public (add-liquidity (amount uint))
  (begin
    (try! (only-admin))
    (asserts! (> amount u0) (err u702))
    (try! (contract-call? .sbtc transfer amount ADMIN market-principal))
    (var-set pool (+ (var-get pool) amount))
    (recompute-b)
    (ok (var-get b))
  )
)
;; ===================================================================

;; ================= Buy YES / NO =====================================
(define-public (buy-yes (amount uint))
  (begin
    (try! (ensure-open))
    (asserts! (> (var-get b) u0) (err u703))
    (asserts! (> amount u0) (err u704))
    (let ((cost (calculate-cost (var-get q-yes) (var-get q-no) amount true)))
      (let ((final-cost (if (> cost u0) cost u1)))
        (try! (contract-call? .sbtc transfer final-cost tx-sender market-principal))
        (try! (ft-mint? yes-token amount tx-sender))
        (var-set q-yes (+ (var-get q-yes) amount))
        (var-set pool  (+ (var-get pool)  final-cost))
        (recompute-b)
        (ok amount)
      )
    )
  )
)

(define-public (buy-no (amount uint))
  (begin
    (try! (ensure-open))
    (asserts! (> (var-get b) u0) (err u703))
    (asserts! (> amount u0) (err u704))
    (let ((cost (calculate-cost (var-get q-yes) (var-get q-no) amount false)))
      (let ((final-cost (if (> cost u0) cost u1)))
        (try! (contract-call? .sbtc transfer final-cost tx-sender market-principal))
        (try! (ft-mint? no-token amount tx-sender))
        (var-set q-no (+ (var-get q-no) amount))
        (var-set pool (+ (var-get pool) final-cost))
        (recompute-b)
        (ok amount)
      )
    )
  )
)
;; ===================================================================

;; ================= Resolve (admin only) =============================
(define-public (resolve (result (string-ascii 3)))
  (begin
    (try! (only-admin))
    (asserts! (is-eq (var-get status) "open") (err u102))
    (asserts! (or (is-eq result "YES") (is-eq result "NO")) (err u103))
    (var-set outcome result)
    (var-set status  "resolved")
    (ok true)
  )
)
;; ===================================================================

;; ================= Redeem ===========================================
(define-public (redeem)
  (begin
    (asserts! (is-eq (var-get status) "resolved") (err u104))
    (if (is-eq (var-get outcome) "YES")
        (redeem-yes)
        (redeem-no))
  )
)

(define-private (redeem-yes)
  (let ((balance (ft-get-balance yes-token tx-sender))
        (supply  (ft-get-supply   yes-token)))
    (asserts! (> supply u0) (err u105))
    (let ((payout (/ (* balance (var-get pool)) supply)))
      (asserts! (> payout u0) (err u2))
      (try! (ft-burn? yes-token balance tx-sender))
      (as-contract (try! (contract-call? .sbtc transfer payout market-principal tx-sender)))
      (var-set pool (- (var-get pool) payout))
      (recompute-b)
      (ok payout)
    )
  )
)

(define-private (redeem-no)
  (let ((balance (ft-get-balance no-token tx-sender))
        (supply  (ft-get-supply   no-token)))
    (asserts! (> supply u0) (err u105))
    (let ((payout (/ (* balance (var-get pool)) supply)))
      (asserts! (> payout u0) (err u2))
      (try! (ft-burn? no-token balance tx-sender))
      (as-contract (try! (contract-call? .sbtc transfer payout market-principal tx-sender)))
      (var-set pool (- (var-get pool) payout))
      (recompute-b)
      (ok payout)
    )
  )
)
;; ===================================================================

;; ================= Withdraw surplus (admin only) ====================
;; Allows admin to sweep remaining pool after resolution and after
;; the winner side supply is zero.
(define-public (withdraw-surplus)
  (let (
        (ys  (ft-get-supply yes-token))
        (ns  (ft-get-supply no-token))
        (p   (var-get pool))
       )
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
      (ok true)
    )
  )
)
;; ===================================================================

;; ================= Getters ==========================================
(define-read-only (get-q-yes)   (var-get q-yes))
(define-read-only (get-q-no)    (var-get q-no))
(define-read-only (get-pool)    (var-get pool))
(define-read-only (get-status)  (var-get status))
(define-read-only (get-outcome) (var-get outcome))
(define-read-only (get-b)       (var-get b))
(define-read-only (get-initialized) (var-get initialized))
(define-read-only (get-admin) (some ADMIN))
;; ===================================================================
