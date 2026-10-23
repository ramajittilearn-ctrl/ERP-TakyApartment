# Version 3 restore verification

Main executed the frozen harness in image taky-inventory-qa-20261023:local with network_mode none, no ports, PostgreSQL tmpfs data, and read-only operations and Prisma migration mounts. No existing database or volume was used. Compose config is retained here as qa-v3-compose.yaml.

First runtime exited0 but independent review found VR01: the second snapshot test wrote the same value, weakening concurrency evidence. The owner fixed version-specific values and explicit live-count/hash checks. The corrected runtime exited0 and records48 PASS lines in qa-v3-runtime-attempt2.log. First log is retained rather than replaced.

The corrected test applies13actual migrations to an old33model database and14to the new38model database. It uses real exported-snapshot pg_dump and private-socket pg_restore for historical v2, unversioned legacy and current v3 archives. It proves source rows changed after snapshot acquisition, checks restored content, and detects same-count changes in all five new tables. All13named payment triggers are origin-enabled after fixture construction and restoration. Synthetic inventory-only payment fixtures used transaction-local replication mode; this evidence certifies row-content restore detection, not valid financial lifecycle. Payment lifecycle has separate22case evidence.

Main also executed all operations tests with local proxy permission:36passed,0failed, exit0, in qa-v3-all-ops.log. Independent reviewer accepted the corrected implementation and actual log, with fingerprints in v3-independent-review.md. Exact historical legacy and v2 SQL remain unchanged.

No operational recovery, offsite key custody, Owner UAT, production migration or release is claimed.
