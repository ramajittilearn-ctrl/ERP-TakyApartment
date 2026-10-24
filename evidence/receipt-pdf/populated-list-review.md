# Populated payment-list receipt acceptance

Main independently reviewed the receipt test correction and preserved the preceding integrated failure. In run 9dd280a08ff74e199d8e303d, captured actual GET /api/v1/payments/?offset=0&limit=50 responses contained fifty rows without the STAFF/cancellation target references. The test incorrectly assumed every new receipt was on that unfiltered page.

The correction uses the existing labelled lease selector before opening the target record. ADMIN coverage creates fifty-one newer pending payments on a different synthetic lease, verifies through the actual API that the target is absent from the first fifty, then drives the real UI filter and native PDF actions. No financial API mock, timeout, retry, environment guard or application change was added. Main inspected the complete diff independently of the implementation owner.

Main executed fresh strict isolated run 1285e1a7723d49c28a441bd5. All three cases passed, with no retries or skips, in 17.9 seconds. Raw evidence is evidence/remediation/1285e1a7723d49c28a441bd5-browser.log and its execution metadata. Cleanup exited 0 and retained the owned volume. This closes the populated-list test assumption. It does not claim to fix the separate earlier login/transaction timeouts or establish a full integrated-suite pass. Previously accepted renderer and inspected downloads remain unchanged.
