;; -------------------------------------------------------------------
;; File: contracts/market.clar
;;
;; Binario YES/NO con liquidacion en sBTC
;; -------------------------------------------------------------------

(define-constant market-principal .market)

(define-read-only (get-yes-supply) (ft-get-supply yes-token))
(define-read-only (get-yes-balance (who principal)) (ft-get-balance yes-token who))


;; 1) Tokens de resultado --------------------------------------------
(define-fungible-token yes-token)
(define-fungible-token no-token)

;; 2) Estado del mercado ---------------------------------------------
(define-data-var q-yes   uint           u0)
(define-data-var q-no    uint           u0)
(define-data-var pool    uint           u0)                 ;; sBTC en la pool
(define-data-var status  (string-ascii 10) "open")          ;; "open" | "resolved"
(define-data-var outcome (string-ascii 3)  "")              ;; "YES" | "NO"

;; 3) Precio 1:1 ------------------------------------------------------
(define-private (calculate-cost (qY uint) (qN uint) (amt uint))
  amt)

;; 4) Comprar YES -----------------------------------------------------
(define-public (buy-yes (amount uint))
  (begin
    (asserts! (is-eq (var-get status) "open") (err u100))
    (let ((cost (calculate-cost (var-get q-yes) (var-get q-no) amount)))
      (try! (contract-call? .sbtc transfer cost tx-sender market-principal))
      (try! (ft-mint? yes-token amount tx-sender))
      (var-set q-yes (+ (var-get q-yes) amount))
      (var-set pool  (+ (var-get pool)  cost))
      (ok amount))))

;; 5) Comprar NO ------------------------------------------------------
(define-public (buy-no (amount uint))
  (begin
    (asserts! (is-eq (var-get status) "open") (err u101))
    (let ((cost (calculate-cost (var-get q-yes) (var-get q-no) amount)))
      (try! (contract-call? .sbtc transfer cost tx-sender market-principal))
      (try! (ft-mint? no-token amount tx-sender))
      (var-set q-no (+ (var-get q-no) amount))
      (var-set pool (+ (var-get pool) cost))
      (ok amount))))

;; 6) Resolver --------------------------------------------------------
(define-public (resolve (result (string-ascii 3)))
  (begin
    (asserts! (is-eq (var-get status) "open") (err u102))
    (asserts! (or (is-eq result "YES") (is-eq result "NO")) (err u103))
    (var-set outcome result)
    (var-set status  "resolved")
    (ok true)))

;; 7) Canjear ganadores (pulico) ------------------------------------
(define-public (redeem)
  (begin
    (asserts! (is-eq (var-get status) "resolved") (err u104))
    (if (is-eq (var-get outcome) "YES")
        (redeem-yes)
        (redeem-no))))

;; 8) Helpers privados -----------------------------------------------

(define-private (redeem-yes)
  (let ((balance (ft-get-balance yes-token tx-sender))
        (supply  (ft-get-supply   yes-token)))
    (asserts! (> supply u0) (err u105))
    (let ((payout (/ (* balance (var-get pool)) supply)))
      (asserts! (> payout u0) (err u2))
      (try! (ft-burn? yes-token balance tx-sender))

      (let ((winner tx-sender))
        (as-contract
          (try! (contract-call? .sbtc transfer payout market-principal winner))))

      ;; Descuenta de la pool
      (var-set pool (- (var-get pool) payout))

      (ok payout))))

(define-private (redeem-no)
  (let ((balance (ft-get-balance no-token tx-sender))
        (supply  (ft-get-supply   no-token)))
    (asserts! (> supply u0) (err u105))
    (let ((payout (/ (* balance (var-get pool)) supply)))
      (asserts! (> payout u0) (err u2))
      (try! (ft-burn? no-token balance tx-sender))

      (let ((winner tx-sender))
        (as-contract
          (try! (contract-call? .sbtc transfer payout market-principal winner))))

      (var-set pool (- (var-get pool) payout))

      (ok payout))))

;; 9) Getters ---------------------------------------------------------
(define-read-only (get-q-yes)   (var-get q-yes))
(define-read-only (get-q-no)    (var-get q-no))
(define-read-only (get-pool)    (var-get pool))
(define-read-only (get-status)  (var-get status))
(define-read-only (get-outcome) (var-get outcome))