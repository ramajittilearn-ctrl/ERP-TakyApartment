# Phase 4 RC Runtime Verification

## Latest exact-head Stage 5 runtime — PR run 40516323826

This opening section records the latest Stage 5 PR run. All following runtime sections are historical snapshots; any “Current” or “Latest” wording in an older heading refers to that section's own run and commit.

PR run [40516323826](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40516323826) passed Stage 5 at head `8034b35bd7b5ac6c7e5d1b63c60d1ec5b883015c`. Artifact [12739937173](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40516323826/artifacts/12739937173) records 52 passing checks and all 17 migrations, including isolated synthetic invoice/payment/receipt/PDF verification. Its generated `bahtGlyphVisualConfirmation` field remains `pending`; two independent reviewers separately inspected `invoice-page.png`, `receipt-page.png`, `invoice-after-source-change-page.png`, and `receipt-after-source-change-page.png`, confirmed clear `฿` glyphs and no clipping/overlap, and found before/after pages visually consistent. This visual review applies only to these synthetic artifacts and is not Owner UAT.

**Prior recorded status:** Source head `70ae6569c136d1b93f9f56bdcf92db823832471a` passed all four jobs in PR run `40450971948` and push run `40450966334`. Stage 5 passed 52 checks/17 migrations including receipt layout; container verification and Agent UAT passed. Production-target runtime remains unverified.

## Historical exact-head PR Stage 5 runtime — run 40450971948

PR run [40450971948](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40450971948) passed Stage 5 at head `70ae6569c136d1b93f9f56bdcf92db823832471a`; artifact [12710876314](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40450971948/artifacts/12710876314) records 52 passing checks and 17 migrations. The merge checkout is `4fae38cd2eb8904f9c178d1d8cdfbccfc41565cb`, tree `7b8115c37d182e95ca4cdb9487b2a2ef5442b6ee`. The added receipt bbox-layout comparison passed using the same `CreationDate` normalization as invoice layout. Synthetic totals and immutable invoice/receipt snapshots match; see exact details in the run artifact. The artifact generator leaves its visual glyph status marked `pending`, since rendering metadata itself does not perform independent visual review; an independent reviewer subsequently inspected all four rendered pages and confirmed readable Thai/฿ glyphs, correct totals and no clipping/overlap. The matching push Stage 5 and both PR/push container-verification jobs subsequently passed; see exact-head evidence below.

## Prior completed exact-head Stage 5 runtime — push run 40449611565

[Run 40449611565](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40449611565) passed Stage 5 on exact source head and checkout `074bcf2abcbef41de30a402af6bd2cdc085b3bf0`, tree `0e7bc022b3b6b73c703ae478b19bfafb229ca36e`. Artifact [12710475262](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40449611565/artifacts/12710475262) reports 52 checks passed with all 17 migration validations. PR run `40449618114` also passed. The synthetic billing flow retained rent `1000.00`, calculated `1050.01`, reconciled displayed lines by `-0.01`, and matched confirmed payment, allocation, and receipt amounts. Invoice/receipt snapshots and labels remained stable after source mutation; invoice layout and both PDFs' extracted text matched; unauthorized receipt access returned 401. Independent review inspected the four rendered pages and confirmed legible Thai/baht glyphs and no clipping/overlap.

Both Stage 5, container-verification and Agent UAT jobs passed on this head in the PR and push workflows. Their evidence is linked in STATUS and the Agent UAT report. These checks remain synthetic and do not verify production-target runtime.

## Prior exact-head Stage 5 runtime — run 40447771982

[Run 40447771982](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40447771982) passed Stage 5 on PR head `1715628a562f809f766840463aabf8c78e49761e`. Artifact [12709645744](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40447771982/artifacts/12709645744) binds the run to merge checkout `068546e2d16938c69b553648b780d4a137547427`, tree `ea37b7ab4f2cb8472dec77252e37ab17b2d16e8f`. All 52 run checks passed, including all 17 migration validations on a fresh isolated PostgreSQL database.

