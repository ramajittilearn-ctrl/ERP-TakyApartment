-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cancelReason" VARCHAR(1000),
ADD COLUMN     "cancelledAt" TIMESTAMPTZ(3),
ADD COLUMN     "cancelledById" UUID,
ADD COLUMN     "confirmedAt" TIMESTAMPTZ(3),
ADD COLUMN     "confirmedById" UUID,
ADD COLUMN     "externalReference" VARCHAR(120),
ADD COLUMN     "legacyUnmapped" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "methodCode" "PaymentMethod",
ADD COLUMN     "receivingAccountKey" VARCHAR(80),
ADD COLUMN     "recordedById" UUID,
ADD COLUMN     "reversedAt" TIMESTAMPTZ(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "PaymentReversal" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "paymentId" UUID NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "issuedById" UUID NOT NULL,
    "snapshotVersion" VARCHAR(20) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptCancellation" (
    "id" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "reversalId" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentCommand" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "commandKey" VARCHAR(100) NOT NULL,
    "operation" VARCHAR(40) NOT NULL,
    "requestFingerprint" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptMonthCounter" (
    "month" CHAR(6) NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "ReceiptMonthCounter_pkey" PRIMARY KEY ("month")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReversal_paymentId_key" ON "PaymentReversal"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_number_key" ON "Receipt"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptCancellation_receiptId_key" ON "ReceiptCancellation"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptCancellation_reversalId_key" ON "ReceiptCancellation"("reversalId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCommand_actorId_commandKey_key" ON "PaymentCommand"("actorId", "commandKey");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReversal" ADD CONSTRAINT "PaymentReversal_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReversal" ADD CONSTRAINT "PaymentReversal_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptCancellation" ADD CONSTRAINT "ReceiptCancellation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptCancellation" ADD CONSTRAINT "ReceiptCancellation_reversalId_fkey" FOREIGN KEY ("reversalId") REFERENCES "PaymentReversal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptCancellation" ADD CONSTRAINT "ReceiptCancellation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCommand" ADD CONSTRAINT "PaymentCommand_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing rows retain legacyUnmapped=true; no historical value is rewritten.
CREATE UNIQUE INDEX "Payment_active_bank_reference" ON "Payment" ("receivingAccountKey", "externalReference") WHERE NOT "legacyUnmapped" AND "methodCode"='BANK_TRANSFER' AND status IN ('PENDING','CONFIRMED');
ALTER TABLE "ReceiptMonthCounter" ADD CONSTRAINT "ReceiptMonthCounter_range" CHECK (month ~ '^[0-9]{4}(0[1-9]|1[0-2])$' AND value BETWEEN 1 AND 9999);
CREATE FUNCTION payment_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed text[]; BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW."legacyUnmapped" OR NEW."isDemo" OR NEW.status<>'PENDING' OR NEW.version<>1 OR NEW."methodCode" IS NULL OR NEW.method IS DISTINCT FROM NEW."methodCode"::text OR NEW.amount<=0 OR NEW."confirmedAt" IS NOT NULL OR NEW."confirmedById" IS NOT NULL OR NEW."reversedAt" IS NOT NULL OR NEW."cancelledAt" IS NOT NULL OR NEW."cancelledById" IS NOT NULL OR NEW."cancelReason" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."recordedById" AND NOT disabled AND role IN ('ADMIN','STAFF')) OR NOT EXISTS(SELECT 1 FROM "Lease" l JOIN "Tenant" t ON t.id=l."tenantId" WHERE l.id=NEW."leaseId" AND NOT l."isDemo" AND NOT t."isDemo") THEN RAISE EXCEPTION 'Invalid managed pending payment' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD."legacyUnmapped" OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Legacy payment or invalid version' USING ERRCODE='23514'; END IF;
  IF OLD.status='PENDING' AND NEW.status='CONFIRMED' THEN
   allowed=ARRAY['status','version','updatedAt','confirmedById','confirmedAt'];
   IF NEW."confirmedAt" IS NULL OR NOT invoice_admin(NEW."confirmedById") THEN RAISE EXCEPTION 'Admin confirmation required' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status='PENDING' AND NEW.status='CANCELLED' THEN
   allowed=ARRAY['status','version','updatedAt','cancelledById','cancelledAt','cancelReason'];
   IF NEW."cancelledAt" IS NULL OR NOT invoice_admin(NEW."cancelledById") OR coalesce(length(trim(NEW."cancelReason")),0)=0 THEN RAISE EXCEPTION 'Admin cancellation required' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status='CONFIRMED' AND NEW.status='REVERSED' THEN
   allowed=ARRAY['status','version','updatedAt','reversedAt'];
   IF NEW."reversedAt" IS NULL THEN RAISE EXCEPTION 'Reversal timestamp required' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Illegal payment transition' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-allowed) IS DISTINCT FROM (to_jsonb(OLD)-allowed) THEN RAISE EXCEPTION 'Immutable payment fields changed' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."methodCode"='CASH' AND (NEW."externalReference" IS NOT NULL OR NEW."receivingAccountKey" IS NOT NULL) OR NEW."methodCode"='BANK_TRANSFER' AND (coalesce(length(trim(NEW."externalReference")),0)=0 OR coalesce(length(trim(NEW."receivingAccountKey")),0)=0 OR NEW."externalReference"<>trim(NEW."externalReference") OR NEW."receivingAccountKey"<>trim(NEW."receivingAccountKey")) THEN RAISE EXCEPTION 'Invalid bank identity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_guard BEFORE INSERT OR UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION payment_row_guard();
CREATE FUNCTION payment_canonical_json(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result text; BEGIN
 CASE jsonb_typeof(value)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||payment_canonical_json(val),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(value) AS e(key,val);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(payment_canonical_json(val),',' ORDER BY ordinal),'')||']' INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS e(val,ordinal);
 ELSE result=value::text;
 END CASE;
 RETURN result;
END $$;
CREATE FUNCTION payment_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid uuid; p "Payment"%ROWTYPE; i "Invoice"%ROWTYPE; BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Payment child history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='ReceiptCancellation' THEN
  SELECT "paymentId" INTO pid FROM "Receipt" WHERE id=NEW."receiptId";
 ELSE pid=NEW."paymentId"; END IF;
 SELECT * INTO p FROM "Payment" WHERE id=pid FOR UPDATE;
 IF p.id IS NULL OR p."legacyUnmapped" OR p."isDemo" THEN RAISE EXCEPTION 'Managed payment required' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='PaymentAllocation' THEN
  SELECT * INTO i FROM "Invoice" WHERE id=NEW."invoiceId" FOR UPDATE;
  IF p.status NOT IN ('PENDING','CONFIRMED') OR NEW.amount<=0 OR i.id IS NULL OR i.status<>'ISSUED' OR i."billingPeriodId" IS NULL OR i."isDemo" OR i."leaseId"<>p."leaseId" OR i.snapshot IS NULL OR i.fingerprint IS NULL OR i."finalTotal" IS NULL OR i."finalTotal" IS DISTINCT FROM (i.snapshot#>>'{totals,finalTotal}')::numeric OR EXISTS(SELECT 1 FROM "PaymentAllocation" a JOIN "Payment" x ON x.id=a."paymentId" WHERE a."invoiceId"=i.id AND x."legacyUnmapped") THEN RAISE EXCEPTION 'Invoice not payable or legacy mapping required' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='Receipt' THEN
  IF p.status NOT IN ('PENDING','CONFIRMED') OR NOT invoice_admin(NEW."issuedById") OR NEW."snapshotVersion"<>'receipt.v1' OR NEW.fingerprint !~ '^[0-9a-f]{64}$' OR NEW.number !~ '^REC-[0-9]{6}-[0-9]{4}$' OR NEW.snapshot->>'paymentId' IS DISTINCT FROM p.id::text OR NEW.snapshot->>'number' IS DISTINCT FROM NEW.number OR NEW.snapshot->>'amount' IS DISTINCT FROM to_char(p.amount,'FM999999999999990.00') OR NEW.snapshot#>>'{issuedBy,name}' IS DISTINCT FROM (SELECT name FROM "User" WHERE id=NEW."issuedById") OR NEW.number !~ ('^REC-'||to_char(NEW."issuedAt" AT TIME ZONE 'Asia/Bangkok','YYYYMM')||'-[0-9]{4}$') OR substring(NEW.number FROM 12 FOR 4)::int NOT BETWEEN 1 AND 9999 OR NOT EXISTS(SELECT 1 FROM "ReceiptMonthCounter" c WHERE c.month=substring(NEW.number FROM 5 FOR 6) AND c.value>=substring(NEW.number FROM 12 FOR 4)::int) THEN RAISE EXCEPTION 'Invalid receipt' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='PaymentReversal' THEN
  IF p.status NOT IN ('CONFIRMED','REVERSED') OR NOT invoice_admin(NEW."actorId") OR length(trim(NEW.reason))=0 THEN RAISE EXCEPTION 'Invalid reversal' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='ReceiptCancellation' THEN
  IF p.status NOT IN ('CONFIRMED','REVERSED') OR NOT invoice_admin(NEW."actorId") OR length(trim(NEW.reason))=0 OR NOT EXISTS(SELECT 1 FROM "PaymentReversal" r WHERE r.id=NEW."reversalId" AND r."paymentId"=pid AND r."actorId"=NEW."actorId" AND r.reason=NEW.reason) THEN RAISE EXCEPTION 'Invalid receipt cancellation' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['PaymentAllocation','Receipt','PaymentReversal','ReceiptCancellation'] LOOP
 EXECUTE format('CREATE TRIGGER payment_child_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION payment_child_guard()',t);
END LOOP; END $$;
CREATE FUNCTION payment_validate(pid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_payment "Payment"%ROWTYPE; v_invoice "Invoice"%ROWTYPE; receipts int; reversals int; cancellations int; allocated numeric; paid numeric; v_receipt "Receipt"%ROWTYPE; expected_invoices jsonb; expected_snapshot jsonb; BEGIN
 SELECT * INTO v_payment FROM "Payment" WHERE id=pid;
 IF v_payment.id IS NULL OR v_payment."legacyUnmapped" THEN RETURN; END IF;
 -- Locks are required here even for callers bypassing transaction services.
 FOR v_invoice IN SELECT inv.* FROM "Invoice" inv JOIN "PaymentAllocation" a ON a."invoiceId"=inv.id WHERE a."paymentId"=pid ORDER BY inv.id FOR UPDATE OF inv LOOP
  SELECT coalesce(sum(a.amount),0) INTO paid FROM "PaymentAllocation" a JOIN "Payment" x ON x.id=a."paymentId" WHERE a."invoiceId"=v_invoice.id AND NOT x."legacyUnmapped" AND NOT x."isDemo" AND x.status='CONFIRMED';
  IF paid>coalesce(v_invoice."finalTotal",0) OR (paid>0 AND v_invoice.status<>'ISSUED') THEN RAISE EXCEPTION 'Active payments exceed payable invoice' USING ERRCODE='23514'; END IF;
 END LOOP;
 SELECT count(*) INTO receipts FROM "Receipt" WHERE "paymentId"=pid;
 SELECT count(*) INTO reversals FROM "PaymentReversal" WHERE "paymentId"=pid;
 SELECT count(*) INTO cancellations FROM "ReceiptCancellation" c JOIN "Receipt" r ON r.id=c."receiptId" JOIN "PaymentReversal" v ON v.id=c."reversalId" AND v."paymentId"=r."paymentId" WHERE r."paymentId"=pid;
 SELECT coalesce(sum(amount),0) INTO allocated FROM "PaymentAllocation" WHERE "paymentId"=pid;
 IF v_payment.status IN ('PENDING','CANCELLED') THEN
  IF receipts<>0 OR reversals<>0 OR cancellations<>0 OR allocated<>0 THEN RAISE EXCEPTION 'Pending/cancelled payment has financial children' USING ERRCODE='23514'; END IF;
 ELSIF v_payment.status IN ('CONFIRMED','REVERSED') THEN
  SELECT * INTO v_receipt FROM "Receipt" WHERE "paymentId"=pid;
  SELECT jsonb_agg(jsonb_build_object('invoiceId',i.id,'number',i.number,'frozenLeaseId',f.id,'frozenTenantId',f."tenantId",'labels',f.labels,'finalTotal',to_char(i."finalTotal",'FM999999999999990.00'),'allocatedAmount',to_char(a.amount,'FM999999999999990.00')) ORDER BY i.id) INTO expected_invoices FROM "PaymentAllocation" a JOIN "Invoice" i ON i.id=a."invoiceId" JOIN "BillingFreezeLease" f ON f.id=i."frozenLeaseId" WHERE a."paymentId"=pid;
  expected_snapshot=jsonb_build_object('schemaVersion','receipt.v1','paymentId',v_payment.id,'reference',v_payment.reference,'amount',to_char(v_payment.amount,'FM999999999999990.00'),'method',v_payment."methodCode",'receivedAt',to_char(v_payment."receivedAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'externalReference',v_payment."externalReference",'issuedAt',to_char(v_receipt."issuedAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'issuedBy',jsonb_build_object('id',v_receipt."issuedById",'name',v_receipt.snapshot#>>'{issuedBy,name}'),'number',v_receipt.number,'invoices',expected_invoices);
  IF v_receipt."issuedById" IS DISTINCT FROM v_payment."confirmedById" OR v_receipt."issuedAt" IS DISTINCT FROM v_payment."confirmedAt" OR v_receipt.snapshot IS DISTINCT FROM expected_snapshot OR v_receipt.fingerprint IS DISTINCT FROM encode(sha256(convert_to(payment_canonical_json(v_receipt.snapshot),'UTF8')),'hex') THEN RAISE EXCEPTION 'Receipt snapshot does not match immutable payment allocation evidence' USING ERRCODE='23514'; END IF;
  IF receipts<>1 OR allocated<>v_payment.amount OR (v_payment.status='CONFIRMED' AND (reversals<>0 OR cancellations<>0)) OR (v_payment.status='REVERSED' AND (reversals<>1 OR cancellations<>1)) THEN RAISE EXCEPTION 'Incomplete payment lifecycle' USING ERRCODE='23514'; END IF;
 END IF;
END $$;
CREATE FUNCTION payment_final_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE pid uuid; BEGIN
 IF TG_TABLE_NAME='Payment' THEN pid=NEW.id;
 ELSIF TG_TABLE_NAME='ReceiptCancellation' THEN SELECT "paymentId" INTO pid FROM "Receipt" WHERE id=NEW."receiptId";
 ELSE pid=NEW."paymentId"; END IF;
 PERFORM payment_validate(pid); RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['Payment','PaymentAllocation','Receipt','PaymentReversal','ReceiptCancellation'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER payment_final_guard AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payment_final_guard()',t);
END LOOP; END $$;
CREATE FUNCTION invoice_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.status='VOID' AND OLD.status IS DISTINCT FROM NEW.status AND EXISTS(SELECT 1 FROM "PaymentAllocation" a JOIN "Payment" p ON p.id=a."paymentId" WHERE a."invoiceId"=NEW.id AND p.status='CONFIRMED') THEN RAISE EXCEPTION 'Invoice has active payments' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_payment_guard BEFORE UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION invoice_payment_guard();
CREATE TRIGGER payment_command_immutable BEFORE UPDATE OR DELETE ON "PaymentCommand" FOR EACH ROW EXECUTE FUNCTION invoice_append_only();
CREATE FUNCTION receipt_counter_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Receipt counter cannot be deleted' USING ERRCODE='23514'; END IF;
 IF NEW.month IS DISTINCT FROM OLD.month OR NEW.value<>OLD.value+1 THEN RAISE EXCEPTION 'Receipt counter must increase by one' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_counter_monotonic BEFORE UPDATE OR DELETE ON "ReceiptMonthCounter" FOR EACH ROW EXECUTE FUNCTION receipt_counter_guard();
