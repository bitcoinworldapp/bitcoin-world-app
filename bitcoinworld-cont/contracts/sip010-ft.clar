;; File: contracts/sip010-ft.clar
(define-constant err-owner-only (err u100))

(define-constant contract-owner tx-sender)          ;; deployer = owner

;; SIP-010 trait, minus `burn`
(define-trait sip010-ft
  (
    ;; Read-only getters
    (get-balance (principal)             (response uint uint))
    (get-supply  ()                      (response uint uint))

    ;; State-changing ops
    (transfer    (uint principal principal) (response bool uint))
    (mint        (uint principal)           (response bool uint))
    (burn     (uint)                     (response bool uint)) 

  )
)
