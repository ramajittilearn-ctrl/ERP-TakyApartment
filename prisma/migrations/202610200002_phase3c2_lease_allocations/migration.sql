-- Owner approved explicit ADMIN per-lease allocation with supporting evidence.
-- Keep every prior approval/migration intact and do not backfill financial data.
BEGIN;
ALTER TABLE "BillingConsumptionApproval" DROP CONSTRAINT "BillingConsumptionApproval_sourceData_check";
ALTER TABLE "BillingConsumptionApproval" ADD CONSTRAINT "BillingConsumptionApproval_sourceData_check" CHECK (
  jsonb_typeof("sourceData") = 'object'
  AND "sourceData"->>'kind' IS NOT NULL
  AND "sourceData"->>'kind' IN ('ACTUAL', 'ALLOCATED_ACTUAL', 'ESTIMATE', 'REPLACEMENT')
);
COMMIT;
