# Phase 2.5 implementation and verification report

Review date: 17 October 2026. Baseline: private repository `ramajittilearn-ctrl/ERP-TakyApartment`, `main`, commit `76403a5acaf8a9e1426da0fe581a1f3d005593d2`.

## A. Executive summary

Phase 2.5 implementation is complete and locally verified. The normal deployment now runs Caddy HTTPS, the existing application, PostgreSQL and a maintenance scheduler. Its original database fingerprint is unchanged: 15 rooms, no operational tenants, leases or users added. The frontend and financial business logic were not changed.

Backups cover PostgreSQL, private attachments and a versioned manifest. AES-256-GCM protects each archive. A backup becomes successful only after authenticated decryption, file checksums and an isolated PostgreSQL restore pass. The weekly scheduler, private journals, database history, retention, rclone retry logic, isolated Docker restore and owner-confirmed production recovery/rollback commands are implemented.

Verification passed: host/Docker production builds, lint, TypeScript, formatting, 23 existing unit tests, eight backup unit tests, 10 database integration tests, 36 browser tests and 13 operational checks. The final isolated drill restored 15 rooms, two explicitly Demo tenants, two Demo leases and one private Demo attachment. The actual normal backup also passed a separate Docker restore drill without changing normal records.

Overall status is **implemented, with manual commissioning remaining**. Google Drive authorization and actual off-device upload are NOT RUN. The rclone transfer test used a real local backend and deliberately failed remote configuration. Additional-device certificate trust, owner-selected normal admin login and encryption-key escrow need owner action. These are not represented as passed.

## B. Scope completion matrix

| Requirement | Status | Source files | Verification evidence |
| --- | --- | --- | --- |
| Baseline review and acceptance plan | Complete | `docs/phase-2.5-plan.md` | Clean baseline/history inspected; Phase 2 report, operations, schema, storage and authentication reviewed. |
| Consistent DB/attachment/manifest backup | Complete | `operations/backup.mjs`, `database.mjs`, `archive.mjs` | Exported PostgreSQL snapshot and stable attachment hashes; actual backup and restore passed. |
| Authenticated encryption and integrity | Complete | `archive.mjs`, `tests/ops/backup.test.mjs` | AES-GCM round trip, fresh nonce, wrong key, damaged header/nonce/ciphertext/tag and manifest checksum rejection tests pass. |
| Weekly Sunday 02:00 Bangkok scheduler | Complete | `backup.mjs`, `cli.mjs`, operations Compose | Schedule boundary/backoff tests pass; real first-start weekly catch-up backup succeeded; scheduler heartbeat healthy. Future calendar occurrence has not been waited for. |
| Non-overlap | Complete | `cli.mjs` | Real kernel lock test rejects competing backup with exit 75. |
| Retention of latest 12 weekly successes | Complete | `backup.mjs`, backup unit tests | Policy test protects newest 12 verified weekly sets, pending uploads and last known-good backup. Separate manual/rollback retention is also 12 each. |
| Failure-safe status and history | Complete | Backup journal, `database.mjs`, additive migration | Actual checksum/size/status/verification time match database; negative size rejected; deliberately missing key logs FAILED and preserves verified archive. |
| rclone upload, verification and retry | Complete | `backup.mjs`, operations image/config | Real rclone local-backend copy, ciphertext download/hash, final rename and retry pass; missing remote retains pending state. |
| Actual Google Drive delivery | Partial | `scripts/ops.mjs`, `docs/backup-restore.md` | Private OAuth configuration and exact authorization steps prepared. No owner authorization or verified Drive upload. |
| Isolated Docker restore | Complete | `docker-compose.restore.yml`, `database.mjs`, host wrapper | Distinct network/database/attachment volumes; schema, migrations, room/tenant/lease hashes and attachment hashes match; source fingerprints unchanged. |
| Production restore and rollback workflow | Complete | `production-restore.mjs`, `scripts/ops.mjs`, recovery guide | Interactive confirmation, verified rollback prerequisite, transactional DB replacement, stopped-app attachment replacement and rollback command implemented. Confirmation guard tested. Destructive normal restoration intentionally NOT RUN. |
| HTTPS/private network/origin/cookies | Complete | `operations/Caddyfile`, HTTPS Compose | Trusted TLS and host verification, HTTPS ADMIN/STAFF login, Secure/HttpOnly/SameSite cookies, origin rejection and logout pass. Normal private-LAN readiness passes. |
| Device certificate commissioning | Partial | `docs/secure-lan-deployment.md` | Public root exported; macOS/iPhone/other-device instructions supplied. System trust-store changes and physical second-device tests NOT RUN. |
| Restart persistence | Complete | `scripts/verify-phase25.mjs` | Database/domain hashes, private attachment, CA trust and existing authenticated session survive app/db/proxy/worker restarts. |
| Existing UX/UI and backend regression | Complete | Existing tests and screenshot directory | 36 browser tests at desktop/tablet/mobile, 23 finance/lease unit tests and 10 integration tests pass. |
| Documentation and Git delivery | Complete | README, environment example, guides, this report | Reproducible commands and commissioning limits supplied. Publication preserves the baseline parent and verifies the remote head; containing commit hash is supplied in the delivery message. |

