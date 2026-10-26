# DCR-01 historical deposit presentation

The ledger now exposes every original SecurityDeposit field in unverifiedLegacy.rows. Amounts remain strings, including original non-finite values. Per-kind gross amounts are null if a non-finite original amount prevents determining that total; other finite totals retain exact decimal strings. No unknown amount becomes zero. Contractual Lease.deposit is separately nullable with a data-quality issue carrying the raw amount. Managed totals continue to derive only from managed entries.

The current actor may inspect original records before an explicit verified opening review. This correction never rewrites a historical value, changes old constraints, auto-infers liability or changes deposit posting policy.

DTO changes are contractualRequirement:string|null, dataQualityIssues with NON_FINITE_CONTRACTUAL_REQUIREMENT or NON_FINITE_LEGACY_AMOUNT, and unverifiedLegacy.rows plus nullable per-kind gross fields. UI consumers must show the warning and unknown totals.

A seventh authored PostgreSQL case inserts a historical NaN amount and finite refund plus NaN contractual deposit, reads them as STAFF, records a manually verified zero opening using actual retained synthetic bytes, replays the command, and compares full original SecurityDeposit and Lease JSON before and after. This case has not been executed by the implementation agent. Production evidence validation, direct SQL integrity and financial races remain separate gates.

Executed locally: four focused domain/contract unit tests passed. Explicit recorded typecheck, scoped lint, formatting and source whitespace commands exited0. No database, Docker, browser or build command ran here. The source recovery is frozen separately in e2396ed with formatting in4c07b71; the recovery manifest records that earlier baseline, not this correction.
