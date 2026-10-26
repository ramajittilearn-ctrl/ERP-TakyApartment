# Phase 4 Production Readiness

**Status:** NO-GO for production cutover; safe technical preparation is in progress.

**Current stage:** Stage 7, independent release audit. Stages 3, 5, and 6 have synthetic/local evidence with the limits recorded below.

## Verified

- Remote `release/phase4` and the peeled `phase4-2026-10-26-rc1` tag both resolve to `89a15a1aa88e8bc1ac42ce38f653448b1a32a645`.
- The release tag is annotated (`e4150007e021052df75f845eaaaa595f5b4c7424`). All 20 frozen input Git objects in its manifest match.
- GitHub release `phase4-2026-10-26-rc1` remains draft/prerelease. Four downloaded release assets pass the published `SHA256SUMS` checks; the separately added `phase4-rc1-image-uat.md` matches its GitHub asset SHA-256 digest.
- PR #1 (`codex/phase4-production-prep` → `release/phase4`) remains OPEN, merge state CLEAN, and its two Phase 4 CI checks are successful. It has not been merged.
- Dashboard backend/report focused tests passed 13/13; dashboard UI/API route tests passed 5/5. Independent reviews verified the frozen invoice-room identity and dashboard date-boundary corrections.
- Full unit suite passed 422/422. Full TypeScript typecheck and production build passed; full ESLint and scoped post-correction ESLint passed. Prettier passes for all changed source/test files; repository-wide `npm run format:check` reports a style mismatch in the unchanged tracked `tests/evidence-validator-client.test.ts` file.
- `npm run build` passed with Next.js 16.4.1; dashboard and monthly report API routes are dynamic.
- `npm run test:ops` passed 86/86 after the isolated runner corrections; scoped ESLint, Prettier, and diff checks passed.
- Targeted isolated Playwright run `45bf1ec3474895bef53aea61` passed 6/6 (four deposit evidence cases plus report month selection). Docker published the validator bridge on loopback; host `/health` returned 200.
- The initial browser run proved `/api/v1/reports/monthly` redirects with 308 to its trailing-slash canonical URL. The report client and browser assertion now use the canonical path; the targeted rebuilt run passed.
- Full isolated browser run `375c9e25035bdb816c8f3a65` completed 87/88. The only failure was a dashboard assertion regex that omitted a visible space; the corrected focused run `11982a78ffdd59b646208b49` passed 1/1. This historical run is not the final UAT result.
- AppShell mode classification now distinguishes read-only Dashboard/Reports, persisted write pages (including Deposits and Deposit Entries), and demo-only Maintenance/Settings. Independent review passed; the rebuilt focused browser run `3a6fd1bd77812de011b13573` passed 1/1 across all mode groups and both deposit routes.
- Backup restore rehearsal `db77fbc88670` passed against a synthetic Phase 4 UAT archive using the RC operations image: 44 tables, all 17 migration checksums matched source, and six attachment hashes were checked by the restore command. It used only fresh isolated volumes and an internal network. Production compatibility and off-device recovery remain unverified; see `03-backup-restore.md`.
- Runtime rehearsal `448b4295a6d4` passed on local digest-pinned Phase 4 RC images. It explicitly applied 17 migrations, then verified HTTPS login, secure cookie flags, authorization, validator health, a synthetic 4,680.00 invoice, payment confirmation, Thai invoice/receipt PDF rendering, and attachment storage. Four fresh volumes remain for inspection. Images were not published to a registry; see `05-runtime-verification.md`.
- Independent release audit found the RC1 image and `release/phase4` source omit the current integration's persisted Dashboard/Reports and AppShell mode correction. The RC1 runtime pass therefore does not cover the current integration candidate. Rebuild the app image from the exact reviewed integration source and rerun Stage 5 before considering the current scope.
- Final isolated agent UAT run `2f9b8c0f424d8cb9a8152443` passed 89/89, with no failures or skips. It used a fresh synthetic database, all 17 migrations, 15 synthetic room identities, and one worker. The report records document and target-specific limits in `06-final-uat.md`.
- AppShell focused E2E passed 1/1 after a fresh standalone build and independent re-review. The initial stale-bundle failure and subsequent strict-locator issue were resolved; neither reproduced against the final bundle.
- Two E2E invocations overlapped during harness edits and one stopped before migrations/seeding. A shared lock now serializes use of the fixed ports and runner state. Cleanup targeted only the isolated test project; synthetic volumes were retained.
- Validator remains on the internal validation network without DB membership. Its test-only loopback bridge uses a separate publish network with IP masquerading disabled; independent review confirms this is not a complete egress firewall. No egress isolation is claimed. Production Compose keeps its existing internal network. Docker documents that port publishing and masquerading are separate network controls: [Port publishing and mapping](https://docs.docker.com/engine/network/port-publishing/).

## Open production gates

- Exact production host, Docker context, Compose project, canonical HTTPS origin, and target access model are not established.
- No owner-designated target database or attachments were inspected, backed up, cloned, restored, or migrated. Only read-only metadata/counts were checked in the current local `taky-erp` database; existing UAT services/databases were not modified.
- Actual target migration-history reconciliation and no-seed upgrade rehearsal remain open.
- RC1 local image identities and its isolated runtime passed. A source-matched candidate image runtime check remains open because RC1 omits current Dashboard/Reports and AppShell fixes. Registry publication and production-host pullability remain open. Target volume permissions remain open.
- Independent release audit remains open.
- Production cutover and post-deployment verification have not occurred.

## Next actions

1. Build a local image candidate from the current reviewed integration source and repeat Stage 5 runtime checks; ask the independent auditor to recheck that exact candidate.
2. Finalize and publish reviewed code/evidence on a dedicated GitHub branch and PR; keep `release/phase4` and production untouched.
3. Resolve the actual production target and target-dependent backup, migration, network, and rollback evidence before cutover. Keep Stage 8 NO-GO until exact target authorization and every safety gate are documented.
