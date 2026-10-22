CREATE TYPE "MeterReadingStatus" AS ENUM ('DRAFT', 'CONFIRMED');
CREATE TYPE "MeterReadingType" AS ENUM ('OPENING', 'NORMAL', 'FINAL');

ALTER TABLE "UtilityMeter"
  ADD COLUMN "activeFrom" DATE,
  ADD COLUMN "activeUntil" DATE;

DROP INDEX "UtilityMeter_roomId_kind_key";
CREATE UNIQUE INDEX "UtilityMeter_roomId_kind_serial_key" ON "UtilityMeter"("roomId", "kind", "serial");
CREATE INDEX "UtilityMeter_roomId_kind_activeFrom_activeUntil_idx" ON "UtilityMeter"("roomId", "kind", "activeFrom", "activeUntil");
CREATE UNIQUE INDEX "UtilityMeter_one_active_per_room_kind" ON "UtilityMeter"("roomId", "kind") WHERE "activeUntil" IS NULL;
ALTER TABLE "UtilityMeter" ADD CONSTRAINT "UtilityMeter_lifecycle" CHECK ("activeUntil" IS NULL OR "activeFrom" IS NULL OR "activeUntil" >= "activeFrom");

ALTER TABLE "MeterReading"
  ADD COLUMN "billingPeriodId" UUID,
  ADD COLUMN "readingDate" DATE,
  ADD COLUMN "consumption" DECIMAL(14,3),
  ADD COLUMN "status" "MeterReadingStatus" NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN "type" "MeterReadingType" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "previousReadingId" UUID,
  ADD COLUMN "confirmedById" UUID,
  ADD COLUMN "confirmedAt" TIMESTAMPTZ(3);

DROP INDEX "MeterReading_meterId_period_key";
CREATE INDEX "MeterReading_meterId_period_idx" ON "MeterReading"("meterId", "period");

UPDATE "MeterReading" r
SET "billingPeriodId" = bp.id,
    "readingDate" = r.period,
    "confirmedById" = r."recordedById",
    "confirmedAt" = r."createdAt"
FROM "UtilityMeter" m
JOIN "Room" room ON room.id = m."roomId"
JOIN "Floor" floor ON floor.id = room."floorId"
JOIN "BillingPeriod" bp ON bp."propertyId" = floor."propertyId"
WHERE r."meterId" = m.id AND bp."startsOn" = r.period;

CREATE UNIQUE INDEX "MeterReading_meterId_billingPeriodId_key" ON "MeterReading"("meterId", "billingPeriodId");
CREATE UNIQUE INDEX "MeterReading_one_opening_per_meter" ON "MeterReading"("meterId") WHERE type = 'OPENING';
CREATE INDEX "MeterReading_billingPeriodId_status_idx" ON "MeterReading"("billingPeriodId", "status");
CREATE INDEX "MeterReading_confirmedById_idx" ON "MeterReading"("confirmedById");
CREATE INDEX "MeterReading_previousReadingId_idx" ON "MeterReading"("previousReadingId");
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "BillingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_previousReadingId_fkey" FOREIGN KEY ("previousReadingId") REFERENCES "MeterReading"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_nonnegative" CHECK (value >= 0 AND (consumption IS NULL OR consumption >= 0));
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_workflow_shape" CHECK (
  "billingPeriodId" IS NULL OR
  ("readingDate" IS NOT NULL AND (
    (status = 'DRAFT' AND "confirmedById" IS NULL AND "confirmedAt" IS NULL) OR
    (status = 'CONFIRMED' AND "confirmedById" IS NOT NULL AND "confirmedAt" IS NOT NULL)
  ))
);

