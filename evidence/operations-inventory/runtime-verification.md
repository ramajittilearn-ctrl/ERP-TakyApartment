# Real PostgreSQL inventory verification

Recorded 2026-10-22T23:59:49.296232+00:00. Executed by main orchestrator after independent code review had accepted OPS03 conditionally on real database evidence.

Command used fresh project taky-inventory-qa-20261023 and image-only compose configuration. Runtime networking disabled, no ports, PostgreSQL data on disposable tmpfs, operations source mounted read-only from this integration snapshot. Existing application data, credentials, UAT and production were not mounted or contacted.

`docker compose -p taky-inventory-qa-20261023 -f /private/tmp/taky-inventory-qa/image-only.yaml run --rm --no-deps inventory` exited0. Exact invocation redirected output to qa-runtime.log. The earlier two interrupted builds remain historical failed/incomplete attempts. The final image-only invocation ran the real acceptance script and passed 37 explicit PASS checks.

Evidence proves all33 registered synthetic tables detect equal-row-count value changes, deletion, NULL versus empty string, large numeric precision, stable reorder hashing, exported snapshot consistency, real pg_dump/pg_restore inventory equality, and invalid v2 version rejection. Private socket PostgreSQL clusters were created by the script and cleaned up. The ephemeral runtime container was removed by --rm.

This is a genuine PostgreSQL synthetic inventory/dump/restore verification. It does not claim restoration of the actual Prisma operational database, real tenant records, off-device backup custody, intended-device commissioning, Owner UAT or production readiness. Stage3D's38-model schema requires its own later inventory version while preserving v2.
