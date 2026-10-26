-- Install all managed deposit objects atomically; preserve existing data on any failure.
DO $deposit_migration$
BEGIN
-- CreateTable
CREATE TABLE "DepositAccount" (
    "leaseId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "reviewState" VARCHAR(12) NOT NULL DEFAULT 'UNREVIEWED',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "legacyDigest" CHAR(64),
    "reviewReason" VARCHAR(1000),
    "evidenceId" UUID,
    "openingAmount" DECIMAL(14,2),

    CONSTRAINT "DepositAccount_pkey" PRIMARY KEY ("leaseId")
);

-- CreateTable
CREATE TABLE "DepositEntry" (
    "id" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "postedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "evidenceId" UUID NOT NULL,
    "method" VARCHAR(20),
    "receivingAccountKey" VARCHAR(120),
    "externalReference" VARCHAR(120),
    "payeeName" VARCHAR(200),
    "destination" VARCHAR(200),
    "reverseOfId" UUID,
    "documentNumber" VARCHAR(40) NOT NULL,
    "documentSnapshot" JSONB NOT NULL,
    "snapshotSha256" CHAR(64) NOT NULL,

    CONSTRAINT "DepositEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositCommand" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "commandKey" VARCHAR(100) NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "requestFingerprint" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositEvidence" (
    "id" UUID NOT NULL,
    "leaseId" UUID NOT NULL,
    "attachmentId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositDocumentCounter" (
    "month" CHAR(6) NOT NULL,
    "nextValue" INTEGER NOT NULL,

    CONSTRAINT "DepositDocumentCounter_pkey" PRIMARY KEY ("month")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepositEntry_reverseOfId_key" ON "DepositEntry"("reverseOfId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositEntry_documentNumber_key" ON "DepositEntry"("documentNumber");

-- CreateIndex
CREATE INDEX "DepositEntry_leaseId_postedAt_idx" ON "DepositEntry"("leaseId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DepositEntry_leaseId_sequence_key" ON "DepositEntry"("leaseId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "DepositEntry_id_leaseId_key" ON "DepositEntry"("id", "leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositCommand_actorId_commandKey_key" ON "DepositCommand"("actorId", "commandKey");

-- CreateIndex
CREATE UNIQUE INDEX "DepositEvidence_attachmentId_key" ON "DepositEvidence"("attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositEvidence_id_leaseId_key" ON "DepositEvidence"("id", "leaseId");

-- AddForeignKey
ALTER TABLE "DepositAccount" ADD CONSTRAINT "DepositAccount_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositAccount" ADD CONSTRAINT "DepositAccount_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositAccount" ADD CONSTRAINT "DepositAccount_evidenceId_leaseId_fkey" FOREIGN KEY ("evidenceId", "leaseId") REFERENCES "DepositEvidence"("id", "leaseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositEntry" ADD CONSTRAINT "DepositEntry_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "DepositAccount"("leaseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositEntry" ADD CONSTRAINT "DepositEntry_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositEntry" ADD CONSTRAINT "DepositEntry_evidenceId_leaseId_fkey" FOREIGN KEY ("evidenceId", "leaseId") REFERENCES "DepositEvidence"("id", "leaseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositEntry" ADD CONSTRAINT "DepositEntry_reverseOfId_leaseId_fkey" FOREIGN KEY ("reverseOfId", "leaseId") REFERENCES "DepositEntry"("id", "leaseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositCommand" ADD CONSTRAINT "DepositCommand_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositEvidence" ADD CONSTRAINT "DepositEvidence_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositEvidence" ADD CONSTRAINT "DepositEvidence_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositEvidence" ADD CONSTRAINT "DepositEvidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



CREATE FUNCTION deposit_admission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock_shared(73422193);
 PERFORM pg_advisory_xact_lock(73422194);
 RETURN NULL;
END $$;
CREATE TRIGGER deposit_payment_admission BEFORE INSERT OR UPDATE OR DELETE ON "Payment" FOR EACH STATEMENT EXECUTE FUNCTION deposit_admission();
CREATE TRIGGER deposit_account_admission BEFORE INSERT OR UPDATE OR DELETE ON "DepositAccount" FOR EACH STATEMENT EXECUTE FUNCTION deposit_admission();
CREATE TRIGGER deposit_entry_admission BEFORE INSERT OR UPDATE OR DELETE ON "DepositEntry" FOR EACH STATEMENT EXECUTE FUNCTION deposit_admission();
CREATE FUNCTION deposit_admin(actor UUID) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM "User" WHERE id=actor AND role='ADMIN' AND NOT disabled) $$;
CREATE FUNCTION deposit_legacy_digest(lease UUID) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]'::jsonb)::text,'UTF8')),'hex') FROM "SecurityDeposit" d WHERE d."leaseId"=lease
$$;
ALTER TABLE "DepositAccount" ADD CONSTRAINT deposit_review_shape CHECK (
 version>=0 AND (("reviewState"='UNREVIEWED' AND version=0 AND "reviewedById" IS NULL AND "reviewedAt" IS NULL AND "legacyDigest" IS NULL AND "reviewReason" IS NULL AND "evidenceId" IS NULL AND "openingAmount" IS NULL)
 OR ("reviewState"='REVIEWED' AND version>=1 AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "legacyDigest" ~ '^[0-9a-f]{64}$' AND length(btrim("reviewReason"))>0 AND "evidenceId" IS NOT NULL AND "openingAmount" <> 'NaN'::numeric AND "openingAmount" BETWEEN 0 AND 999999999999.99)));
ALTER TABLE "DepositEntry" ADD CONSTRAINT deposit_entry_shape CHECK (
 sequence>0 AND kind IN ('RECEIPT','REFUND','DEDUCTION','REVERSAL','OPENING') AND amount <> 'NaN'::numeric AND amount>0 AND amount<=999999999999.99
 AND length(btrim(reason))>0 AND "snapshotSha256" ~ '^[0-9a-f]{64}$'
 AND ((kind='REVERSAL')=("reverseOfId" IS NOT NULL))
 AND ((kind='RECEIPT' AND method IN ('CASH','BANK_TRANSFER') AND "payeeName" IS NULL AND destination IS NULL)
 OR (kind='REFUND' AND method IN ('CASH','BANK_TRANSFER') AND length(btrim("payeeName"))>0)
 OR (kind IN ('DEDUCTION','REVERSAL','OPENING') AND method IS NULL AND "receivingAccountKey" IS NULL AND "externalReference" IS NULL AND "payeeName" IS NULL AND destination IS NULL))
 AND ((method='BANK_TRANSFER' AND kind='RECEIPT' AND length(btrim("receivingAccountKey"))>0 AND "receivingAccountKey"=btrim("receivingAccountKey") AND length(btrim("externalReference"))>0 AND "externalReference"=btrim("externalReference"))
 OR (method='BANK_TRANSFER' AND kind='REFUND' AND "receivingAccountKey" IS NULL AND length(btrim("externalReference"))>0 AND length(btrim(destination))>0)
 OR (method='CASH' AND "receivingAccountKey" IS NULL AND "externalReference" IS NULL AND destination IS NULL)
 OR method IS NULL));
CREATE FUNCTION deposit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Managed deposit history is immutable'; END $$;
CREATE TRIGGER deposit_entry_immutable BEFORE UPDATE OR DELETE ON "DepositEntry" FOR EACH ROW EXECUTE FUNCTION deposit_immutable();
CREATE TRIGGER deposit_command_immutable BEFORE UPDATE OR DELETE ON "DepositCommand" FOR EACH ROW EXECUTE FUNCTION deposit_immutable();
CREATE TRIGGER deposit_evidence_immutable BEFORE UPDATE OR DELETE ON "DepositEvidence" FOR EACH ROW EXECUTE FUNCTION deposit_immutable();
CREATE FUNCTION deposit_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE a "Attachment"%ROWTYPE; BEGIN
 SELECT * INTO a FROM "Attachment" WHERE id=NEW."attachmentId" FOR UPDATE;
 IF NOT FOUND OR NOT deposit_admin(NEW."uploadedById") OR a."uploadedById"<>NEW."uploadedById" OR a."leaseId" IS DISTINCT FROM NEW."leaseId" OR a."tenantId" IS NOT NULL OR a."paymentId" IS NOT NULL OR a."expenseId" IS NOT NULL OR a.bytes<=0 OR a.bytes>5242880 OR a.sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Deposit evidence requires accepted same-lease upload'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "actorId"=NEW."uploadedById" AND action='DEPOSIT_EVIDENCE_ADMISSION' AND metadata->>'leaseId'=NEW."leaseId"::text AND metadata->>'attemptId' IS NOT NULL AND "createdAt">=CURRENT_TIMESTAMP-interval '10 minutes') THEN RAISE EXCEPTION 'Deposit evidence upload admission missing'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deposit_evidence_integrity BEFORE INSERT ON "DepositEvidence" FOR EACH ROW EXECUTE FUNCTION deposit_evidence_guard();
CREATE FUNCTION deposit_attachment_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM "DepositEvidence" WHERE "attachmentId"=OLD.id) THEN RAISE EXCEPTION 'Accepted deposit evidence attachment is immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER deposit_attachment_integrity BEFORE UPDATE OR DELETE ON "Attachment" FOR EACH ROW EXECUTE FUNCTION deposit_attachment_guard();
CREATE FUNCTION deposit_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Deposit account history is immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW."reviewState"<>'UNREVIEWED' OR NEW.version<>0 THEN RAISE EXCEPTION 'New deposit accounts start unreviewed'; END IF;
 ELSIF OLD."reviewState"='UNREVIEWED' THEN
  IF NOT EXISTS(SELECT 1 FROM "Lease" l JOIN "Tenant" t ON t.id=l."tenantId" WHERE l.id=NEW."leaseId" AND NOT l."isDemo" AND NOT t."isDemo" AND l.status<>'DRAFT') THEN RAISE EXCEPTION 'Deposit review requires eligible non-demo lease and tenant'; END IF;
  IF NEW."leaseId"<>OLD."leaseId" OR NEW."reviewState"<>'REVIEWED' OR NEW.version<>1 OR NOT deposit_admin(NEW."reviewedById") OR NEW."legacyDigest" IS DISTINCT FROM deposit_legacy_digest(NEW."leaseId") THEN RAISE EXCEPTION 'Invalid historical review'; END IF;
 ELSE
  IF (to_jsonb(NEW)-'version') IS DISTINCT FROM (to_jsonb(OLD)-'version') OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Deposit review immutable; version must advance once'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deposit_account_integrity BEFORE INSERT OR UPDATE OR DELETE ON "DepositAccount" FOR EACH ROW EXECUTE FUNCTION deposit_account_guard();
CREATE FUNCTION deposit_version_check() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE a "DepositAccount"%ROWTYPE; n bigint; BEGIN
 SELECT * INTO a FROM "DepositAccount" WHERE "leaseId"=NEW."leaseId";
 SELECT count(*) INTO n FROM "DepositEntry" WHERE "leaseId"=a."leaseId";
 IF a."reviewState"='REVIEWED' AND a.version<>(n+(CASE WHEN a."openingAmount"=0 THEN 1 ELSE 0 END)) THEN RAISE EXCEPTION 'Deposit account version does not match committed ledger'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER deposit_version_integrity AFTER INSERT OR UPDATE ON "DepositAccount" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION deposit_version_check();
CREATE FUNCTION deposit_snapshot(e "DepositEntry") RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('format','taky.deposit.v1','entryId',e.id,'leaseId',e."leaseId",'leaseNumber',l.number,'tenantId',t.id,'tenantName',t.name,'roomId',r.id,'roomNumber',r.number,'kind',e.kind,'amount',to_char(e.amount,'FM999999999999990.00'),'occurredAt',to_char(e."occurredAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'postedAt',to_char(e."postedAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'postedById',u.id,'postedByName',u.name,'reason',e.reason,'evidenceId',e."evidenceId",'method',e.method,'receivingAccountKey',e."receivingAccountKey",'externalReference',e."externalReference",'payeeName',e."payeeName",'destination',e.destination,'documentNumber',e."documentNumber",'reverseOfId',e."reverseOfId",'originalDocumentNumber',o."documentNumber",'operatorVerified',true,'legalIssuerVerified',false)
 FROM "Lease" l JOIN "Tenant" t ON t.id=l."tenantId" JOIN "Room" r ON r.id=l."roomId" JOIN "User" u ON u.id=e."postedById" LEFT JOIN "DepositEntry" o ON o.id=e."reverseOfId" WHERE l.id=e."leaseId"
$$;
CREATE FUNCTION deposit_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "DepositAccount"%ROWTYPE; l "Lease"%ROWTYPE; original "DepositEntry"%ROWTYPE; balance numeric; effect numeric;
BEGIN
 SELECT * INTO l FROM "Lease" WHERE id=NEW."leaseId" FOR UPDATE;
 SELECT * INTO a FROM "DepositAccount" WHERE "leaseId"=NEW."leaseId" FOR UPDATE;
 IF a."reviewState" IS DISTINCT FROM 'REVIEWED' OR NOT deposit_admin(NEW."postedById") OR l."isDemo" OR EXISTS(SELECT 1 FROM "Tenant" WHERE id=l."tenantId" AND "isDemo") OR a."legacyDigest" IS DISTINCT FROM deposit_legacy_digest(NEW."leaseId") THEN RAISE EXCEPTION 'Reviewed unchanged non-demo deposit account and ADMIN required'; END IF;
 IF l.status='DRAFT' OR (NEW.kind='RECEIPT' AND l.status<>'ACTIVE') OR NEW."occurredAt">CURRENT_TIMESTAMP+interval '5 minutes' OR NEW."postedAt">CURRENT_TIMESTAMP+interval '5 seconds' OR NEW."postedAt"<CURRENT_TIMESTAMP-interval '5 minutes' THEN RAISE EXCEPTION 'Deposit posting state or timestamp invalid'; END IF;
 IF NEW.kind='OPENING' THEN
  IF NEW.sequence<>1 OR a.version<>1 OR NEW.amount IS DISTINCT FROM a."openingAmount" OR EXISTS(SELECT 1 FROM "DepositEntry" WHERE "leaseId"=NEW."leaseId") THEN RAISE EXCEPTION 'Opening must match original reviewed liability'; END IF;
 ELSIF NEW.sequence<>a.version+1 THEN RAISE EXCEPTION 'Deposit sequence stale'; END IF;
 IF NEW.kind='REVERSAL' THEN
  SELECT * INTO original FROM "DepositEntry" WHERE id=NEW."reverseOfId" AND "leaseId"=NEW."leaseId" FOR UPDATE;
  IF NOT FOUND OR original.kind='REVERSAL' OR original.amount IS DISTINCT FROM NEW.amount OR EXISTS(SELECT 1 FROM "DepositEntry" WHERE "reverseOfId"=original.id) THEN RAISE EXCEPTION 'Invalid original reversal'; END IF;
  effect:=CASE WHEN original.kind IN ('RECEIPT','OPENING') THEN -NEW.amount ELSE NEW.amount END;
 ELSE effect:=CASE WHEN NEW.kind IN ('RECEIPT','OPENING') THEN NEW.amount ELSE -NEW.amount END;
 END IF;
 SELECT COALESCE(sum(CASE WHEN e.kind IN ('RECEIPT','OPENING') THEN e.amount WHEN e.kind IN ('REFUND','DEDUCTION') THEN -e.amount WHEN o.kind IN ('RECEIPT','OPENING') THEN -e.amount ELSE e.amount END),0) INTO balance FROM "DepositEntry" e LEFT JOIN "DepositEntry" o ON o.id=e."reverseOfId" WHERE e."leaseId"=NEW."leaseId";
 IF balance='NaN'::numeric OR effect='NaN'::numeric OR balance+effect<0 THEN RAISE EXCEPTION 'Insufficient held deposit'; END IF;
 IF NEW.kind='RECEIPT' AND NEW.method='BANK_TRANSFER' AND (EXISTS(SELECT 1 FROM "Payment" WHERE NOT "legacyUnmapped" AND status IN ('PENDING','CONFIRMED') AND "receivingAccountKey"=NEW."receivingAccountKey" AND "externalReference"=NEW."externalReference") OR EXISTS(SELECT 1 FROM "DepositEntry" d WHERE d.kind='RECEIPT' AND d.method='BANK_TRANSFER' AND d."receivingAccountKey"=NEW."receivingAccountKey" AND d."externalReference"=NEW."externalReference" AND NOT EXISTS(SELECT 1 FROM "DepositEntry" x WHERE x."reverseOfId"=d.id))) THEN RAISE EXCEPTION 'Incoming transfer already claimed; mixed rent and deposit transfers unsupported'; END IF;
 IF NEW."documentSnapshot" IS DISTINCT FROM deposit_snapshot(NEW) OR NEW."snapshotSha256" IS DISTINCT FROM encode(sha256(convert_to(NEW."documentSnapshot"::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Deposit document snapshot forged'; END IF;
 IF NEW.kind<>'OPENING' THEN UPDATE "DepositAccount" SET version=version+1 WHERE "leaseId"=NEW."leaseId"; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deposit_entry_integrity BEFORE INSERT ON "DepositEntry" FOR EACH ROW EXECUTE FUNCTION deposit_entry_guard();
CREATE FUNCTION deposit_payment_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT NEW."legacyUnmapped" AND NEW.status IN ('PENDING','CONFIRMED') AND NEW."methodCode"='BANK_TRANSFER' AND EXISTS(SELECT 1 FROM "DepositEntry" d WHERE d.kind='RECEIPT' AND d.method='BANK_TRANSFER' AND d."receivingAccountKey"=NEW."receivingAccountKey" AND d."externalReference"=NEW."externalReference" AND NOT EXISTS(SELECT 1 FROM "DepositEntry" x WHERE x."reverseOfId"=d.id)) THEN RAISE EXCEPTION 'Incoming transfer already claimed by managed deposit'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deposit_payment_identity_integrity BEFORE INSERT OR UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION deposit_payment_identity();
CREATE FUNCTION deposit_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT deposit_admin(NEW."actorId") OR NEW.operation NOT IN ('deposit.review','deposit.receipt','deposit.refund','deposit.deduction','deposit.reverse') OR NEW."requestFingerprint" !~ '^[0-9a-f]{64}$' OR length(btrim(NEW."commandKey")) NOT BETWEEN 8 AND 100 THEN RAISE EXCEPTION 'Deposit command provenance invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deposit_command_integrity BEFORE INSERT ON "DepositCommand" FOR EACH ROW EXECUTE FUNCTION deposit_command_guard();
ALTER TABLE "DepositDocumentCounter" ADD CONSTRAINT deposit_counter_shape CHECK(month ~ '^[0-9]{4}(0[1-9]|1[0-2])$' AND "nextValue" BETWEEN 1 AND 1000000);
ALTER TABLE "DepositEntry" ADD CONSTRAINT deposit_method_required CHECK (
 (kind IN ('RECEIPT','REFUND') AND method IS NOT NULL)
 OR (kind IN ('DEDUCTION','REVERSAL','OPENING') AND method IS NULL));
ALTER TABLE "DepositEntry" ADD CONSTRAINT deposit_bank_fields_required CHECK (
 method IS DISTINCT FROM 'BANK_TRANSFER' OR
 ("externalReference" IS NOT NULL AND ((kind='RECEIPT' AND "receivingAccountKey" IS NOT NULL) OR (kind='REFUND' AND "payeeName" IS NOT NULL AND destination IS NOT NULL))));
CREATE FUNCTION deposit_counter_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (TG_OP='INSERT' AND NEW."nextValue"<>1) OR (TG_OP='UPDATE' AND (NEW.month<>OLD.month OR NEW."nextValue"<>OLD."nextValue"+1)) THEN RAISE EXCEPTION 'Deposit counter may only advance once'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deposit_counter_integrity BEFORE INSERT OR UPDATE OR DELETE ON "DepositDocumentCounter" FOR EACH ROW EXECUTE FUNCTION deposit_counter_guard();
CREATE FUNCTION deposit_number_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE m text; n integer; BEGIN
 m:=to_char(NEW."postedAt" AT TIME ZONE 'Asia/Bangkok','YYYYMM');
 SELECT "nextValue"-1 INTO n FROM "DepositDocumentCounter" WHERE month=m;
 IF n IS NULL OR n<1 OR NEW."documentNumber" IS DISTINCT FROM 'DEP-'||m||'-'||lpad(n::text,6,'0') THEN RAISE EXCEPTION 'Deposit document counter mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deposit_number_integrity BEFORE INSERT ON "DepositEntry" FOR EACH ROW EXECUTE FUNCTION deposit_number_guard();
ALTER TABLE "DepositAccount" ADD CONSTRAINT deposit_review_nonnull CHECK ("reviewState"<>'REVIEWED' OR ("legacyDigest" IS NOT NULL AND "reviewReason" IS NOT NULL AND "openingAmount" IS NOT NULL));
ALTER TABLE "DepositEntry" ADD CONSTRAINT deposit_refund_payee CHECK (kind<>'REFUND' OR "payeeName" IS NOT NULL);

END
$deposit_migration$;