## C. Backup and recovery

The maintenance image combines Node 22, PostgreSQL 17 tools and rclone 1.75.2. It has no published ports or Docker socket. It reads the existing attachment volume read-only and writes encrypted archives/private journals to a host directory. The app has no access to the encryption key or Drive tokens. Rclone's private directory is writable only to maintenance so OAuth token refresh can use atomic file replacement. The encryption key is mounted read-only.

The worker keeps a repeatable-read exported PostgreSQL snapshot open while pg_dump makes a custom-format dump and the manifest records domain fingerprints. Attachment inventories before and after the copy window and copied hashes must agree; database attachment metadata must match its file. Any mismatch fails the job. The archive includes the dump, attachment tree, checksums/sizes, format/version, PostgreSQL major, timestamp, key fingerprint and snapshot schema/migration/record fingerprints.

The encrypted envelope contains a version header, random 96-bit nonce, ciphertext and 128-bit GCM tag. The header/nonce are authenticated additional data. The key is 32 random bytes in a private base64 file, never a hardcoded password or Git artifact. Decryption must finish authentication before the archive is listed/extracted. Restore rejects traversal, links, duplicate members and unknown format, and validates all files before DB import. Plaintext staging is temporary inside maintenance and removed after success/failure.

Every created archive passes a real restore into a temporary PostgreSQL cluster with only a private Unix socket before SUCCEEDED is recorded. A partial file is never treated as verified. Kernel locks release on process death; interrupted jobs are reconciled when a subsequent backup acquires the lock. Successful archives, archive SHA-256/bytes, timestamps and errors are recorded in private JSON journals and BackupHistory. The journal remains available if PostgreSQL is unavailable.

The scheduler checks each minute for Sunday 02:00 Asia/Bangkok eligibility and catches up after downtime. Weekly failure backoff and upload retries are hourly. Retention protects the newest 12 verified weekly sets and all pending uploads. Manual/rollback sets have separate 12-set retention. During an outage, more than 12 local files can remain intentionally; disk capacity must be monitored. A new failed job never replaces or deletes the previous known-good archive.

Rclone uploads encrypted bytes to a partial name, reads/hashes them, moves to the final name and reads/hashes again before recording uploadedAt and remote identity. The normal installation currently reports `Google Drive remote is not configured`. The owner must complete OAuth and set BACKUP_REMOTE, then prove actual off-device delivery and a restore of downloaded ciphertext. No credentials were invented or reused from unrelated connectors.

### Restore evidence

