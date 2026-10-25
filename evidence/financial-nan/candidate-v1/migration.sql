-- Reject non-finite payment storage without changing historical financial data.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Payment" WHERE NOT "legacyUnmapped" AND amount = 'NaN'::numeric) THEN
    RAISE EXCEPTION 'Managed Payment contains non-finite amounts; audited reconciliation required before migration'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "PaymentAllocation" WHERE amount = 'NaN'::numeric) THEN
    RAISE EXCEPTION 'PaymentAllocation contains non-finite amounts; audited reconciliation required before migration'
      USING ERRCODE = '23514';
  END IF;
END $$;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_managed_amount_finite"
  CHECK ("legacyUnmapped" OR amount <> 'NaN'::numeric);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "Allocation_amount_finite"
  CHECK (amount <> 'NaN'::numeric);
COMMIT;