The synthetic scenario retained tenant rent `1000.00`, computed invoice/payment/allocation/receipt total `1050.01`, and reconciled displayed lines `1000.00 + 20.01 + 30.01 - 0.01`. It checked secure session cookies, staff/admin billing-period authorization, idempotent invoice issue, immutable invoice/receipt snapshots, and anonymous receipt-PDF denial. After mutating synthetic tenant, property, room, and lease source data, the fingerprints and frozen labels stayed stable. The new assertion compares extracted text for both invoice and receipt PDFs and invoice text bounding-box layout; it intentionally excludes PDF metadata and does not assert receipt layout or full graphic styling. Independent reviewer inspected the rendered invoice and receipt pages and confirmed Thai/baht glyphs and no visible clipping. These are synthetic CI checks, not production-target runtime or Owner acceptance. The current PR run passed container verification and Agent UAT; the matching push run exposed the metadata-sensitive assertion described below.
The separate push workflow [40447766451](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40447766451) used the same source commit and tree but ran the pre-mutation and post-mutation invoice PDF creation across adjacent seconds. Its [failure artifact 12709074906](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40447766451/artifacts/12709074906) shows `pdftotext -bbox-layout` differed only in the `CreationDate` metadata line; the text and bounding boxes were unchanged. This exposed a test-harness bug, not an invoice-content change. The correction was validated at head `074bcf2` by both push and PR Stage 5 runs (`40449611565` and `40449618114`). At head `70ae656`, the added receipt layout comparison passed in both PR and push Stage 5 runs (artifacts 12710876314 and 12710797148).

## Prior exact-head Stage 5 runtime — run 40401983977

[Run 40401983977](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40401983977) passed all four required checks on PR head `87c3ec827da110afb3cf547398708b408556fff6`. The Stage 5 artifact is [12694192757](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40401983977/artifacts/12694192757). Its run summary binds the test to merge checkout `df63cab9244bf4464156e9aa1afe6159bd372e8a`, tree `092bdbb13586302381edf8a8d78ab91ee441b316`; the 17 migration names/checksums were compared on a fresh isolated PostgreSQL database.

The 51 recorded checks passed with no failures. The synthetic flow retained entered rent `1000.00`, calculated final total `1050.01`, issued one invoice, allocated and confirmed the matching payment, and issued one receipt. The invoice PDF visibly lists rent `฿1,000.00`, water `฿20.01`, electricity `฿30.01`, and rounding adjustment `-฿0.01`, reconciling to `฿1,050.01`. Rendered-page inspection showed separated adjustment label/amount and readable Thai/baht glyphs. Invoice and receipt snapshots remained unchanged after live source edits; unauthorized receipt PDF access returned 401; isolated runtime resources were removed. These are synthetic CI checks, not production-target or Owner acceptance.

## Historical exact-head Stage 5 runtime — run 40398283420

[Run 40398283420](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40398283420) passed all four required checks on PR head `cec582fa73f3e57f92eca422cb9c2bb7ee6940b4`. The Stage 5 artifact is [12689470944](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40398283420/artifacts/12689470944). Its run summary binds the test to PR head `cec582f`, merge checkout `e9e8864e6f7a289eae8224790e2390ded453cf70`, and tree `faf5e5cdf2515dac44cd8b10bef0d685b32533e2`; the 17 migration names/checksums were compared on a fresh isolated PostgreSQL database.

The 51 recorded checks passed with no failures. The synthetic flow retained entered rent `1000.00`, calculated final total `1050.01`, issued one invoice, allocated and confirmed the matching payment, and issued one receipt. The invoice PDF visibly lists rent `฿1,000.00`, water `฿20.01`, electricity `฿30.01`, and rounding adjustment `-฿0.01`, reconciling to `฿1,050.01`. Rendered-page inspection showed separated adjustment label/amount and readable Thai/baht glyphs. Invoice and receipt snapshots remained unchanged after live source edits; unauthorized receipt PDF access returned 401; isolated runtime resources were removed. These are synthetic CI checks, not production-target or Owner acceptance.

## Prior hosted current-source image check — run 40356454371

Run [40356454371](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40356454371) passed `container-verification` on PR source head `8ca7f4fff329fa15bc9095208911120ea2074088`, merge checkout `a3268cc17ca2f59f641548dec5bdc41998c42662`, tree `1da11b27793408670b879c5c9edb352f15f275cf`. It built pinned app, validator, and operations images on an isolated GitHub `ubuntu-24.04` runner for `linux/amd64` and checked the fresh database/app health with 15 seeded rooms plus validator rejection of an invalid token (HTTP 401). It also completed synthetic encrypted remote upload, read-back, and isolated restore. The restore contained 15 rooms and Attachment owner links; the restored attachment SHA-256 matched `68e533fab04c85212338f91bd9dc0acf508f772764fea84333f966cd7275ffd4`.

This older hosted image-smoke harness is narrower than the exact-head Stage 5 application runtime above. It does not verify billing/PDF behavior, production data, off-device storage or key recovery, published image pullability, or an application-level attachment download-authorization endpoint. CI-local image IDs and vulnerability findings are recorded in `08-container-security-remediation.md`.

