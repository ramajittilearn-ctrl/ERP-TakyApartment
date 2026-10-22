-- Prepared only. Do not execute before Owner confirms the actual target.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), current_setting('transaction_read_only');
-- Operator must confirm identity before continuing.
SELECT table_name, column_name, data_type
FROM information_schema.columns WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
-- Continue only after checking these relations/columns against the catalog.
SELECT migration_name, checksum, finished_at, rolled_back_at
FROM "_prisma_migrations" ORDER BY migration_name;
SELECT status, count(*) AS rows, min(period), max(period), sum("finalTotal") AS final_total
FROM "Invoice" GROUP BY status ORDER BY status;
SELECT count(*) FILTER (WHERE "billingPeriodId" IS NULL) AS unlinked_period,
       count(*) FILTER (WHERE snapshot IS NULL) AS missing_snapshot,
       count(*) FILTER (WHERE "frozenLeaseId" IS NULL) AS missing_frozen_lease,
       count(*) FILTER (WHERE status = 'ISSUED' AND (number IS NULL OR "issuedAt" IS NULL OR fingerprint IS NULL OR "dueDate" IS NULL)) AS incomplete_issued
FROM "Invoice";
SELECT "leaseId", date_trunc('month', period) AS month, count(*)
FROM "Invoice" WHERE status <> 'VOID'
GROUP BY "leaseId", date_trunc('month', period) HAVING count(*) > 1;
SELECT status, type, count(*), min(period), max(period),
       count(*) FILTER (WHERE "billingPeriodId" IS NULL) AS unlinked_period,
       count(*) FILTER (WHERE "readingDate" IS NULL) AS missing_reading_date
FROM "MeterReading" GROUP BY status, type ORDER BY status, type;
SELECT "meterId", date_trunc('month', period) AS month, count(*)
FROM "MeterReading" GROUP BY "meterId", date_trunc('month', period) HAVING count(*) > 1;
SELECT status, method, count(*), sum(amount), min("receivedAt"), max("receivedAt")
FROM "Payment" GROUP BY status, method ORDER BY status, method;
SELECT count(*) AS allocations, sum(amount) AS allocated FROM "PaymentAllocation";
ROLLBACK;
