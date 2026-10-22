# Backup and disaster recovery

Phase 2.5 uses one maintenance container, PostgreSQL 17 tools, Node's AES-256-GCM and rclone. Backups include the entire application database, private attachment files and an encrypted manifest. A dump is consistent with a PostgreSQL exported snapshot; attachment hashes must remain unchanged across the snapshot/copy window. Existing attachment uploads are not implemented. Future writers must use atomic file replacement and the same backup coordination, or backups will fail rather than certify changing files.

## Initial setup and key custody

```sh
npm ci
node scripts/ops.mjs init
node scripts/ops.mjs up
node scripts/ops.mjs ps
```

The initializer exclusively creates `.local/private/backup.key`, `.local/private/rclone/rclone.conf`, `.local/operations.env` and `.local/backups`. Existing configuration and keys are preserved. Private directories use mode 700 and files 600. `.local` is ignored by Git and excluded from Docker build contexts. The maintenance service mounts only the key read-only and the rclone directory read/write for OAuth refresh. The web application cannot read either credential.

The encryption key is 32 cryptographically random bytes, encoded as base64. It is not an account password. Keep a protected off-device copy in your password manager or encrypted removable media, separate from backup archives. Record its association with this installation. Never upload the key into the backup folder or commit it. Losing the only key makes the archives unrecoverable. Keep older keys when rotating; select the matching key path and restart maintenance before testing an older archive. The manifest has a key fingerprint, not the key itself.

Backups do not contain `.env`, OAuth tokens or the Caddy CA private key. On replacement hardware, generate new database/session secrets and a new local CA, restore the database with ownership assigned to the new database user, then trust the new public root on authorized devices. Existing user password hashes survive restoration; rotating SESSION_SECRET invalidates old browser sessions.

## Manual backup and status

```sh
node scripts/ops.mjs backup
node scripts/ops.mjs status
node scripts/ops.mjs verify taky-YYYYMMDDTHHMMSSZ-UUID.taky.enc
```

Use the exact filename printed by `backup` or `status`. Do not type the placeholder literally. `verify` authenticates/decrypts the archive, checks all file hashes and restores the dump into a temporary PostgreSQL server with only a private Unix socket. No host TCP listener or production connection is used for this verification. The temporary server and plaintext staging files are removed afterward.

Each backup is written to a partial filename. Only after authenticated decryption, manifest verification and an isolated PostgreSQL restore succeed does it become a SUCCEEDED final archive. The private `records/<uuid>.json` journal and PostgreSQL BackupHistory record include status, creation/verification time, encrypted checksum, size and failure details. The journal remains available during a database outage, and later retry commands reconcile it with the database. Restore receipts under `receipts` are tied to the encrypted archive checksum. No dump, manifest contents or tenant contact values are logged.

A failed attempt remains FAILED and does not remove the previous archive. An interrupted RUNNING attempt is reconciled as FAILED when the next backup acquires the lock. Partial files left by a power failure are not valid backups and are never uploaded or counted toward retention. Remove stale partial files only after checking status and preserving the latest verified archive.

## Weekly scheduling and retention

The maintenance service starts with Compose and checks the clock every minute. Weekly backups become due Sunday at 02:00 Asia/Bangkok. It catches up the most recent due week after downtime or initial installation. Failed weekly attempts retry after one hour. There is no separate macOS cron installation. Docker Desktop must be running, the host awake and the disks available; sleeping Macs cannot execute the job. On a dedicated Mac mini, configure an appropriate sleep policy and start Docker Desktop at login.

Kernel `flock` prevents overlapping backup, upload, verification and restore jobs. A competing command exits 75 and can be retried later. The scheduler has a persisted heartbeat and Docker health check. Check `node scripts/ops.mjs status`, `node scripts/ops.mjs ps` and `docker compose` logs using all overlays, rather than relying only on a container's existence.

Retention keeps the newest 12 verified weekly sets. It also keeps 12 verified manual and rollback sets independently. Pending or failed cloud deliveries protect the local archive from pruning, so an extended outage can require more disk space. Failed backups never count as successful sets. Older eligible archives are deleted only from the configured, verified remote and then locally; a remote deletion failure preserves the local copy. Status journals remain. Monitor free disk space and do not prune the newest verified backup to solve a failed job.

## Google Drive authorization

Cloud authorization requires the owner. No credentials are supplied by the project.

```sh
node scripts/ops.mjs rclone-config
```

Create a remote named `gdrive`, select the `drive` storage provider and follow rclone's OAuth prompts. Prefer `drive.file` scope and let rclone create its own backup folder. This scope sees files created by that rclone application, not arbitrary existing Drive files. Use a client ID you control if required by your Google account policy; otherwise rclone's supported default can be used. Do not invent an API key. If the container cannot open a browser, answer no to automatic browser configuration, run the exact `rclone authorize` command it prints on a trusted Mac with matching rclone installed, authorize the intended Google account, then paste the returned token into the private interactive terminal. Do not paste tokens into chat, documentation or Git.

Set this in private `.local/operations.env`:

```dotenv
BACKUP_REMOTE=gdrive:TakyApartmentBackups
```

Then apply configuration and retry:

```sh
node scripts/ops.mjs reload
node scripts/ops.mjs retry
node scripts/ops.mjs status
```

