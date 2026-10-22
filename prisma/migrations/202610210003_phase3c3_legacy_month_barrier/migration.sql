BEGIN;
-- Retained legacy invoices may use any date in the billing month. Preserve them
-- unchanged and require explicit mapping before any managed invoice for that month.
CREATE OR REPLACE FUNCTION invoice_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p "BillingPeriod"%ROWTYPE; f "BillingFreezeLease"%ROWTYPE; prev "Invoice"%ROWTYPE; c "InvoiceCorrection"%ROWTYPE; BEGIN
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
 IF EXISTS(SELECT 1 FROM "Invoice" WHERE "leaseId"=NEW."leaseId" AND period >= p."startsOn" AND period <= p."endsOn" AND "billingPeriodId" IS NULL) THEN RAISE EXCEPTION 'Legacy invoice mapping required' USING ERRCODE='23514'; END IF;
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
COMMIT;
