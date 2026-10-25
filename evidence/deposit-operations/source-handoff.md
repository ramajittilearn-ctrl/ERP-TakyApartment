# Deposit operations candidate

Implementation candidate only. Root and an independent reviewer must accept the code and actual PostgreSQL evidence before integration. No database, Docker, production, UAT, network or volume operation was executed by this owner.

The isolated branch starts at f3c7081 and includes Root's migration corrections3487c6a and ee7e341 as local prerequisite commits69cd9dc and35d893d. Integrate only the operations implementation commit when those prerequisites already exist in the integration baseline. The44-model schema, ledger, Payment and migration code are not owned or changed by this implementation.

## Implemented behavior

A dedicated psql session acquires publication advisory lock73422195 before attachment inventory and before the separate exported read-only snapshot. It never takes source admission73422193. It acknowledges its actual backend PID and role, checks ownership through real same-session round trips, and pings while work runs. Connection/protocol loss aborts a shared signal and terminates protected commands. Acquisition is bounded by server5-second lock timeout and7-second client deadline. The held session has a10-minute maximum lifetime, after which it releases and fails the job. These are conservative functional bounds, not measured production capacity claims.

Backup's first file inventory, snapshot, pg_dump, streamed file copy, final inventories, metadata checks and private manifest materialization run under that session. Snapshot closes before session unlock in outer finally. The separate snapshot retains REPEATABLE READ READ ONLY and its original two-value output parser. Child commands and file-copy/hash/walk stages observe aborts. A lost owner cannot return a protected set or reach archive verification. Once the independent set has been checked and the lock released, encryption and isolated restore verification run on that set.

Every regular retained source file is included, including final orphans and destination partials. Files without Attachment metadata are reported separately in the encrypted manifest and do not become accepted evidence. Existing source bytes are not removed. Only the root Dockerfile's freshly created attachment directory receives0700 before existing ownership setup; no current volume or running deployment is modified.

Inventory v5 appends exactly DepositAccount, DepositEntry, DepositCommand, DepositEvidence and DepositDocumentCounter to frozen v4. Default inventory and exported snapshots selectv5; explicit legacy/v2/v3/v4 are supported. Historical SQL byte hashes are unchanged, including v4 SHA25648d57b48a6e65016923faaadc622ec39338c774569bf85a31a621f25568013e1.

## Checks already executed

Final focused inventory/publication unit suite passed24/24. Source syntax checks, changed-source formatting, scoped lint and whitespace checks passed. Actual local raw logs are in focused-unit-final.log and scoped-lint-final.log; initial earlier focused runs remain preserved. Initial scoped lint found Node globals missing from the repository's configured global list; explicit Node timer imports/globalThis references corrected those issues. A full sandbox operations attempt reached the existing browser-proxy test's loopback listenEPERM and has no passing full-suite result. Main must rerun the complete operations suite outside that restriction. A second lint attempt with the repository-local dependency resolution stalled; the explicit Main configuration path completed successfully. No database or browser result follows from unit tests.

## Main-owned actual acceptance

From this worktree, Main should run:

```
node --test tests/ops/*.test.mjs
docker compose -f evidence/deposit-operations/compose-qa.yaml build inventory
docker compose -f evidence/deposit-operations/compose-qa.yaml run --name taky-deposit-operations-proof-20261025 --no-deps inventory
```

The Compose candidate has no published ports, host database, external network or persistent database volume. It mounts only this worktree's Prisma source read-only and uses a1GiB temporary filesystem for fresh private PostgreSQL clusters. Retain a failed container/log and use a distinct name for a later run rather than overwriting evidence. Main alone executes these commands. No real environment file or secret is needed.

The harness preserves actual13/14/15-migration legacy/v2/v3/v4 restore cases, applies reviewed16 finite checks and17 deposit DDL, then checks44-table defaultv5 snapshot/dump/restore. It fingerprints normalized public constraints, indexes, noninternal trigger definitions/states and function definitions before and afterv5 restore. Private inventory-only synthetic deposit rows use a transaction-local replica session solely to exercise complete-row fingerprints and restore behavior; origin triggers remain installed/enabled afterward. This does not prove deposit financial lifecycle or production upload acceptance. Those belong to the independent core/evidence suites.

The same network-disabled harness creates a fresh local NOSUPERUSER role, after attesting the exact private Unix socket/database/data directory and refusing ambient libpq host/service overrides. It verifies session-vs-transaction lock exclusion/release, callback-error cleanup and real backend termination aborting protected child work. It then runs a real encrypted backup and isolated restore with a metadata-referenced synthetic file plus an orphan and destination partial, verifying all bytes and unchanged source files. No source file contents, key or financial record values are logged.

Actual PostgreSQL outcomes remain pending. Reviewers should inspect lock lifetime, all failure exits, abort propagation, historical SQL hashes and the difference between inventory-only fixtures and real accepted evidence. Broader deployment commissioning and Go-Live remain outside the Owner's current stop boundary.
