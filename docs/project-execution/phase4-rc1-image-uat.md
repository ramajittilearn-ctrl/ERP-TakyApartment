# Phase 4 RC1 image-based UAT

Date: 2026-10-26 (Asia/Bangkok)

## Result

Automated release-candidate image UAT passed **85/85 browser tests** with zero failures, skips, or flaky results. The test application was the `phase4-2026-10-26-rc1` source commit (`89a15a1aa88e8bc1ac42ce38f653448b1a32a645`) running in its built Docker image. The database was a fresh PostgreSQL 17 volume, migrations were applied explicitly, and only synthetic seed data and test accounts were created.

The suite covered login, CSRF and role denial; room, tenant and lease flows; rent persistence; responsive layouts and accessibility at desktop, tablet and mobile widths; billing setup; meter correction; invoice lifecycle; payment allocation and reversal; receipt PDF delivery; deposit evidence upload/download; expense lifecycle and CSV export; and browser target safety. Evidence validation ran in its own internal-only network with the RC validator image.

## Backup and restore

The RC operations image also created an encrypted backup of the synthetic UAT database and restored it into a separate internal Compose project. The restore verified the schema and migration inventory and all six attachment hashes. The archive and key remain private on the test host; neither is included in GitHub.

## Harness correction

An initial image run passed 79/85. Four deposit evidence tests received the expected fail-closed `EVIDENCE_VALIDATOR_UNAVAILABLE` response because that first test harness omitted the required validator service. Two Expenses accessibility checks sampled the disabled loading state; after bringing up the complete service set, the same responsive checks passed 3/3 and the complete suite passed 85/85. No application feature or styling changes were needed.

## Release limits

This is automated Agent UAT against local image IDs, not Owner UAT or Production acceptance. It does not prove that a registry can serve the images to the intended host. No Production cutover or production database migration occurred.

The Production target remains **NO-GO** until the exact host/network and disk-versus-running configuration are reconciled; off-device encrypted backup and second-device restore are proven; the selected registry and owner-device HTTPS trust are verified; target attachment permissions are prepared; and target-bound final review is complete. Go-Live authorization for this RC is already recorded.

Detailed private logs, traces, PDFs, test accounts, backup key and encrypted archive are stored under the task's ignored `.local/phase4-prep/` directory.