## Prior hosted current-source image check — run 40360707470

Run [40360707470](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40360707470) passed `container-verification` on PR head `76860a474faf49fbcc5292284df4c274619ed4e7`, merge checkout `01fa4f15872f33293987c251bb4c5265297894a7`, tree `12e0273957b19e08c11e2e534cd0b739b8ab451c`. The CI report confirms pinned app/validator/operations images built on isolated `linux/amd64`, fresh database/app health with 15 seeded rooms, and invalid validator token rejection with HTTP 401. Synthetic encrypted remote upload, read-back, and isolated restore passed; restored Attachment owner links were present and file SHA-256 matched `68e533fab04c85212338f91bd9dc0acf508f772764fea84333f966cd7275ffd4`. Agent UAT also passed 90/90 in this run (artifact `12667957853`). The limitations above continue to apply: no full billing/PDF flow on this source, production recovery, off-device key recovery, published image pull, or application download-authorization test.

## Prior hosted current-source image check — run 40362968827

Run [40362968827](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40362968827) passed `container-verification` on PR head `aa171b8e0273e86e77212bf56972d0a2bab89b6e`, merge checkout `08eaa89ed5258b1c1c22a80f649db882afe574aa`, tree `1beb81abad4ad5643f800451e6d72b5f7e2eb009`. The CI report confirms pinned app/validator/operations images built on isolated `linux/amd64`, fresh database/app health with 15 seeded rooms, invalid validator token rejection with HTTP 401, and synthetic encrypted remote upload, read-back, and isolated restore. Restored Attachment owner links were present and file SHA-256 matched `68e533fab04c85212338f91bd9dc0acf508f772764fea84333f966cd7275ffd4`. Agent UAT passed 90/90 in this run (artifact `12668289110`). The full Stage 5 billing/PDF flow, production recovery, off-device key recovery, published image pull, and application download-authorization test remain unverified on production.

## Prior hosted current-source image check — run 40365071119

Run [40365071119](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40365071119) passed all three CI jobs on PR head `54ecf19a89f03b403c46466e2f3247c14d2cf22c`; the container source checkout was merge commit `b4a9edc18aac982bf5d01f800236dc90b9e1f871`, tree `ba053d47edfc175b7157c154b533267d4686aa9b`. The job built pinned app/validator/operations images on isolated `linux/amd64`, passed app health on a fresh database seeded with 15 synthetic rooms, rejected an invalid validator token with HTTP 401, and passed synthetic encrypted remote upload, read-back, and isolated restore. The restored data had 15 rooms and Attachment metadata owner links; attachment SHA-256 matched `68e533fab04c85212338f91bd9dc0acf508f772764fea84333f966cd7275ffd4`. Scan artifact [12670017880](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40365071119/artifacts/12670017880) was inspected separately in `08-container-security-remediation.md`. Agent UAT artifact [12671305690](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40365071119/artifacts/12671305690) reports 90/90 on merge checkout `b4a9edc18aac982bf5d01f800236dc90b9e1f871`. This does not verify billing/PDF flow, production recovery, off-device key recovery, published image pullability, or an application-level attachment download-authorization endpoint.

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

## Historical RC1/current-candidate distinction

An independent release audit found that these RC1 images were built from the frozen Phase 4 baseline. They do not contain the separately tested persisted dashboard/report implementation or the AppShell route-label correction in the current integration snapshot. Do not treat the RC1 runtime result as runtime verification for the current candidate or use RC1 as the Go-Live candidate for the current project scope. This gap prompted the exact-current-source checks below.

Registry publication and production-host pullability remain open.

## Historical current-source candidate runtime — 2026-10-26

The exact PR #2 head `3d5db3cbae5f16532a3f1e37c7dfe33026c6a966` (tree `aa5cf57c5d1fb90c5eedbdfc9775d494176123bb`) has now passed a separate isolated app/validator runtime. This is the current candidate's local evidence, not production evidence.

| Image | Local immutable digest | Source labels |
|---|---|---|
| App | `sha256:b06913e27e4d3565b671d74189ec0c57de6d5e56448f13d90899e5849dba83a7` | commit `3d5db3c…`, tree `aa5cf57…` |
| Evidence validator | `sha256:b234353c2388124b721af499a5251b90804e8d965f71959e29513ea43404aaa4` | commit `3d5db3c…`, tree `aa5cf57…` |