CREATE TABLE "MeterReadingCorrection" (
  "id" UUID NOT NULL,
  "readingId" UUID NOT NULL,
  "oldValue" DECIMAL(14,3) NOT NULL,
  "newValue" DECIMAL(14,3) NOT NULL,
  "oldConsumption" DECIMAL(14,3),
  "newConsumption" DECIMAL(14,3),
  "reason" VARCHAR(1000) NOT NULL,
  "correctedById" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeterReadingCorrection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MeterReadingCorrection_values" CHECK ("oldValue" >= 0 AND "newValue" >= 0 AND length(btrim(reason)) >= 3)
);
CREATE INDEX "MeterReadingCorrection_readingId_createdAt_idx" ON "MeterReadingCorrection"("readingId", "createdAt");
CREATE INDEX "MeterReadingCorrection_correctedById_idx" ON "MeterReadingCorrection"("correctedById");
ALTER TABLE "MeterReadingCorrection" ADD CONSTRAINT "MeterReadingCorrection_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "MeterReading"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeterReadingCorrection" ADD CONSTRAINT "MeterReadingCorrection_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MeterReplacement" (
  "id" UUID NOT NULL,
  "roomId" UUID NOT NULL,
  "kind" "MeterKind" NOT NULL,
  "oldMeterId" UUID NOT NULL,
  "newMeterId" UUID NOT NULL,
  "finalReadingId" UUID NOT NULL,
  "initialReadingId" UUID NOT NULL,
  "replacementDate" DATE NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "replacedById" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeterReplacement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MeterReplacement_distinct_meters" CHECK ("oldMeterId" <> "newMeterId" AND length(btrim(reason)) >= 3)
);
CREATE UNIQUE INDEX "MeterReplacement_oldMeterId_key" ON "MeterReplacement"("oldMeterId");
CREATE UNIQUE INDEX "MeterReplacement_newMeterId_key" ON "MeterReplacement"("newMeterId");
CREATE UNIQUE INDEX "MeterReplacement_finalReadingId_key" ON "MeterReplacement"("finalReadingId");
CREATE UNIQUE INDEX "MeterReplacement_initialReadingId_key" ON "MeterReplacement"("initialReadingId");
CREATE INDEX "MeterReplacement_roomId_kind_replacementDate_idx" ON "MeterReplacement"("roomId", "kind", "replacementDate");
CREATE INDEX "MeterReplacement_replacedById_idx" ON "MeterReplacement"("replacedById");
ALTER TABLE "MeterReplacement" ADD CONSTRAINT "MeterReplacement_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeterReplacement" ADD CONSTRAINT "MeterReplacement_oldMeterId_fkey" FOREIGN KEY ("oldMeterId") REFERENCES "UtilityMeter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeterReplacement" ADD CONSTRAINT "MeterReplacement_newMeterId_fkey" FOREIGN KEY ("newMeterId") REFERENCES "UtilityMeter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeterReplacement" ADD CONSTRAINT "MeterReplacement_finalReadingId_fkey" FOREIGN KEY ("finalReadingId") REFERENCES "MeterReading"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeterReplacement" ADD CONSTRAINT "MeterReplacement_initialReadingId_fkey" FOREIGN KEY ("initialReadingId") REFERENCES "MeterReading"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeterReplacement" ADD CONSTRAINT "MeterReplacement_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_meter_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Meter history is append-only';
END;
$$;
CREATE TRIGGER meter_correction_immutable BEFORE UPDATE OR DELETE ON "MeterReadingCorrection" FOR EACH ROW EXECUTE FUNCTION prevent_meter_history_change();
CREATE TRIGGER meter_replacement_immutable BEFORE UPDATE OR DELETE ON "MeterReplacement" FOR EACH ROW EXECUTE FUNCTION prevent_meter_history_change();

CREATE FUNCTION guard_meter_reading_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Meter readings cannot be deleted'; END IF;
  IF OLD.status = 'CONFIRMED' AND (
    NEW."meterId" <> OLD."meterId" OR NEW.period <> OLD.period OR
    NEW."billingPeriodId" IS DISTINCT FROM OLD."billingPeriodId" OR
    NEW."readingDate" IS DISTINCT FROM OLD."readingDate" OR NEW.type <> OLD.type OR
    NEW."recordedById" <> OLD."recordedById" OR NEW."previousReadingId" IS DISTINCT FROM OLD."previousReadingId" OR
    NEW.status <> OLD.status
  ) THEN RAISE EXCEPTION 'Confirmed reading identity is immutable'; END IF;
  IF OLD.status = 'CONFIRMED' AND (NEW.value IS DISTINCT FROM OLD.value OR NEW.consumption IS DISTINCT FROM OLD.consumption) AND COALESCE(current_setting('taky.meter_correction', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Confirmed reading values require correction history';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER meter_reading_guard BEFORE UPDATE OR DELETE ON "MeterReading" FOR EACH ROW EXECUTE FUNCTION guard_meter_reading_change();
