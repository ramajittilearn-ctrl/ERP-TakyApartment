# FIN-NaN-01 implementation handoff

Design accepted by Main before implementation. This work starts at `dd7d2dc` in isolated branch `codex/payment-finite`. Dependencies are an independent APFS clone; no Prisma shape change or generation was required.

The new transactional migration adds two validated CHECK constraints. Managed Payment amounts exclude numeric NaN, while existing legacy Payment amounts retain their classification. All allocation amounts exclude NaN. Fixed preflight failures block deployment on existing incompatible rows without financial repair or partial constraint installation. Previous migration files are unchanged.

The dedicated integration file authors nine cases for finite minimum/ordinary/maximum values, named NaN payment and allocation rejection, existing positive/negative infinity typmod rejection, a real finite confirmation and receipt, and validated constraints with origin-enabled triggers. These are authored assertions, not actual PostgreSQL results.

The preservation and managed-NaN blocker rehearsal requires separate pristine targets. It inserts realistic legacy data after the ten-migration historical baseline, before managed invoice insertion guards exist, and advances through baseline fifteen without changing old financial data. Preservation compares original Payment and PaymentAllocation full JSON values/timestamps and all public trigger definitions before and after migration sixteen. The blocker leaves its synthetic invalid managed row and failed migration ledger intact for review. No triggers are disabled or bypassed. Historical NaN allocation deployment behavior is documented but is not claimed as an executed rehearsal.

The fixed-target guarded QA helper and README are versioned in `qa-helper-v1/` and available at `/Users/ramajittipasutanavin/Documents/ปลูกหอพัก/ERP/.local/worktrees/recovered-payment-finite/evidence/financial-nan/qa-helper-v3/`. Main must review and execute their fresh creation/setup/integration/rehearsal/blocker modes. Syntax and local validate-plan passed without a database connection. Its immutable validation log is retained here.

Local formatting and TypeScript checks completed without errors. The existing unit suite completed with 322 passes across 20 files, recorded in `unit.log`. No PostgreSQL, Docker, application build, or browser commands ran in this implementation task. Raw TypeScript output is empty on success; no financial correctness claim relies on that log. Required actual positive/negative and migration proofs remain for Main and independent review.

Integration must reconcile the operations harness's prior fifteen-migration pin with the new sixteenth migration. Model count remains 39 and inventory v4 registry remains unchanged. That harness update is outside this owner's scoped files. Source and authored tests require independent review before integration; actual financial verification remains pending.
