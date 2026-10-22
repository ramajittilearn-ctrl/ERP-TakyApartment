ALTER TABLE "BackupHistory"
  ADD COLUMN bytes BIGINT,
  ADD COLUMN error VARCHAR(1000),
  ADD COLUMN "verifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "uploadedAt" TIMESTAMPTZ(3),
  ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'manual',
  ADD CONSTRAINT "Backup_size_nonnegative" CHECK (bytes IS NULL OR bytes >= 0),
  ADD CONSTRAINT "Backup_kind" CHECK (kind IN ('manual','weekly','rollback'));
