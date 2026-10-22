BEGIN;
-- DropIndex
DROP INDEX "Invoice_leaseId_period_key";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "billingPeriodId" UUID,
ADD COLUMN     "correctionId" UUID,
ADD COLUMN     "dueProvenance" JSONB,
ADD COLUMN     "finalTotal" DECIMAL(14,2),
ADD COLUMN     "fingerprint" CHAR(64),
ADD COLUMN     "frozenLeaseId" UUID,
ADD COLUMN     "issuedById" UUID,
ADD COLUMN     "notes" VARCHAR(2000) NOT NULL DEFAULT '',
ADD COLUMN     "previousInvoiceId" UUID,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "snapshot" JSONB,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "voidReason" VARCHAR(1000),
ADD COLUMN     "voidedAt" TIMESTAMPTZ(3),
ADD COLUMN     "voidedById" UUID,
ALTER COLUMN "number" DROP NOT NULL,
ALTER COLUMN "dueDate" DROP NOT NULL;

-- CreateTable
CREATE TABLE "BillingPeriodFreeze" (
    "id" UUID NOT NULL,
    "billingPeriodId" UUID NOT NULL,
    "schemaVersion" VARCHAR(20) NOT NULL,
    "closedById" UUID NOT NULL,
    "closedAt" TIMESTAMPTZ(3) NOT NULL,
    "leaseCount" INTEGER NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,

    CONSTRAINT "BillingPeriodFreeze_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingFreezeLease" (
    "id" UUID NOT NULL,
    "freezeId" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "labels" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,

    CONSTRAINT "BillingFreezeLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceCorrection" (
    "id" UUID NOT NULL,
    "originalInvoiceId" UUID NOT NULL,
    "frozenLeaseId" UUID NOT NULL,
    "approvedById" UUID NOT NULL,
    "approvedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(1000) NOT NULL,
    "evidence" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "differences" JSONB NOT NULL,

    CONSTRAINT "InvoiceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceMonthCounter" (
    "month" CHAR(6) NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "InvoiceMonthCounter_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "PropertyDuePolicy" (
    "propertyId" UUID NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "configuredById" UUID NOT NULL,
    "configuredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyDuePolicy_pkey" PRIMARY KEY ("propertyId")
);

-- CreateTable
CREATE TABLE "InvoiceCommand" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "commandKey" VARCHAR(100) NOT NULL,
    "operation" VARCHAR(40) NOT NULL,
    "requestFingerprint" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingPeriodFreeze_billingPeriodId_key" ON "BillingPeriodFreeze"("billingPeriodId");

-- CreateIndex
CREATE INDEX "BillingFreezeLease_leaseId_idx" ON "BillingFreezeLease"("leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingFreezeLease_freezeId_leaseId_key" ON "BillingFreezeLease"("freezeId", "leaseId");

-- CreateIndex
CREATE INDEX "InvoiceCorrection_frozenLeaseId_approvedAt_idx" ON "InvoiceCorrection"("frozenLeaseId", "approvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceCommand_actorId_commandKey_key" ON "InvoiceCommand"("actorId", "commandKey");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_correctionId_key" ON "Invoice"("correctionId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_previousInvoiceId_key" ON "Invoice"("previousInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_billingPeriodId_status_idx" ON "Invoice"("billingPeriodId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_leaseId_billingPeriodId_revision_key" ON "Invoice"("leaseId", "billingPeriodId", "revision");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "BillingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_frozenLeaseId_fkey" FOREIGN KEY ("frozenLeaseId") REFERENCES "BillingFreezeLease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "InvoiceCorrection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_previousInvoiceId_fkey" FOREIGN KEY ("previousInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPeriodFreeze" ADD CONSTRAINT "BillingPeriodFreeze_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "BillingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPeriodFreeze" ADD CONSTRAINT "BillingPeriodFreeze_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingFreezeLease" ADD CONSTRAINT "BillingFreezeLease_freezeId_fkey" FOREIGN KEY ("freezeId") REFERENCES "BillingPeriodFreeze"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingFreezeLease" ADD CONSTRAINT "BillingFreezeLease_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingFreezeLease" ADD CONSTRAINT "BillingFreezeLease_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingFreezeLease" ADD CONSTRAINT "BillingFreezeLease_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCorrection" ADD CONSTRAINT "InvoiceCorrection_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCorrection" ADD CONSTRAINT "InvoiceCorrection_frozenLeaseId_fkey" FOREIGN KEY ("frozenLeaseId") REFERENCES "BillingFreezeLease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCorrection" ADD CONSTRAINT "InvoiceCorrection_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyDuePolicy" ADD CONSTRAINT "PropertyDuePolicy_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyDuePolicy" ADD CONSTRAINT "PropertyDuePolicy_configuredById_fkey" FOREIGN KEY ("configuredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCommand" ADD CONSTRAINT "InvoiceCommand_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceItem" DROP CONSTRAINT "Item_quantity_positive";
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "Item_quantity_nonnegative" CHECK (quantity >= 0);
-- Legacy rows are retained verbatim. Only new managed invoices use freeze provenance.
CREATE UNIQUE INDEX "Invoice_active_lease_period_key" ON "Invoice" ("leaseId", period) WHERE status <> 'VOID';
CREATE UNIQUE INDEX "Invoice_active_canonical_key" ON "Invoice" ("leaseId", "billingPeriodId") WHERE status <> 'VOID' AND "billingPeriodId" IS NOT NULL;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_positive_version" CHECK (version > 0 AND revision > 0);
ALTER TABLE "InvoiceMonthCounter" ADD CONSTRAINT "InvoiceMonthCounter_range" CHECK (month ~ '^[0-9]{4}(0[1-9]|1[0-2])$' AND value BETWEEN 0 AND 9999);
ALTER TABLE "PropertyDuePolicy" ADD CONSTRAINT "PropertyDuePolicy_shape" CHECK ("offsetDays" BETWEEN 0 AND 365 AND version > 0);
ALTER TABLE "BillingPeriodFreeze" ADD CONSTRAINT "BillingPeriodFreeze_count" CHECK ("leaseCount" >= 0 AND "schemaVersion" = '3C-3.1');
-- One-time preservation of numbers already reserved by any legacy status.
INSERT INTO "InvoiceMonthCounter" (month,value)
 SELECT substring(number from 5 for 6), max(substring(number from 12 for 4)::integer)
 FROM "Invoice" WHERE number ~ '^INV-[0-9]{4}(0[1-9]|1[0-2])-[0-9]{4}$' GROUP BY substring(number from 5 for 6);
CREATE FUNCTION invoice_source_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock_shared(73422193); RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['Property','Floor','Room','Tenant','Lease','UtilityRate','UtilityMeter','MeterReading','MeterReadingCorrection','MeterReplacement','BillingRateSelection','BillingConsumptionApproval','BillingPeriod'] LOOP
 EXECUTE format('CREATE TRIGGER invoice_source_gate BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION invoice_source_gate()',t);
 END LOOP;
END $$;
CREATE FUNCTION invoice_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Invoice evidence is append-only' USING ERRCODE='23514';
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['BillingPeriodFreeze','BillingFreezeLease','InvoiceCorrection','InvoiceCommand'] LOOP
 EXECUTE format('CREATE TRIGGER invoice_evidence_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION invoice_append_only()',t);
 END LOOP;
END $$;
CREATE FUNCTION invoice_counter_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (NEW.month<>OLD.month OR NEW.value<>OLD.value+1)) THEN
 RAISE EXCEPTION 'Invoice counters cannot reset, skip, or delete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_counter_monotonic BEFORE UPDATE OR DELETE ON "InvoiceMonthCounter" FOR EACH ROW EXECUTE FUNCTION invoice_counter_guard();
CREATE FUNCTION invoice_admin(actor uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM "User" WHERE id=actor AND role='ADMIN' AND NOT disabled)
$$;
CREATE FUNCTION invoice_freeze_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p "BillingPeriod"%ROWTYPE; l "Lease"%ROWTYPE; f "BillingPeriodFreeze"%ROWTYPE; BEGIN
 IF TG_TABLE_NAME='BillingPeriodFreeze' THEN
 SELECT * INTO p FROM "BillingPeriod" WHERE id=NEW."billingPeriodId" FOR UPDATE;
 IF p.status<>'OPEN' OR NOT invoice_admin(NEW."closedById") THEN RAISE EXCEPTION 'Freeze requires OPEN period and ADMIN' USING ERRCODE='23514'; END IF;
 ELSE
 SELECT * INTO f FROM "BillingPeriodFreeze" WHERE id=NEW."freezeId";
 SELECT * INTO p FROM "BillingPeriod" WHERE id=f."billingPeriodId" FOR UPDATE;
 SELECT * INTO l FROM "Lease" WHERE id=NEW."leaseId";
 IF p.status<>'OPEN' OR l."roomId"<>NEW."roomId" OR l."tenantId"<>NEW."tenantId" OR l.status NOT IN ('ACTIVE','ENDED') OR l."startDate">p."endsOn" OR l."endDate"<p."startsOn" OR NOT EXISTS(SELECT 1 FROM "Room" r JOIN "Floor" fl ON fl.id=r."floorId" WHERE r.id=l."roomId" AND fl."propertyId"=p."propertyId") THEN RAISE EXCEPTION 'Frozen lease scope mismatch' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER invoice_freeze_insert BEFORE INSERT ON "BillingPeriodFreeze" FOR EACH ROW EXECUTE FUNCTION invoice_freeze_guard();
CREATE TRIGGER invoice_freeze_lease_insert BEFORE INSERT ON "BillingFreezeLease" FOR EACH ROW EXECUTE FUNCTION invoice_freeze_guard();
CREATE FUNCTION invoice_close_freeze_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE f "BillingPeriodFreeze"%ROWTYPE; BEGIN
 IF OLD.status='OPEN' AND NEW.status='CLOSED' THEN
 SELECT * INTO f FROM "BillingPeriodFreeze" WHERE "billingPeriodId"=NEW.id;
 IF NOT FOUND OR f."leaseCount"<>(SELECT count(*) FROM "BillingFreezeLease" WHERE "freezeId"=f.id) OR f."closedById" IS DISTINCT FROM NEW."closedById"
 OR EXISTS(SELECT 1 FROM "Lease" l JOIN "Room" r ON r.id=l."roomId" JOIN "Floor" fl ON fl.id=r."floorId" WHERE fl."propertyId"=NEW."propertyId" AND l.status IN ('ACTIVE','ENDED') AND l."startDate"<=NEW."endsOn" AND l."endDate">=NEW."startsOn" AND NOT EXISTS(SELECT 1 FROM "BillingFreezeLease" c WHERE c."freezeId"=f.id AND c."leaseId"=l.id))
 THEN RAISE EXCEPTION 'Validated freeze required before close' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER invoice_close_requires_freeze BEFORE UPDATE ON "BillingPeriod" FOR EACH ROW EXECUTE FUNCTION invoice_close_freeze_guard();
CREATE FUNCTION invoice_policy_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain due policy history through audit' USING ERRCODE='23514'; END IF;
 IF NOT invoice_admin(NEW."configuredById") OR (TG_OP='UPDATE' AND (NEW."propertyId"<>OLD."propertyId" OR NEW.version<>OLD.version+1)) THEN RAISE EXCEPTION 'ADMIN/version required for due policy' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_due_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON "PropertyDuePolicy" FOR EACH ROW EXECUTE FUNCTION invoice_policy_guard();
CREATE FUNCTION invoice_correction_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE i "Invoice"%ROWTYPE; BEGIN
 SELECT * INTO i FROM "Invoice" WHERE id=NEW."originalInvoiceId" FOR UPDATE;
 IF i.status<>'ISSUED' OR i."frozenLeaseId" IS DISTINCT FROM NEW."frozenLeaseId" OR NOT invoice_admin(NEW."approvedById") OR length(trim(NEW.reason))=0 OR jsonb_typeof(NEW.evidence)<>'array' OR jsonb_array_length(NEW.evidence)<1 THEN RAISE EXCEPTION 'Invalid invoice correction approval' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_correction_insert BEFORE INSERT ON "InvoiceCorrection" FOR EACH ROW EXECUTE FUNCTION invoice_correction_guard();
CREATE FUNCTION invoice_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p "BillingPeriod"%ROWTYPE; f "BillingFreezeLease"%ROWTYPE; prev "Invoice"%ROWTYPE; c "InvoiceCorrection"%ROWTYPE; BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Invoice history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
 IF OLD."billingPeriodId" IS NULL OR OLD.status='VOID' THEN RAISE EXCEPTION 'Legacy and VOID invoices are immutable' USING ERRCODE='23514'; END IF;
 IF NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW."leaseId"<>OLD."leaseId" OR NEW.period<>OLD.period OR NEW."billingPeriodId" IS DISTINCT FROM OLD."billingPeriodId" OR NEW."frozenLeaseId" IS DISTINCT FROM OLD."frozenLeaseId" OR NEW."previousInvoiceId" IS DISTINCT FROM OLD."previousInvoiceId" OR NEW."correctionId" IS DISTINCT FROM OLD."correctionId" OR NEW.revision<>OLD.revision THEN RAISE EXCEPTION 'Invoice identity/version immutable' USING ERRCODE='23514'; END IF;
 IF OLD.status='ISSUED' THEN
 IF NEW.status<>'VOID' OR (to_jsonb(NEW)-ARRAY['status','version','updatedAt','voidedById','voidedAt','voidReason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updatedAt','voidedById','voidedAt','voidReason']) THEN RAISE EXCEPTION 'Issued financial content immutable' USING ERRCODE='23514'; END IF;
 ELSIF NEW.status NOT IN ('DRAFT','ISSUED') THEN RAISE EXCEPTION 'Invalid draft transition' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."billingPeriodId" IS NULL THEN RAISE EXCEPTION 'New legacy invoice mapping forbidden' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM "BillingPeriod" WHERE id=NEW."billingPeriodId" FOR UPDATE;
 SELECT * INTO f FROM "BillingFreezeLease" WHERE id=NEW."frozenLeaseId";
 IF p.id IS NULL OR f.id IS NULL OR p.status<>'CLOSED' OR p."startsOn"<>NEW.period OR f."leaseId"<>NEW."leaseId" OR NOT EXISTS(SELECT 1 FROM "BillingPeriodFreeze" WHERE id=f."freezeId" AND "billingPeriodId"=p.id) OR NEW.snapshot IS NULL OR NEW.fingerprint IS NULL OR NEW."finalTotal" IS NULL OR NEW."finalTotal"<0 THEN RAISE EXCEPTION 'Managed invoice requires valid frozen snapshot' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "Invoice" WHERE "leaseId"=NEW."leaseId" AND period=NEW.period AND "billingPeriodId" IS NULL) THEN RAISE EXCEPTION 'Legacy invoice mapping required' USING ERRCODE='23514'; END IF;
 IF NEW."correctionId" IS NULL THEN
 IF NEW.snapshot IS DISTINCT FROM f.snapshot OR NEW.fingerprint IS DISTINCT FROM f.fingerprint OR NEW."finalTotal" IS DISTINCT FROM (f.snapshot#>>'{totals,finalTotal}')::numeric THEN RAISE EXCEPTION 'Invoice financial payload must match frozen source' USING ERRCODE='23514'; END IF;
 ELSE
 SELECT * INTO c FROM "InvoiceCorrection" WHERE id=NEW."correctionId";
 IF c.id IS NULL OR NEW.snapshot IS DISTINCT FROM c.snapshot OR NEW.fingerprint IS DISTINCT FROM c.fingerprint OR NEW."finalTotal" IS DISTINCT FROM (c.snapshot#>>'{totals,finalTotal}')::numeric THEN RAISE EXCEPTION 'Invoice financial payload must match approved correction' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='DRAFT' AND (NEW.number IS NOT NULL OR NEW."issuedAt" IS NOT NULL OR NEW."issuedById" IS NOT NULL OR NEW."voidedAt" IS NOT NULL) THEN RAISE EXCEPTION 'Invalid draft shape' USING ERRCODE='23514'; END IF;
 IF NEW.status IN ('ISSUED','VOID') AND (NEW.number IS NULL OR NEW.number !~ ('^INV-'||to_char(p."startsOn",'YYYYMM')||'-[0-9]{4}$') OR NEW."dueDate" IS NULL OR NEW."dueProvenance" IS NULL OR NEW."issuedAt" IS NULL OR NEW."issuedById" IS NULL OR ((TG_OP='INSERT' OR OLD.status='DRAFT') AND NOT invoice_admin(NEW."issuedById"))) THEN RAISE EXCEPTION 'Invalid issuance shape' USING ERRCODE='23514'; END IF;
 IF NEW.status='VOID' AND (NEW."voidedAt" IS NULL OR NOT invoice_admin(NEW."voidedById") OR coalesce(length(trim(NEW."voidReason")),0)=0) THEN RAISE EXCEPTION 'Invalid void shape' USING ERRCODE='23514'; END IF;
 IF NEW."previousInvoiceId" IS NOT NULL THEN
 SELECT * INTO prev FROM "Invoice" WHERE id=NEW."previousInvoiceId";
 SELECT * INTO c FROM "InvoiceCorrection" WHERE id=NEW."correctionId";
 IF NEW."correctionId" IS NULL OR c.id IS NULL OR prev.id IS NULL OR prev.status IS DISTINCT FROM 'VOID' OR prev."leaseId" IS DISTINCT FROM NEW."leaseId" OR prev."billingPeriodId" IS DISTINCT FROM NEW."billingPeriodId" OR NEW.revision IS DISTINCT FROM prev.revision+1 OR c."originalInvoiceId" IS DISTINCT FROM prev.id OR c."frozenLeaseId" IS DISTINCT FROM f.id OR NEW.fingerprint IS DISTINCT FROM c.fingerprint THEN RAISE EXCEPTION 'Invalid invoice revision chain' USING ERRCODE='23514'; END IF;
 ELSIF NEW.revision<>1 OR NEW."correctionId" IS NOT NULL THEN RAISE EXCEPTION 'Invalid initial revision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION invoice_row_guard();
CREATE FUNCTION invoice_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE i "Invoice"%ROWTYPE; BEGIN
 SELECT * INTO i FROM "Invoice" WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD."invoiceId" ELSE NEW."invoiceId" END FOR UPDATE;
 IF i."billingPeriodId" IS NULL OR i.status<>'DRAFT' THEN RAISE EXCEPTION 'Historical invoice items immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW."invoiceId"<>OLD."invoiceId" THEN RAISE EXCEPTION 'Invoice item cannot move' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER invoice_item_immutable BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceItem" FOR EACH ROW EXECUTE FUNCTION invoice_item_guard();
COMMIT;
