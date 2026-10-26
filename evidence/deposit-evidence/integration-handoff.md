# Real evidence acceptance driver

Authored six PostgreSQL/filesystem tests in `tests/integration/deposit-evidence.test.ts`. This file was not executed by the implementer. TypeScript, scoped lint and formatting passed locally. Application source remains frozen at92131d6.

Main must first integrate the reviewed44-model schema/migration and evidence candidate in an isolated runtime candidate. The test refuses absent DATABASE_URL, non-loopback databases, any name outside `taky_deposit_test_*`, URL query/fragment or mismatched actual database/current role. It requires the actual validator listening at `http://127.0.0.1:3835` with its private64-hex EVIDENCE_VALIDATOR_TOKEN. SESSION_SECRET must be provided for the genuine stored-session case. Private values must stay in Main's owner-only QA configuration.

The file creates a fresh canonical0700 storage directory beneath the executing worktree's `.local/qa/taky-deposit-test-files-*` and points ATTACHMENT_DIR only at that synthetic fixture area. It does not reset a database or delete accepted evidence. Retained synthetic files remain after completion for inspection. It restores the original ATTACHMENT_DIR environment value when finished.

The tests exercise actual generated PNG structure through the real validator, a genuine persisted session through the framework cookie adapter, raw upload and authenticated download route bodies, accepted-only STAFF listing, same-lease real-file financial verifier, current disabled/STAFF denials, invalid-file and hard stream limit admissions, durable rolling limit, deterministic same-actor session exclusion while its raw body is held, two actors racing for the last retained-file capacity, and same-length retained-file tampering denial. The cookie accessor alone is adapted because these tests invoke route functions outside a Next request scope. Real browser/server-cookie verification remains Main-owned.

The tamper test deliberately changes only its own synthetic retained file, proves financial verifier and download denial, and restores exact original bytes and readonly mode in finally. Other retained rows/files are unchanged. This is failure injection into a synthetic fixture, not an ordinary deletion/repair endpoint.

Pending additional acceptance includes filesystem/DB failure injection with retained orphan inspection, actor/session ownership loss, publication lock versus real backup, retained restore and browser Agent UAT. No runtime success is inferred from authored assertions or compilation.