The final isolated test archive is `taky-20261017T013936Z-f737d445-bd37-4948-8227-ec1cfab778cf.taky.enc`, 14,853 bytes, SHA-256 `0505b8f139a002e23fbd0d6603fd03f22a0b6a158ec0a41fa586f57281911e3f`. Its separate Docker restore matched 15 rooms, two Demo tenants, two Demo leases, schema/migrations and one attachment. Source fingerprints before and after the drill matched. The test removes only its own draft tenant/lease/attachment fixtures; the verified encrypted archive remains private.

The actual normal weekly catch-up archive is `taky-20261017T013917Z-bdaa215f-6eb3-43b1-8faf-dc4d41327b73.taky.enc`, 11,142 bytes, SHA-256 `be834516b8c681903824ad8cdb582a208d2e2a0dc733d5f6a3c6164826c678af`. It restored successfully in separate project `taky-restore-4804fe0f-1cb`, with 15 rooms and zero tenants/leases/attachments. Its checksum-bound Docker receipt was written at `2026-10-17T01:40:45.414Z`. The original normal data fingerprint remained `15|2853a55f5d991773d5c8e4e175e36896|0|0|0` before deployment and after restoration.

Production recovery is a separate owner command, never scheduled. It first drills the selected archive, requires an exact typed confirmation, stops writes, creates/verifies a fresh rollback set and then restores. Database replacement is transactional; database plus filesystem replacement is not jointly atomic. If file replacement fails, services remain stopped and `rollback-production` uses the preserved, verified rollback archive after another drill and confirmation. The normal destructive path was not executed. Replacement-Mac and volume-loss steps are in `docs/backup-restore.md`.

## D. HTTPS and LAN security

Caddy 2.11.7 uses its internal CA, persistent private CA volume and a leaf certificate for the configured private IP or local name. `default_sni` with an explicit TLS policy supports IP clients that omit SNI. TLS 1.2/1.3 remain enabled. Automated verification uses the exported root and checks the requested host; no certificate-error bypass or disabled validation was introduced.

The normal deployment was verified at its current private LAN address with HTTP 200 readiness. Docker inspection shows the app, PostgreSQL and operations have empty host port mappings. Only Caddy TCP 443 is published, on the configured private interface. Caddy's admin port is not published. There is no public ACME request, redirect listener, tunnel or router forwarding configuration.

The overlay removes app HTTP publishing, forces Secure cookies and sets the exact HTTPS APP_ORIGIN. Existing CSRF/origin checking and server-side permissions are unchanged. Actual HTTPS API tests verify ADMIN login, all 15 rooms, Secure/HttpOnly/SameSite=Strict, STAFF denial, wrong-origin rejection and logout revocation.

Public root certificates were exported to private local configuration directories; CA private keys were not exported or staged. Host Keychain trust and other-device trust are not silently installed. The commissioning guide explains fingerprint verification and macOS/iPhone trust, stable local naming/IP reservations, firewall and private-network checks. A physical second Mac/iPhone test remains NOT RUN. Owner-selected normal admin setup also remains manual; only explicitly Demo accounts were used in isolated login tests.

## E. Testing results

All final tests below ran on 17 October 2026. `P25` abbreviates the actual command prefix `docker compose --env-file .env.test --env-file .local/test/operations.env -p taky-phase25-test -f docker-compose.yml -f docker-compose.test.yml -f docker-compose.operations.yml -f docker-compose.https.yml`. On this Mac, commands set Docker Desktop's PATH/socket and an ignored task-local CLI configuration. No secret values are reproduced.

