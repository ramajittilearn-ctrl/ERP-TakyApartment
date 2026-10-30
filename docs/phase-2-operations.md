# Mac deployment and operations

This is the historical Phase 2 base/development guide. For current operational deployment, use [Phase 2.5 secure LAN](secure-lan-deployment.md) and [backup/recovery](backup-restore.md). The operations wrapper applies the required HTTPS/backup overlays; the base commands below do not.

## Prerequisites

macOS on Apple Silicon or Intel, Docker Desktop running with Compose, at least 4 GB assigned to Docker, free disk for images/database/attachments. Node 22.13+ and npm are needed for local development and generating configuration. Internet is needed to install dependencies/pull/build images; normal operation is local. Do not place a live PostgreSQL data directory in iCloud/Dropbox; Compose named volumes live in Docker's Linux VM.

On a Mac where Docker is installed but not on PATH:

```sh
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
docker version
docker compose version
```

Enable Docker's CLI tools in Desktop settings if Compose remains unavailable. If the credential helper stalls, resolve its macOS Keychain prompt. This project was tested with a task-local anonymous configuration for public images; personal Docker configuration was not changed.

## Initial deployment

From the project directory:

```sh
npm ci
node scripts/configure.mjs
docker compose up -d --build
docker compose ps
docker compose exec app node node_modules/tsx/dist/cli.mjs scripts/admin.ts
```

The configuration command writes `.env` with cryptographically random database/session secrets, permission 0600 and exclusive creation. It refuses to overwrite an existing file. The setup command prompts for username, email, display name and a hidden password twice. It succeeds only while there are no users; the database advisory lock prevents two simultaneous bootstrap admins. No default credentials or public setup route exist. Open `http://127.0.0.1:3000/login/` and sign in. Configure room rents before operational use; the seed rent is zero, not a sample financial rate.

`docker compose up` applies migrations and seeds only an uninitialized TAKY property. Startup fails if a migration fails; it does not reset an existing database. Verify:

```sh
docker compose exec app node node_modules/prisma/build/index.js migrate status
docker compose exec db psql -U taky -d taky -c 'SELECT number FROM "Room" ORDER BY number;'
```

Normal shutdown: `docker compose down` preserves both named volumes. Start again with `docker compose up -d`. Never add `-v`, prune volumes, or run `prisma migrate reset` on an operational database. Changing POSTGRES_PASSWORD in `.env` does not rotate an initialized database password; use a controlled PostgreSQL credential rotation and update DATABASE_URL together.

## Configuration

| Variable | Meaning |
| --- | --- |
| POSTGRES_DB / POSTGRES_USER | Initial local database/name; default generated values `taky`. |
| POSTGRES_PASSWORD | Random database password, required. |
| DATABASE_URL | Prisma PostgreSQL URL. Inside Compose hostname is `db`, port 5432. Keep password synchronized. |
| SESSION_SECRET | At least 32 random characters; rotation invalidates all existing sessions. |
| APP_BIND_IP / APP_PORT | Host web listener, default 127.0.0.1:3000. Never a public address. |
| APP_ORIGIN | Exact browser scheme/host/port for CSRF checks. No path. One canonical origin. |
| COOKIE_SECURE | `true` with HTTPS; `false` only for explicitly trusted local HTTP. |
| ATTACHMENT_DIR | Private mounted directory; not inside public assets. Uploads are deferred. |

The app runs as the non-root `node` user. PostgreSQL has no published host port. `database` and `attachments` are named persistent volumes. Application and database have health checks and restart policies. Docker Desktop must be running; macOS sleep stops availability.

## Private Wi-Fi / LAN

1. In macOS System Settings → Wi-Fi → connected network Details → TCP/IP, find the private IPv4 address. `ipconfig getifaddr en0` often works; use the actual Wi-Fi interface shown by `networksetup -listallhardwareports` if different.
2. Reserve that address in the router's DHCP configuration, for example `192.168.1.50`.
3. Set `APP_BIND_IP=192.168.1.50` and `APP_ORIGIN=http://192.168.1.50:3000` in private `.env`; keep `APP_PORT=3000`. Recreate only the app: `docker compose up -d app`. Open the same canonical URL from the Mac and other authorized devices. Using localhost instead will fail origin checks.

