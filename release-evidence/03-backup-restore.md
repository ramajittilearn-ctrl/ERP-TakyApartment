# Backup and Restore Validation

**Status:** Synthetic isolated restore verified; production recovery remains unverified.

## Rehearsal evidence

- Run: `db77fbc88670`
- Source: synthetic Phase 4 browser-UAT backup from prior isolated run `13d9493be958518a92fa585e`, database `taky_phase2_test`.
- Archive: `taky-20261026T052828Z-91b5c5ab-ec32-4a08-a412-6d36463a2afa.taky.enc` (469,350 bytes; SHA-256 `edc15bfc3ef2956bfa97a92b4bf608f5a516ae008d2dfff17303b3eb6566b4c8`).
- Runtime: `taky-operations:phase4-rc1-candidate`, image ID `sha256:1200074ffcd8bbe0dbadd10d6071594700dc7dcaa55363e42e0cd3e4d77866f5`.
- Target: new run-specific PostgreSQL 17 and attachment volumes, private internal-only network, no host ports, and no source database/volume mounts.
- Result: restore receipt reported inventory version 5, 44 tables, 17 migrations, and 6 attachments. All 17 migration checksums matched release source. The restore command validated the restored inventory and compared attachment hashes.
- Cleanup: only this run's containers and network were stopped and removed. Its two new named volumes were retained for inspection.
- Evidence summary: ignored local file `.local/restore-audit/db77fbc88670/audit-summary.json`; raw private logs and key are not release artifacts.

## Limits and remaining gates

This is an isolated synthetic archive restore using the Phase 4 operations image. It does not establish compatibility with the actual production schema, production attachment volume, or production keys. No off-device backup copy/key recovery was tested, and this audit did not independently read the retained volume bytes after the restore command completed. Production-target backup, isolated target-clone restore, off-device recovery, and rollback validation remain open.

**Stage 3:** PASS for the synthetic Phase 4 restore rehearsal only; NOT VERIFIED for the production target.