| Test | Command executed | Result | Actual evidence |
| --- | --- | --- | --- |
| Host production build | `npm run build` | PASS | Next production compilation, TypeScript and route generation completed. |
| TypeScript | `npm run typecheck` | PASS | Exit 0 after regenerated Prisma client and final scripts. |
| ESLint | `npm run lint` | PASS | Includes new operations/scripts/tests; zero-warning threshold. Initial lint findings were fixed and rerun. |
| Source formatting | `npm run format:check`; Prettier on new `.mjs` files | PASS | Existing formatted source passes; new scripts formatted and linted. |
| Existing units | `npm test` | PASS | 23/23 finance and lease summary tests. Financial logic unchanged. |
| Backup/encryption/retention/schedule units | `npm run test:ops` | PASS | 8/8 tests, including wrong key/corruption, manifest checks, safe paths, retention and Sunday/backoff behavior. |
| Isolated Compose build/start | `node scripts/ops.mjs up --test`, followed by `reload --test` for finalized images/config | PASS | App/db/proxy/maintenance healthy; Prisma generation and Linux production build succeed. |
| Existing DB integration with additive migration | `P25 exec -T app npm run test:integration` | PASS | 10/10 tests in 2.99 seconds, including seed, sessions, Argon2id, role policy, validation, CRUD, concurrent leases and audit trigger. |
| Existing authenticated UI regression | `npm run test:e2e` | PASS | 36/36 in the original isolated Phase 2 fixture deployment, zero skipped/unexpected/flaky, 61.629 seconds. 30 responsive route checks and CRUD/CSV assertions. Screenshots refreshed. New HTTPS behavior is verified separately by the operational suite. |
| Initial IP-only TLS request | First `node scripts/verify-phase25.mjs` run | FAIL | No-SNI IP client received TLS internal alert. Fixed server default_sni and explicit TLS policy; final trusted request passes without client validation changes. |
| HTTPS, backup, restore, failure, retry, locks and persistence | `node scripts/verify-phase25.mjs` | PASS | Final 13/13 operational checks, `01:39:33.729Z` to `01:39:59.354Z`. Details in committed `docs/phase-2.5-verification.json`. |
| Backup history DB metadata/constraint | Included in the verification script | PASS | Persisted SHA/bytes/status/verification time match; negative bytes rejected by SQL constraint. |
| Failed backup preserves good set | Included in the verification script | PASS | Deliberately missing test key yields FAILED journal; previous encrypted archive checksum unchanged. |
| Real rclone upload/retry pipeline | Included in the verification script | PASS | Missing remote error recorded; then real local backend copy/final rename/downloaded SHA match. This is not Google Drive delivery. |
| Separate-volume normal restore | `node scripts/ops.mjs restore-test taky-20261017T013917Z-bdaa215f-6eb3-43b1-8faf-dc4d41327b73.taky.enc` | PASS | Original normal set restored in unique project; source fingerprint unchanged. |
| Normal deployment | `node scripts/ops.mjs up`; `node scripts/ops.mjs reload` | PASS | All four normal services healthy, existing volumes preserved. |
| Normal migration status | `docker exec taky-erp-app-1 npx prisma migrate status` | PASS | Three migrations, schema up to date. |
| Normal private-LAN TLS | Node HTTPS GET of configured private host with exported root CA | PASS | HTTP 200 `{"status":"ok"}` with certificate chain and host validation. |
| Actual published ports | `docker inspect --format ...` for normal app/db/proxy/operations | PASS | Empty app/db/worker mappings; only private-IP Caddy 443. |
| Final maintenance source | SHA-256 comparison of every deployed operations `.mjs` against workspace | PASS | Byte-for-byte match. rclone reports 1.75.2. |
| Google Drive OAuth/upload/download restore | Owner rclone commissioning | NOT RUN | Requires owner Google account authorization. |
| System/second-device certificate trust and login | Owner macOS/iPhone commissioning | NOT RUN | Automated custom-root validation is not device trust-store commissioning. |
| Key escrow | Owner protected off-device storage | NOT RUN | Key created privately; independent recovery copy not attested. |
| Destructive normal restore/rollback | Owner-confirmed recovery commands | NOT RUN | Production data was preserved; guard and isolated restoration tested instead. |

