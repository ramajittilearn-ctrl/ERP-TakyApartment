-- Preserve all existing expense/category values; added legacy metadata remains NULL.
CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING','POSTED','CANCELLED','REVERSED');
CREATE TYPE "ExpenseMethod" AS ENUM ('CASH','BANK_TRANSFER');
ALTER TABLE "ExpenseCategory"
 ADD COLUMN active BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "createdById" UUID REFERENCES "User"(id) ON DELETE RESTRICT,
 ADD COLUMN "changedById" UUID REFERENCES "User"(id) ON DELETE RESTRICT,
 ADD CONSTRAINT "ExpenseCategory_version_positive" CHECK(version > 0);
ALTER TABLE "Expense"
 ADD COLUMN "legacyUnmapped" BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN status "ExpenseStatus",
 ADD COLUMN version INTEGER,
 ADD COLUMN vendor VARCHAR(120),
 ADD COLUMN method "ExpenseMethod",
 ADD COLUMN note VARCHAR(500),
 ADD COLUMN "categoryNameSnapshot" VARCHAR(100),
 ADD COLUMN "categoryKindSnapshot" "ExpenseKind",
 ADD COLUMN "recordedById" UUID REFERENCES "User"(id) ON DELETE RESTRICT,
 ADD COLUMN "postedById" UUID REFERENCES "User"(id) ON DELETE RESTRICT,
 ADD COLUMN "postedAt" TIMESTAMPTZ(3),
 ADD COLUMN "cancelledById" UUID REFERENCES "User"(id) ON DELETE RESTRICT,
 ADD COLUMN "cancelledAt" TIMESTAMPTZ(3),
 ADD COLUMN "cancelReason" VARCHAR(1000),
 ADD COLUMN "reversedById" UUID REFERENCES "User"(id) ON DELETE RESTRICT,
 ADD COLUMN "reversedAt" TIMESTAMPTZ(3),
 ADD COLUMN "reverseReason" VARCHAR(1000),
 ADD COLUMN "correctionOfId" UUID REFERENCES "Expense"(id) ON DELETE RESTRICT;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_lifecycle_shape" CHECK (
 ("legacyUnmapped" AND status IS NULL AND version IS NULL AND vendor IS NULL AND method IS NULL AND note IS NULL
  AND "categoryNameSnapshot" IS NULL AND "categoryKindSnapshot" IS NULL AND "recordedById" IS NULL
  AND "postedById" IS NULL AND "postedAt" IS NULL AND "cancelledById" IS NULL AND "cancelledAt" IS NULL
  AND "cancelReason" IS NULL AND "reversedById" IS NULL AND "reversedAt" IS NULL AND "reverseReason" IS NULL AND "correctionOfId" IS NULL)
 OR
 (NOT "legacyUnmapped" AND NOT "isDemo" AND amount <> 'NaN'::numeric AND status IS NOT NULL AND version IS NOT NULL AND version > 0
  AND vendor IS NOT NULL AND length(btrim(vendor)) > 0 AND method IS NOT NULL
  AND length(btrim(description)) > 0 AND "recordedById" IS NOT NULL
  AND "categoryNameSnapshot" IS NOT NULL AND "categoryKindSnapshot" IS NOT NULL
  AND ((status IN ('PENDING','CANCELLED') AND "postedById" IS NULL AND "postedAt" IS NULL)
    OR (status IN ('POSTED','REVERSED') AND "postedById" IS NOT NULL AND "postedAt" IS NOT NULL))
  AND ((status='CANCELLED' AND "cancelledById" IS NOT NULL AND "cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL AND length(btrim("cancelReason"))>0)
    OR (status<>'CANCELLED' AND "cancelledById" IS NULL AND "cancelledAt" IS NULL AND "cancelReason" IS NULL))
  AND ((status='REVERSED' AND "reversedById" IS NOT NULL AND "reversedAt" IS NOT NULL AND "reverseReason" IS NOT NULL AND length(btrim("reverseReason"))>0)
    OR (status<>'REVERSED' AND "reversedById" IS NULL AND "reversedAt" IS NULL AND "reverseReason" IS NULL)))
);
CREATE TABLE "ExpenseCommand" (
 id UUID PRIMARY KEY, "actorId" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "commandKey" VARCHAR(100) NOT NULL, operation VARCHAR(80) NOT NULL,
 "requestFingerprint" CHAR(64) NOT NULL, result JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ExpenseCommand_key_shape" CHECK(length(btrim("commandKey")) BETWEEN 8 AND 100 AND "requestFingerprint" ~ '^[0-9a-f]{64}$'),
 CONSTRAINT "ExpenseCommand_actorId_commandKey_key" UNIQUE("actorId","commandKey")
);
CREATE FUNCTION expense_actor(p_actor UUID, p_admin BOOLEAN) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM "User" WHERE id=p_actor AND NOT disabled AND (NOT p_admin OR role='ADMIN'))
$$;
CREATE FUNCTION expense_category_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Expense category history is immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NOT expense_actor(NEW."createdById",true) OR NEW."changedById" IS DISTINCT FROM NEW."createdById" THEN
   RAISE EXCEPTION 'New expense category requires ADMIN provenance';
  END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['active','version','changedById','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['active','version','changedById','updatedAt'])
   OR NEW.version<>OLD.version+1 OR NEW.active=OLD.active OR NOT expense_actor(NEW."changedById",true) THEN
   RAISE EXCEPTION 'Only audited ADMIN category activation changes are allowed';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER expense_category_integrity BEFORE INSERT OR UPDATE OR DELETE ON "ExpenseCategory" FOR EACH ROW EXECUTE FUNCTION expense_category_guard();
CREATE FUNCTION expense_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_category "ExpenseCategory"%ROWTYPE; v_original "Expense"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Expense history is immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW."legacyUnmapped" OR NEW."isDemo" OR NEW.status IS DISTINCT FROM 'PENDING'::"ExpenseStatus" OR NEW.version IS DISTINCT FROM 1
   OR NOT expense_actor(NEW."recordedById",false) THEN RAISE EXCEPTION 'New expenses require managed pending provenance'; END IF;
  SELECT * INTO v_category FROM "ExpenseCategory" WHERE id=NEW."categoryId" FOR UPDATE;
  IF NOT FOUND OR NOT v_category.active OR NEW."categoryNameSnapshot" IS DISTINCT FROM v_category.name OR NEW."categoryKindSnapshot" IS DISTINCT FROM v_category.kind THEN
   RAISE EXCEPTION 'Expense category snapshot or eligibility mismatch';
  END IF;
  IF NEW."correctionOfId" IS NOT NULL THEN
   SELECT * INTO v_original FROM "Expense" WHERE id=NEW."correctionOfId";
   IF NOT FOUND OR v_original."legacyUnmapped" OR v_original."propertyId"<>NEW."propertyId" OR v_original.status NOT IN ('CANCELLED','REVERSED')
    THEN RAISE EXCEPTION 'Correction requires a terminal expense on the same property'; END IF;
  END IF;
 ELSE
  IF OLD."legacyUnmapped" THEN RAISE EXCEPTION 'Legacy expense requires explicit reconciliation'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','version','postedById','postedAt','cancelledById','cancelledAt','cancelReason','reversedById','reversedAt','reverseReason','updatedAt'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','postedById','postedAt','cancelledById','cancelledAt','cancelReason','reversedById','reversedAt','reverseReason','updatedAt'])
   OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Expense original fields and version are immutable'; END IF;
  IF OLD.status='PENDING' AND NEW.status='POSTED' THEN
   SELECT * INTO v_category FROM "ExpenseCategory" WHERE id=NEW."categoryId" FOR UPDATE;
   IF NOT v_category.active OR NOT expense_actor(NEW."postedById",true) THEN RAISE EXCEPTION 'Posting requires active category and ADMIN'; END IF;
  ELSIF OLD.status='PENDING' AND NEW.status='CANCELLED' THEN
   IF NOT expense_actor(NEW."cancelledById",true) THEN RAISE EXCEPTION 'Cancellation requires ADMIN'; END IF;
  ELSIF OLD.status='POSTED' AND NEW.status='REVERSED' THEN
   IF NOT expense_actor(NEW."reversedById",true) OR NEW."postedById" IS DISTINCT FROM OLD."postedById" OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
    THEN RAISE EXCEPTION 'Reversal requires ADMIN and immutable posting'; END IF;
  ELSE RAISE EXCEPTION 'Invalid expense transition'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER expense_integrity BEFORE INSERT OR UPDATE OR DELETE ON "Expense" FOR EACH ROW EXECUTE FUNCTION expense_guard();
CREATE FUNCTION expense_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Expense commands are immutable'; END IF;
 IF NEW.operation NOT IN ('expense.create','expense.post','expense.cancel','expense.reverse','expense.category.create','expense.category.set-active')
  OR NOT expense_actor(NEW."actorId",NEW.operation<>'expense.create') THEN RAISE EXCEPTION 'Expense command actor invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER expense_command_integrity BEFORE INSERT OR UPDATE OR DELETE ON "ExpenseCommand" FOR EACH ROW EXECUTE FUNCTION expense_command_guard();
