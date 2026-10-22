# Stage 3C test plan

Stage 3C-2 verification uses synthetic data in a dedicated PostgreSQL 17 container, `taky-stage3c2-db`, database `taky_phase2_test`, user `stage3c_test`, reachable only through loopback port 55432. The local runner checks URL and database identity before migrations, fixtures or integration tests. Task credentials are ignored under `.local`, never committed or printed.

## Requirement coverage

| Requirement | Verification |
|---|---|
| D-04 exact raw aggregation | Unit tests preserve reduced fractions, high precision products, recurring rent, positive/negative HALF_UP ties, final-only rounding and display reconciliation. Existing Stage 3A tests remain unchanged. |
| D-11 contractual proration | Full 28/29/30/31-day months, inclusive move-in/out, leap/non-leap February, invalid/no-overlap dates and raw rent fractions. |
| D-01 selected rates | Separate water/electric selections, scope, missing rates, expired/future rates, mid-month overlap, immutable selection history, ADMIN-only mutation and atomic audit. |
| D-02 identifiable estimates | Explicit approved quantity/reason/evidence/context, no fake MeterReading, scale rejection, STAFF denial, actual/estimate conflict and explicit open-period actual supersession. |
| D-03 replacement | Same-meter verified differences; external-evidence quantity supported by canonical opening; complete physical-meter set; duplicate/source misuse; evidence scope/date/role; stale source rejection. |
| D-13 zero rent | Structured non-issuable result; no replacement rent or charge is invented. |
| Occupancy/source allocation | Overlapping leases, unapproved partial-month allocation and multi-period gaps block. ADMIN-approved per-lease actual quantities retain evidence, overlap occupancy and cannot exceed verified room usage in aggregate. Unit tests cover exact milliunits, duplicate leases, both nonoverlapping date directions and precision limits. PostgreSQL tests passed for turnover, aggregate-limit concurrency and post-tenancy rejection. |
| Source snapshots | Determinism, portable canonical ordering, SHA-256 source fingerprint, detached inputs/results, full approval/rate/reading provenance. |
| Read-only preview | Repeated preview equality plus unchanged invoice/item/reading/approval/audit counts; actual PostgreSQL READ ONLY transaction. |
| Closed periods | Pre-close validation and post-close read-only preview; missing closed input sets stay incomplete; service and DB rejection of retrospective approvals; close/approval concurrency. |
| Transactions and RBAC | Concurrent revision uniqueness, STAFF service/DB denial, simulated audit failure rolls back both approval kinds, clean retry starts at revision 1. |
| Stage 3A/3B regressions | Existing unit and isolated PostgreSQL suites, including closed-successor correction integrity. |

## Verification sequence and reporting

Run pure unit tests and typecheck, lint and formatting. Apply reviewed migrations only to the identity-verified isolated database, then run focused billing integration followed by existing relevant PostgreSQL regressions. Check migration status and schema drift. Build the production Docker image locally without deployment. Record exact final commands/counts and any failed intermediate checks in `STAGE_3C2_TEST_REPORT.md`.

HTTP checks, if run, use only an isolated instance against the same test database. No rendered UI changed in Stage 3C-2; a broad browser rerun is not required for pure calculation/API logic. Historical Stage 3B full Playwright remains 14/15 and must not be restated as a pass.

Final local checks passed with 111 unit tests. Final PostgreSQL checks passed with 23 focused billing tests and 62 full integration tests. All 10 migrations are applied with zero drift on isolated targets. Final production build and HTTP results are recorded in `STAGE_3C2_TEST_REPORT.md`; the earlier intermediate-source build does not substitute for them.

## Continuing gates

F-04 and F-08 remain operator-rollout/pre-release gates. F-05 remains a low-severity history timestamp follow-up. F-06 remains mandatory before actual billing on the intended target. Stage 3C-3 must separately verify validated close/freeze, invoice uniqueness/revisions, issuance/void authorization and immutable financial snapshots. Stage 3C-4 owns full browser/UAT and final integration closure.
