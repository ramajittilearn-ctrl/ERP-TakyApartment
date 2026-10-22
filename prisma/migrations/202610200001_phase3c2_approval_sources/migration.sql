-- New approval source metadata; retain already-applied migration history.
-- Existing approvals cannot be assigned a truthful historical lease version.
-- They remain NULL and preview rejects them as unverified instead of backfilling.
ALTER TABLE "BillingConsumptionApproval" ADD COLUMN "leaseVersion" VARCHAR(40);
ALTER TABLE "BillingConsumptionApproval" DROP CONSTRAINT "BillingConsumptionApproval_sourceData_check";
ALTER TABLE "BillingConsumptionApproval" ADD CONSTRAINT "BillingConsumptionApproval_sourceData_check" CHECK (
  jsonb_typeof("sourceData") = 'object' AND "sourceData" ? 'kind'
  AND "sourceData"->>'kind' IN ('ACTUAL', 'ESTIMATE', 'REPLACEMENT')
);
