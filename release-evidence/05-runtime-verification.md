# Phase 4 RC Runtime Verification

**Status:** RC1 runtime PASS for its frozen baseline. It does not verify the current integration source; a new source-matched candidate still needs runtime verification.

## Runtime and image evidence

- Run: `448b4295a6d4`, project `taky-phase4-runtime-flow-448b4295a6d4`.
- Source checkout: `codex/phase4-production-prep`, commit `d9f6b16b5f35252414539b0996a2fe950ad2d1b1`. No tracked files changed.
- `docker compose config --quiet` passed for the exact five overlays: `docker-compose.yml`, `docker-compose.operations.yml`, `docker-compose.https.yml`, `docker-compose.evidence-validator.yml`, and `docker-compose.phase4-release.yml`.
- The runtime used these local immutable image references:

| Service            | Local image reference                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| App                | `taky-erp-app@sha256:6b6012c91d070e01df71d8f198579f480461fa6cc747e3629bbf10c76d22d655`            |
| Operations         | `taky-operations@sha256:1200074ffcd8bbe0dbadd10d6071594700dc7dcaa55363e42e0cd3e4d77866f5`         |
| Evidence validator | `taky-evidence-validator@sha256:268c85fbfa1eb1f8981713472fc9c197baf419397bce6542c4a9e2fbeb30bcb5` |
| PostgreSQL         | `postgres@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826`                |
| Caddy              | `caddy@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f`                   |

These are exact local image references. Registry publication and pullability from a deployment host have not been verified.

## Checks performed

- Fresh PostgreSQL 17 database. All 17 migrations ran as an explicit one-off command. App startup did not run migrations or seed data.
- The app, database, evidence validator, and Caddy reported healthy. The operations scheduler was not started.
- Caddy published HTTPS only on `127.0.0.1:45443`. The runtime verified health and login over the Caddy CA without bypassing certificate checks. Login returned 200, authenticated rooms returned 200, and unauthenticated rooms returned 401. The session cookie had `Secure`, `HttpOnly`, and `SameSite=Strict` flags. The app reached validator health with status 200.
- The synthetic database contained three floors and 15 rooms. The billing flow recorded actual meter readings, closed the period, prepared and issued an invoice, confirmed a payment allocation, and downloaded the receipt through the app.
- Invoice `INV-202610-0001` was issued for exactly `4680.00`. Payment was confirmed and receipt `REC-202610-0001` was downloaded.
- Both invoice and receipt PDFs were one page, had valid `%PDF-` headers and `%%EOF` markers, and rendered Thai and baht glyphs in visual review. PDFKit extraction found Thai titles but did not return the baht word or symbol as text.
- A synthetic attachment write, read, and delete succeeded in the run-specific storage volume. The mounted root used UID 1000 and mode `0700`.

## Isolation and limits

All runtime networks and volumes were unique to this run. DB, app, and validator stayed on private networks. Docker Desktop did not create a host listener when Caddy used only an internal network, so the test attached Caddy to a dedicated publish bridge with masquerading disabled while retaining the loopback-only port. This proves the local HTTPS route and does not prove full egress isolation.

The run stopped and removed only its containers and networks, without `-v`. Four new volumes remain for inspection: database, attachments, Caddy config, and Caddy data. Generated secrets and environment files were removed. The private evidence summary is `.local/worktrees/phase4-production-prep/.local/runtime-uat/448b4295a6d4/runtime-summary.json`.

This rehearsal used synthetic data and local images. It does not verify image publication, the designated production host, its certificate trust, existing volume permissions, target database compatibility, production backup recovery, deployment, or Owner UAT acceptance.

## Current integration candidate reconciliation

An independent release audit found that these RC1 images were built from the frozen Phase 4 baseline. They do not contain the separately tested persisted dashboard/report implementation or the AppShell route-label correction in the current integration snapshot. The 89/89 browser UAT ran against that newer source snapshot. Do not treat the RC1 runtime result as runtime verification for the snapshot or use RC1 as the Go-Live candidate for the current project scope.

Build a new local candidate from the exact reviewed integration commit, run the same isolated runtime checks against it, and verify the candidate source/image identity before any release decision. Registry publication and production-host pullability also remain open.
