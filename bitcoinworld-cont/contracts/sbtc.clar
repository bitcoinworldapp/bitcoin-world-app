;; ------------------------------------------------------------
;; sBTCminimal SIP-010 fungible-token implementation
;; ------------------------------------------------------------

;; Import and implement the SIP-010 trait
(use-trait sip010-ft .sip010-ft.sip010-ft)
(impl-trait  .sip010-ft.sip010-ft)

;; Error and owner constants
(define-constant err-owner-only (err u100))
(define-constant contract-owner tx-sender)          ;; deployer = owner

;; The token
(define-fungible-token sbtc)

;; ------------------------------------------------------------
;; Trait-required public entry points
;; ------------------------------------------------------------
(define-public (transfer (amount uint) (sender principal) (recipient principal))
  (begin
    ;; permitimos transferencias firmadas por el propietario original
    ;; o por el contrato `market`
    (asserts! (or
                 (is-eq sender tx-sender)
                 (is-eq tx-sender .market))   ;; aqu .market es market-principal
              err-owner-only)
    (ft-transfer? sbtc amount sender recipient)))

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (ft-mint? sbtc amount recipient)))                 ;; (response bool uint)

(define-public (burn (amount uint))
  (ft-burn? sbtc amount tx-sender))                    ;; (response bool uint)

;; ------------------------------------------------------------
;; Read-only helpers (also required by the trait)
;; ------------------------------------------------------------
(define-read-only (get-balance (who principal))
  (ok (ft-get-balance sbtc who)))                      ;; (response uint uint)

(define-read-only (get-supply)
  (ok (ft-get-supply sbtc)))                           ;; (response uint uint)