Run `stage5-evidence-3d5-170742` passed five-overlay `docker compose config --quiet`, explicit application of all 17 migrations, health checks, and synthetic first-admin setup. Only database, app, validator, and Caddy were started; operations was never started. HTTPS used loopback `127.0.0.1:45447`. Invalid login and unauthenticated evidence read returned 401. ADMIN evidence upload returned 201; list/read/download returned 200, and downloaded bytes matched the uploaded SHA-256. STAFF evidence read returned 200 and upload returned 403 `FORBIDDEN`. A DELETE probe returned 422 `VALIDATION`: `deposit-evidence` is excluded from the generic resource API and has no delete route. No direct database or filesystem deletion was used; the synthetic evidence remains in that run's retained volume.

Cleanup removed only this run's four containers and three networks. Port 45447 is free; four fresh run-specific volumes remain. Generated environment files, passwords, and CA material were removed. Private summaries are under `.local/runtime-uat/stage5-evidence-3d5-170742/`; the detailed HTTP probe is mode 0600. These local images have not been published or pulled from the deployment host.

### Exact-head operations backup/restore

Operations image `sha256:9a03cde45ce44892ba9bd96f01e8ef491652ae365907df7e0f59d1447a2679ea` carries OCI labels for the same commit/tree. In `stage5-ops-3d5-093500`, a one-shot manual backup completed as `SUCCEEDED`; the exact candidate operations scheduler was never started. A fresh separate restore project/database/attachment volume received the backup using a one-shot restore command. Restore verified 44 tables and all 17 source migration checksums, including 15 rooms, one synthetic tenant/lease, one deposit-evidence record, and one attachment. The restored file was 32,546 bytes and its SHA-256 matched the uploaded source evidence. The archive was 51,389 bytes and the checksum matched the backup history and restore receipt.

The first restore attempt stopped before import because a required CLI lock file could not be created in the read-only run-owned archive directory. Only that disposable copied archive directory was made writable for one retry; the encryption key remained read-only, and the retry passed. Both isolated projects' containers and networks were removed, port 45448 is free, six fresh volumes remain, and generated secrets/config were removed. This proves a source-matched manual synthetic backup and isolated restore path. It does not test scheduled backup behavior, configured off-device delivery (the Google Drive remote is not configured), recovery of production keys, or any production target. The private summary is `.local/runtime-uat/stage5-ops-3d5-093500/runtime-summary.json`.

### Exact-head scheduled backup

A separate isolated run `stage5-sched-3d5-095100` exercised one immediately due weekly cycle using operations image `sha256:9a03cde45ce44892ba9bd96f01e8ef491652ae365907df7e0f59d1447a2679ea`. The rendered service graph used only the synthetic DB/app/operations services, pinned images, an internal-only network, no published ports, `restart=no`, and a `timeout` guard of 120 seconds. The scheduler wrote one `weekly/SUCCEEDED` record and a 37,486-byte encrypted archive; the archive checksum matched its journal and `BackupHistory`. It was stopped before the next 60-second tick.

The record shows two logical `uploadAttempts`, but no network upload was attempted: with `BACKUP_REMOTE` empty, `uploadRecord` increments the logical counter and then throws before checksum/upload work or invoking `rclone`. The internal network also prevented egress. Cleanup removed the three run containers and network, retained two fresh volumes, removed generated environment/key/config files, and left no published ports. The private summary is `.local/runtime-uat/stage5-sched-3d5-095100/runtime-summary.json`. This verifies one local scheduled cycle; it does not verify Sunday 02:00 behavior across host sleep/restart, an off-device destination or key recovery, or a production target.

## Historical exact PR-head verification — run 40436826101

The current PR head `8ba32bc3d2171b8d77536d6c748d56eca8e84693` passed Stage 5 in [run 40436826101](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40436826101); artifact [12703609262](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40436826101/artifacts/12703609262) records 51 passed checks and all 17 migration validations. Synthetic billing retained rent `1000.00`, calculated `1050.01`, issued immutable invoice and receipt snapshots, reconciled payment, and verified Thai PDFs after source edits. Production-target runtime remains unverified.

## Prior exact PR-head Stage 5 — run 40439455111

The current PR head `e11ef962d0934bf1fd603cd5d15293667fb235f2` passed Stage 5 in [run 40439455111](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40439455111). Artifact [12706156418](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40439455111/artifacts/12706156418) records 51 passed checks and all 17 migration validations on isolated synthetic data. Billing retained `1000.00` rent, calculated `1050.01`, issued immutable invoice/receipt snapshots, reconciled payment, and verified Thai PDFs. This does not establish production-target runtime.
