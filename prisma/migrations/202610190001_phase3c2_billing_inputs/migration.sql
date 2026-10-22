-- Append-only billing approvals. This migration does not alter invoice lifecycle
-- or the existing billing-period close and meter-history contracts.
CREATE TABLE "BillingRateSelection" (
  "id" UUID NOT NULL,
  "billingPeriodId" UUID NOT NULL,
  "kind" "MeterKind" NOT NULL,
  "utilityRateId" UUID NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "reason" VARCHAR(1000) NOT NULL CHECK (length(btrim("reason")) >= 3),
  "approvedById" UUID NOT NULL,
  "approvedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingRateSelection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingRateSelection_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "BillingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingRateSelection_utilityRateId_fkey" FOREIGN KEY ("utilityRateId") REFERENCES "UtilityRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingRateSelection_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BillingRateSelection_billingPeriodId_kind_revision_key" ON "BillingRateSelection"("billingPeriodId", "kind", "revision");
CREATE INDEX "BillingRateSelection_utilityRateId_idx" ON "BillingRateSelection"("utilityRateId");
CREATE INDEX "BillingRateSelection_approvedById_idx" ON "BillingRateSelection"("approvedById");

CREATE TABLE "BillingConsumptionApproval" (
  "id" UUID NOT NULL,
  "billingPeriodId" UUID NOT NULL,
  "leaseId" UUID NOT NULL,
  "kind" "MeterKind" NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "sourceData" JSONB NOT NULL CHECK (jsonb_typeof("sourceData") = 'object' AND "sourceData" ? 'kind' AND "sourceData"->>'kind' IN ('ESTIMATE', 'REPLACEMENT')),
  "approvedById" UUID NOT NULL,
  "approvedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingConsumptionApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingConsumptionApproval_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "BillingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingConsumptionApproval_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingConsumptionApproval_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BillingConsumptionApproval_billingPeriodId_leaseId_kind_revision_key" ON "BillingConsumptionApproval"("billingPeriodId", "leaseId", "kind", "revision");
CREATE INDEX "BillingConsumptionApproval_leaseId_idx" ON "BillingConsumptionApproval"("leaseId");
CREATE INDEX "BillingConsumptionApproval_approvedById_idx" ON "BillingConsumptionApproval"("approvedById");

CREATE FUNCTION guard_billing_approval_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p "BillingPeriod"%ROWTYPE;
  r "UtilityRate"%ROWTYPE;
BEGIN
  SELECT * INTO p FROM "BillingPeriod" WHERE id = NEW."billingPeriodId" FOR UPDATE;
  IF NOT FOUND OR p.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Billing approvals require an open canonical period';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE id = NEW."approvedById" AND role = 'ADMIN' AND NOT disabled) THEN
    RAISE EXCEPTION 'Billing approvals require an active ADMIN';
  END IF;
  IF TG_TABLE_NAME = 'BillingRateSelection' THEN
    SELECT * INTO r FROM "UtilityRate" WHERE id = NEW."utilityRateId";
    IF NOT FOUND OR r."propertyId" <> p."propertyId" OR r.kind <> NEW.kind OR r."effectiveFrom" > p."endsOn" OR EXISTS (
      SELECT 1 FROM "UtilityRate" next_rate WHERE next_rate."propertyId" = r."propertyId" AND next_rate.kind = r.kind
      AND next_rate."effectiveFrom" > r."effectiveFrom" AND next_rate."effectiveFrom" <= p."startsOn"
    ) THEN RAISE EXCEPTION 'Selected rate must match property, utility and overlap the canonical month'; END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM "Lease" l JOIN "Room" room ON room.id = l."roomId" JOIN "Floor" f ON f.id = room."floorId"
      WHERE l.id = NEW."leaseId" AND f."propertyId" = p."propertyId" AND l.status IN ('ACTIVE', 'ENDED')
      AND l."startDate" <= p."endsOn" AND l."endDate" >= p."startsOn"
    ) THEN RAISE EXCEPTION 'Consumption approval must match an occupied lease in this property and period'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION prevent_billing_approval_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Billing approvals are append-only';
END;
$$;
CREATE TRIGGER billing_rate_selection_insert_guard BEFORE INSERT ON "BillingRateSelection" FOR EACH ROW EXECUTE FUNCTION guard_billing_approval_insert();
CREATE TRIGGER billing_consumption_approval_insert_guard BEFORE INSERT ON "BillingConsumptionApproval" FOR EACH ROW EXECUTE FUNCTION guard_billing_approval_insert();
CREATE TRIGGER billing_rate_selection_immutable BEFORE UPDATE OR DELETE ON "BillingRateSelection" FOR EACH ROW EXECUTE FUNCTION prevent_billing_approval_change();
CREATE TRIGGER billing_consumption_approval_immutable BEFORE UPDATE OR DELETE ON "BillingConsumptionApproval" FOR EACH ROW EXECUTE FUNCTION prevent_billing_approval_change();