If Docker reports `bind: can't assign requested address`, check whether DHCP changed the Mac's Wi-Fi address. Update both APP_BIND_IP and APP_ORIGIN to the current private address and recreate the app. If `ipconfig` is unavailable in a restricted shell, `ifconfig en0` can show the assigned IPv4 address. Keep the router reservation consistent with the configured address.
4. System Settings → Network → Firewall → Options: permit Docker Desktop incoming connections as needed. Keep the firewall enabled. Use a trusted private network and restrict access with router/VLAN rules if only selected devices should reach the host. Application credentials enforce user access; firewall allowlisting is an additional device boundary.
5. Do not configure router port forwarding, public DNS, public tunnels or UPnP exposure. Do not publish PostgreSQL. Guest Wi-Fi client isolation can prevent access; resolve with the network administrator rather than exposing the service publicly.

HTTP does not encrypt passwords or cookies on Wi-Fi. For real tenant records on shared LANs, use a locally trusted HTTPS reverse proxy on the Mac with a private certificate, keep the app on loopback, set `APP_ORIGIN` to that HTTPS URL and `COOKIE_SECURE=true`, and install/trust the local CA on each authorized device. TLS termination/certificate distribution is environment-specific and not provisioned by this phase. Do not set Secure cookies on plain HTTP except browsers' loopback exception. No public certificate service is required. Second-device/firewall verification must be performed on the deployment network.

## Development and migrations

```sh
npm ci
npm run db:generate
npm run typecheck
npm run lint
npm test
npm run build
```

Use a separate development database. The default Compose database is reachable only by containers. To run Next on the host, use an explicitly loopback-only development override that publishes `127.0.0.1:5433:5432`, set the host process DATABASE_URL to localhost:5433, and never apply that override to LAN production. Alternatively rebuild the container during development. After setting a reachable development DATABASE_URL: `npm run dev`.

For schema changes, use `npx prisma migrate dev --name descriptive_name` only on the development database, inspect generated SQL, back up operational data, then deploy committed migrations with `docker compose exec app node node_modules/prisma/build/index.js migrate deploy`. Existing migrations are additive. Constraints intentionally protect histories; do not remove them merely to force a write.

## Reproducible isolated verification

```sh
node scripts/configure.mjs .env.test
docker compose --env-file .env.test -p taky-phase2-test -f docker-compose.yml -f docker-compose.test.yml up -d --build
docker compose --env-file .env.test -p taky-phase2-test -f docker-compose.yml -f docker-compose.test.yml exec -T app node node_modules/tsx/dist/cli.mjs scripts/test-users.ts
docker compose --env-file .env.test -p taky-phase2-test -f docker-compose.yml -f docker-compose.test.yml exec -T app node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts
npm run test:e2e
node scripts/verify-persistence.mjs
```

The test project listens only at `127.0.0.1:3300` and owns different volumes and the database `taky_phase2_test`. Test scripts refuse another database. Generated test passwords live only in ignored `.env.test`. On macOS Playwright uses installed Google Chrome; elsewhere run `npx playwright install chromium`. Tests exercise real PostgreSQL and HTTP, with no mocked persistence. They create explicitly labeled Demo records in the test database and leave audit/history records for inspection. Repeating tests uses unique record identifiers. Stop this project with the same Compose arguments plus `down`; volumes remain recoverable.

## Troubleshooting

- App unhealthy: `docker compose logs --tail=100 app` and `docker compose logs --tail=100 db`. Avoid publishing logs/config containing secrets. Never share `docker compose config` output unredacted.
- Port 3000 already used: stop the earlier frontend preview or choose another APP_PORT and matching APP_ORIGIN.
- Login fails: finish local setup, check exact credentials, disabled account, browser cookie policy and APP_ORIGIN. Rate limits clear after fifteen minutes; restarting the app does not bypass them.
- 403 on saves: check exact Origin and STAFF permissions. A second host alias is deliberately not accepted.
- 409 on saves: duplicate number/reference, another active lease, referenced deletion or concurrent edit. Reload current data and retry deliberately. End a lease instead of deleting its history.
- Missing rooms: the seed only initializes a new property and never recreates deleted rooms on restart. Use ADMIN room CRUD for intentional corrections.
- Existing database upgrade failure: preserve the volume, inspect Prisma status/logs and repair the migration plan; no automatic destructive recovery.
- Docker restart keeps database data but is not a backup. Automated dump/encryption/restore is deferred. Protect the Mac and Docker volume with the organization's backup policy before real operations.

The only persistent user-facing modules in Phase 2 are rooms, tenants and leases. Dashboard/financial/maintenance/settings pages are still isolated, clearly labeled Phase 1 demos. Do not use their totals for accounting.
