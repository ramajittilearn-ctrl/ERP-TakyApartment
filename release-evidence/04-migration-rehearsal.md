# Database Migration Rehearsal

**Status:** NOT VERIFIED for the production target.

## Local evidence

The Stage 5 isolated runtime started a fresh PostgreSQL 17 database and applied all 17 Phase 4 RC migrations through an explicit `db:migrate` command before app startup. The app did not migrate or seed on startup. The Stage 6 browser UAT also applied the same 17 source migrations to a fresh synthetic database before seeding 15 synthetic room identities.

The Stage 3 synthetic restore reported 44 tables and 17 migration checksums. The independent backup review matched those checksums to the release source.

## Target rehearsal remains open

The designated production host, database, backup, and attachment volume are not identified. No production database was cloned or migrated. These fresh-database checks do not establish how the RC behaves with the target's existing schema, migration history, financial rows, constraints, or retained evidence.

Before cutover, clone a fresh target backup into an isolated environment, reconcile every migration name and checksum, run all migrations without seed or blind history resolution, and verify financial and referential integrity. Keep the source target unchanged.
