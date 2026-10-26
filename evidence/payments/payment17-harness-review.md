# Payment regression harness compatibility

Scope: only the finite-payment integration precondition and this report. No service, financial formula, SQL migration, existing database or fixture protection was changed. Implementation owner: recover_deposit_core; independent review and actual database execution belong to Main.

The finite suite now requires the exact ordered sixteen migration names through payment_finite_amounts. It accepts either that complete baseline or the same baseline followed by the single known phase3e_deposits migration. Unknown counts, replaced baseline names and unknown seventeenth suffixes fail before fixture creation. All financial test cases and isolated database/role attestation remain unchanged.

## Historical fixture setup

Read-only inspection of tests/integration/payments-migration-rehearsal.ts confirms this sequence:

1. Refuse any target where Payment already exists.
2. Deploy the ten migrations preceding invoice lifecycle.
3. Insert synthetic historical Payment and PaymentAllocation rows for PENDING, CONFIRMED and REVERSED, three rows of each with amount123.45 and historical-cheque method.
4. Deploy the three invoice migrations, then capture historical rows, constraints, indexes and status enum values.
5. Deploy the actual full repository migrations, including payment lifecycle, expenses, finite amounts and deposit003 when all seventeen are present.
6. Compare every original Payment column and complete allocation row, require legacyUnmapped=true and no invented managed method/recorder, retain original constraints/indexes/statuses, and write the rehearsal report.

The payment integration legacy case requires exactly those three historical rows and checks exclusion from managed reads and rejection of mutation/deletion/forged reversal. A database migrated completely before fixtures are inserted cannot satisfy that historical precondition. No legacy flag bypass or reset is appropriate.

Main's fixed helper should pin the new target taky_payment_test_2b5214bd52_integrated17_history in both the target map and fixed CREATE DATABASE literal, keeping existing-target refusal and pristine-table checks. Its setup mode should run Node with --import tsx tests/integration/payments-migration-rehearsal.ts instead of directly running migrate deploy. Existing integration mode then retains its seventeen-migration gate and runs the unchanged payment/routes/receipt/finite suites. The previously failed database and logs remain untouched.

## Verification

Changed-file Prettier check and git diff --check passed. No database, service test, migration rehearsal or complete typecheck was executed by this implementation owner. Main must independently review the small gate change and execute the historical rehearsal and payment regression against the new isolated target before acceptance.