The initial host build stalled in the restricted process environment; a second attempt correctly rejected its active build lock. The identified workspace build was terminated, then the authorized final host build passed. New Docker bind-mounted services also had a temporary startup delay in Created state before starting successfully; a bounded bind-mount probe passed. These delays are not counted as successful verification. The final reported checks completed and no known automated test remains failing.

## F. Security review

- Encryption keys, OAuth configuration, local environment, archives, dumps and private certificates are outside tracked source. `.local` is ignored and excluded from Docker builds. The public CA is exported only for owner trust setup.
- Backup ciphertext has authenticated encryption and SHA-256 transport checks. Authentication failure stops extraction/restoration. Temporary plaintext still exists during dump/restore, so host FileVault and access controls remain necessary.
- PostgreSQL and the app HTTP listener are not exposed in the normal HTTPS deployment. Exact origins, secure cookies and server-side roles are retained. No frontend redesign or financial workflow change is included.
- Backup success requires an actual restore. Pending cloud delivery is independent of verified local success. The last good local archive is protected during failed backup/upload attempts.
- Production recovery requires a local interactive owner, an independent drill and verified rollback. Its database/filesystem sequence can require manual rollback after an interruption. The isolated restore cannot select the normal database target or normal attachment volume.
- Maintenance is privileged inside its container and uses existing database-owner credentials for full dump/restore. It has no Docker socket. These credentials and the live host remain trusted boundaries; this is not a tamper-proof or ransomware-immutable offsite archive.

## G. Open issues and commissioning

| Severity | Issue | Required action |
| --- | --- | --- |
| High | Actual Google Drive copy is not authorized or verified. Local archives alone do not cover Mac/Docker disk loss. | Owner runs rclone authorization, sets BACKUP_REMOTE, retries, confirms remote SHA/uploadedAt, then restores a downloaded archive. |
| High | Matching encryption-key escrow is unconfirmed. | Store a protected independent key copy, retain old keys during rotation and prove access to the matching key in a recovery drill. |
| Medium | Normal admin and device trust are not commissioned. | Owner chooses the first admin password, trusts the verified public root on intended devices and performs authorized login/room checks. |
| Medium | Mac sleep/Docker stoppage delays scheduled work; offline cloud delivery can expand retention. | Keep the chosen host available around Sunday 02:00, use catch-up, monitor status/heartbeat, upload errors and free disk. |
| Medium | Production DB/filesystem restore is not one transaction. | Keep services stopped on error and use the explicitly confirmed verified rollback command. Destructive normal recovery has not been exercised. |
| Medium | Privileged maintenance/database owner credentials remain a trusted boundary. | Protect host/Docker access and private credential directories. Separate runtime/migration roles can be reviewed later. |
| Low | Restore drill volumes are intentionally retained. | Inspect exact recorded projects, then remove only selected drill volumes with owner approval. No broad pruning performed. |
| Low | Future attachment writers must coordinate with backups. | Preserve atomic writes and stable hash/metadata checks; changing attachment sets must fail and retry. |

No unresolved code bug is known from the executed tests. This report is implementation verification, not an independent security audit. Guides provide exact setup, OAuth, key custody, backup/status, restore, replacement-Mac, certificate and troubleshooting procedures.

## H. Phase 3 readiness and delivery

Recommendation: **NO-GO for live financial workflows today**. The implementation is ready for independent review, but operational readiness requires a verified off-device Google Drive copy, matching key escrow and owner/device HTTPS commissioning. After those checks and explicit owner approval, Phase 3 can be considered. No Phase 3 feature has been started.

Delivery includes the maintenance source/image, three Compose overlays, Caddy configuration, additive backup-history migration/schema fields, host/verification commands, backup tests, refreshed responsive screenshots, private-safe verification evidence and documentation. The original Phase 1/2 report remains historical and links to the new operating guides.

Git delivery must append to the existing `main` history, check the expected remote head, keep force disabled and verify the resulting commit/tree. No archive, actual attachment, database, key, OAuth token or environment secret is part of the intended commit. The final response supplies the containing remote commit hash after read-back verification.
