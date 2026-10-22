CREATE TYPE "BillingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "BillingPeriod" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "startsOn" DATE NOT NULL,
  "endsOn" DATE NOT NULL,
  "status" "BillingPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "closedAt" TIMESTAMPTZ(3),
  "createdById" UUID NOT NULL,
  "closedById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "BillingPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingPeriod_calendar_month" CHECK (
    "startsOn" = date_trunc('month', "startsOn")::date
    AND "endsOn" = ("startsOn" + INTERVAL '1 month - 1 day')::date
  ),
  CONSTRAINT "BillingPeriod_closed_shape" CHECK (
    (status = 'OPEN' AND "closedAt" IS NULL AND "closedById" IS NULL)
    OR (status = 'CLOSED' AND "closedAt" IS NOT NULL AND "closedById" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "BillingPeriod_propertyId_startsOn_key" ON "BillingPeriod"("propertyId", "startsOn");
CREATE INDEX "BillingPeriod_propertyId_status_startsOn_idx" ON "BillingPeriod"("propertyId", "status", "startsOn");
CREATE INDEX "BillingPeriod_createdById_idx" ON "BillingPeriod"("createdById");
CREATE INDEX "BillingPeriod_closedById_idx" ON "BillingPeriod"("closedById");
ALTER TABLE "BillingPeriod" ADD CONSTRAINT "BillingPeriod_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingPeriod" ADD CONSTRAINT "BillingPeriod_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingPeriod" ADD CONSTRAINT "BillingPeriod_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UtilityRate" ADD COLUMN "createdById" UUID;
CREATE INDEX "UtilityRate_createdById_idx" ON "UtilityRate"("createdById");
ALTER TABLE "UtilityRate" ADD CONSTRAINT "UtilityRate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_utility_rate_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Utility rates are append-only';
END;
$$;
CREATE TRIGGER utility_rate_immutable BEFORE UPDATE OR DELETE ON "UtilityRate"
FOR EACH ROW EXECUTE FUNCTION prevent_utility_rate_change();

CREATE FUNCTION prevent_billing_period_reopen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'Closed billing periods are immutable';
  END IF;
  IF NEW."propertyId" <> OLD."propertyId" OR NEW."startsOn" <> OLD."startsOn" OR NEW."endsOn" <> OLD."endsOn" OR NEW."createdById" <> OLD."createdById" THEN
    RAISE EXCEPTION 'Billing period identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_period_transition_guard BEFORE UPDATE ON "BillingPeriod"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_period_reopen();
