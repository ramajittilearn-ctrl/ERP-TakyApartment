# FIN-NaN-01 payment storage boundary contract

Baseline `dd7d2dc`, branch `codex/payment-finite`, worktree `/private/tmp/taky-payment-finite`. Owner `combined_uat_fix`; Main provides independent design review, real database execution, and integration. Source edits wait for design acceptance.

## Grounding and evidence

Main's actual rollback-only probe log `payment-nan-2026-10-24T04-46-16.455Z-e03d873a-cfe9-4568-9501-6a558e1ded90.log` accepted both `100.00` and numeric `NaN` in a managed pending Payment through immediate deferred constraints. It rolled back all fixtures and verified all 389 public trigger definitions unchanged. This proves a direct SQL payment storage defect. It does not establish an HTTP input bypass.

The public payment contract already accepts only positive fixed two-decimal strings within the numeric column range. The database's old `Payment_positive` and `Allocation_positive` checks and payment row/child guards rely on comparisons with zero. Those comparisons alone do not encode finiteness. Payment and PaymentAllocation each store `DECIMAL(14,2)`. That typmod already rejects numeric infinity and out-of-range values; NaN needs explicit exclusion.

Other monetary columns include room/lease rent, deposits, rates, invoice totals/items, and expenses. Expenses already explicitly exclude NaN for managed records. This bounded fix covers payment amount and allocation amount. It does not silently alter historical invoice snapshots, financial formulas, other module policies, or applied migrations. Broader storage-boundary coverage remains a separately traceable audit task.

## Candidate designs and decision

1. Add new validated CHECK constraints. This guards every database writer and retains all existing payment lifecycle triggers. Migration fails atomically on incompatible existing rows and never changes financial data.
2. Add another insertion trigger or an unvalidated CHECK. This could admit existing non-finite records indefinitely or require extra parent-lookup policy for allocations. It would increase trigger coupling and leave weaker evidence for deployment readiness.

Recommend candidate 1. The new migration is additive and transactional. It adds `Payment_managed_amount_finite` with `CHECK ("legacyUnmapped" OR amount <> 'NaN'::numeric)` and `Allocation_amount_finite` with `CHECK (amount <> 'NaN'::numeric)`. It does not replace existing checks, functions, triggers, indexes, or columns. No Prisma model shape changes are required. Independent review approved the candidate-v2 statement structure described below after candidate-v1 blocker evidence exposed an error-reporting defect.

Payment's legacy exemption preserves the existing read-only legacy classification. Allocations have no independent legacy flag, and a CHECK cannot inspect the parent payment. New allocation writes already require a managed parent through existing triggers. The allocation constraint therefore validates all stored allocation amounts. If a historical allocation contains NaN, deployment stops for explicit reconciliation. It does not rewrite that amount or reinterpret legacy financial records.

## Deployment and preservation

The migration preflights managed Payment NaN rows and all PaymentAllocation NaN rows before adding constraints. It raises a fixed prerequisite error naming the affected table, without tenant identifiers or financial values. Main must retain the error as a deployment blocker and arrange explicit audited reconciliation rather than inventing a replacement amount. Existing managed NaN blocks deployment; existing legacy Payment NaN alone does not. Existing legacy Allocation NaN blocks deployment because allocation finiteness has no row-local legacy distinction.

All preflight and ALTER statements run inside one SQL DO statement with no exception handler or outer BEGIN/COMMIT. PostgreSQL statement atomicity ensures a failed preflight or validation leaves no new constraints and preserves all rows, timestamps, fingerprints, and trigger definitions, while Prisma can retain the original prerequisite SQLSTATE. Existing finite records and legacy Payment values remain byte-for-byte unchanged. Historical migrations and their checksums remain untouched. Production migration never deletes or repairs records. New writes retain the same authorization, idempotency, decimal range, and lifecycle rules.

## Verification artifacts

- Author a guarded integration test for the dedicated synthetic payment prefix. A finite positive managed pending payment must succeed. Direct SQL NaN payment must fail with SQLSTATE 23514 and the new named constraint. Direct SQL NaN allocation must fail the corresponding named constraint using an eligible managed payment/invoice fixture. Tests must force deferred guards where needed and retain trigger origin state.
- Author an isolated migration rehearsal against a fresh dedicated target. The current baseline has fifteen migrations; this change adds the sixteenth. Preserve finite and legacy Payment fixtures and allocation rows, compare original values/timestamps and trigger definitions, then verify both constraints validated and positive/negative direct SQL behavior.
- Rehearse a prior-baseline managed Payment NaN record blocking migration without mutation, then roll back the synthetic fixture through disposable-database preparation rather than any production repair path. Use independent pristine databases or transactions; never reset an initialized database. A historical NaN allocation must likewise demonstrate the documented deployment block if a structurally valid fixture can be created without weakening production guards.
- Preserve previous applied migration bytes. Local checks are syntax, formatting, types, unit tests, and authored fixture review as appropriate. Main alone executes real PostgreSQL, Docker, build, and browser commands. Independent code and actual evidence review precede integration.

No development-complete or deployment-ready claim follows from this contract. Main's acceptance of the design and actual positive/negative migration evidence are required.