Uploads use an encrypted partial name, download and hash the remote ciphertext, move to the final name, then hash the final remote bytes again. `uploadedAt` is recorded only after this check. Repeated attempts converge on the same final file. The scheduler retries pending uploads hourly and after backups, with bounded rclone retries/timeouts. Local verification can succeed while upload remains pending; that is not an off-device backup. An absent remote is reported in `uploadError`, not fabricated as success. A local rclone test backend proves transfer/retry logic but does not prove Google authorization or delivery.

After authorization, create a backup, confirm its `uploadedAt` and remote identity, download that encrypted file from Drive to a separate location and perform a restore drill. Check Drive quota and the selected account/folder. Keep the Drive copy private. Instructions follow [rclone's Drive documentation](https://rclone.org/drive/).

## Isolated restore drill

```sh
node scripts/ops.mjs restore-test taky-YYYYMMDDTHHMMSSZ-UUID.taky.enc
```

The command creates a unique `taky-restore-*` Compose project, its own internal network, database volume and attachment volume. It uses a new random test database password in process memory. It refuses an existing/nonempty target, validates authentication and hashes before importing, then checks schema/migration fingerprints, room inventory, tenant/lease fingerprints and every attachment hash. The source database and attachment volume are not writable mounts in the drill.

Containers and the temporary network stop after the test; its separate data volumes remain for inspection, and its project/status are recorded in `.local/restore-drills`. A checksum-bound receipt is in `.local/backups/receipts`. Review the receipt before any production recovery. There is no automatic production reset. Remove drill volumes later only by their exact recorded project names and with owner approval; never prune all Docker volumes.

To recover a downloaded archive without its original sidecar journal, put the encrypted archive in the configured backup directory with its original exact filename, restore the correct private key, and run `verify` and `restore-test`. The encrypted manifest contains the restore metadata; cloud transport does not require an unencrypted manifest.

## Production recovery and rollback

This workflow replaces operational data. It is never called by the scheduler or automated verification.

```sh
node scripts/ops.mjs restore-production taky-YYYYMMDDTHHMMSSZ-UUID.taky.enc
```

Run it from an owner-controlled interactive terminal. The command first performs a separate Docker restore drill. It then describes the target and requires the owner to type the exact confirmation phrase. A pipe or automated test cannot satisfy the host's terminal check. A mismatched phrase leaves production unchanged.

After confirmation it stops the proxy/app, creates a fresh encrypted rollback backup of the quiescent database and attachments and verifies it by restoration, then stops the scheduler. If rollback creation fails, normal services restart without replacing data. Recovery verifies both selected and rollback archives again. Database replacement uses one PostgreSQL transaction with `pg_restore --clean --if-exists --single-transaction`. Attachment replacement follows while the application is stopped. Database and filesystem replacement are not one atomic transaction. If attachment replacement or final validation fails, services remain stopped; preserve all volumes and use the verified rollback archive.

Rollback procedure: identify the printed rollback filename and run `node scripts/ops.mjs rollback-production <exact-rollback-filename>`. This command accepts only a verified rollback entry from the private journal, performs an independent drill and requires a new explicit ROLLBACK confirmation. It uses that existing rollback archive instead of requiring another backup of the failed recovery state. It keeps services stopped until data and attachment checks pass. Do not overwrite the only rollback archive. Preserve the original archive and all volumes if rollback verification fails; there is no automatic bypass.

For complete Docker volume loss or Mac replacement:

1. Install Docker Desktop and Node, clone the private repository and check out the reviewed recovery code version.
2. Run the environment and operations initializers to create a fresh empty deployment configuration. Restore the matching encryption key from protected escrow, replacing only the newly generated unused key after identifying both. Keep that new key separately if any backups were already created with it.
3. Download a selected encrypted archive from the authorized Drive folder or protected local disk. Put it in the configured backup directory. Do not restore a live database data directory from a cloud-synced folder.
4. Start the fresh deployment, run `verify` and `restore-test`, inspect the exact 15-room inventory and restore receipt, then use the owner-confirmed production recovery command against the freshly initialized deployment. Its rollback is the new empty installation.
5. Check room/tenant/lease records, attachment hashes and owner login, then commission the new HTTPS root certificate on each trusted device. Old sessions should be invalidated through the newly generated session secret.
6. Reauthorize rclone if its private configuration was lost, prove a new off-device upload and repeat a restore drill. Do not resume real accounting until these steps pass.

## Troubleshooting

- Exit 75: another maintenance operation holds the lock; wait and retry. Do not delete the lock file, which would create a second lock inode.
- Authentication failure: wrong key, changed header/tag or damaged archive. Preserve the failed archive and use a known-good copy/key; decryption failure must not be bypassed.
- Missing/changed attachment: inspect its private file and database metadata, stop uncoordinated writers and retry. No changing set is certified.
- Database unavailable: inspect app/db health and the private on-disk journal. The scheduler retries; it does not initialize or reset a lost operational database automatically.
- Upload pending: authorize/reconnect the intended rclone remote, check internet/quota, then run `retry`. The local archive remains protected.
- Worker interrupted: the OS releases its file lock; the next job marks its RUNNING journal failed. Preserve any final verified sets and check disk space.
- Restore mismatch: retain the isolated volumes and receipt/log, keep production unchanged and investigate the selected schema/code version. Never apply a destructive migration merely to make a drill pass.

Temporary plaintext exists in the maintenance container while dumping/restoring, as it does in the operational database volume. Protect the host with FileVault and access controls. Local encrypted archives and off-device ciphertext do not protect against an attacker who already controls the running Mac and its key.
