# Finite payment migration QA

This v3 helper is pinned to `/private/tmp/taky-payment-finite`, existing QA2 source metadata/private configuration, host `127.0.0.1:55489`, and role `taky_qa_2b5214bd52`. Main reviews and executes it. The author ran only syntax validation and local `validate-plan`, without connecting to PostgreSQL. Original helper and README remain archived as `runner.cjs.v1` and `README.md.v1`.

Use `node /Users/ramajittipasutanavin/Documents/ปลูกหอพัก/ERP/.local/worktrees/recovered-payment-finite/evidence/financial-nan/qa-helper-v3/runner.cjs MODE` with these modes:

| Mode | Exact scope |
| --- | --- |
| `validate-plan` | Validate owned private configuration, URL, and identity metadata without connecting |
| `preflight` | Attest the actual existing source database and role, without writes |
| `create-integration` | Create only `taky_payment_test_2b5214bd52_finite2`, refusing an existing database |
| `create-rehearsal` | Create only `taky_payment_test_2b5214bd52_finite_rehearsal2`, refusing an existing database |
| `create-blocker` | Create only `taky_payment_test_2b5214bd52_finite_blocker2`, refusing an existing database |
| `create-alloc-blocker` | Create only `taky_payment_test_2b5214bd52_finite_alloc_blocker2`, refusing an existing database |
| `setup` | Attest the integration target, require zero public tables, deploy sixteen migrations |
| `integration` | Attest the integration target, require sixteen applied migrations ending in the finite-payment migration, run only `tests/integration/payment-finite.test.ts` |
| `rehearsal` | Attest the pristine rehearsal target and run the preservation scenario |
| `blocker` | Attest the pristine blocker target and run the managed NaN deployment-blocking scenario |
| `alloc-blocker` | Attest the pristine allocation blocker target and run the historical allocation NaN blocking scenario |

All connecting modes first attest the actual pinned QA2 source database and role. Every mutation target is one of four fixed names. No command accepts another target. No database is reset, dropped, or reused for setup/rehearsal. Existing source and expense integration databases remain unchanged. All four targets are retained for review. Blocker targets intentionally retain their invalid synthetic records and failed migration ledger entries.

The exclusive lock is shared with the expense QA helper at `/private/tmp/taky-expenses-qa/operation.lock`. There is no automatic stale lock recovery. The child receives an explicit environment allowlist; ambient PostgreSQL variables and `NODE_OPTIONS` are excluded. `DOTENV_CONFIG_PATH=/dev/null` prevents project dotenv fallback. Actual source and target database/role must attest before the child starts. Logs are exclusively created timestamp/UUID files with credential and URL redaction. Setup is limited to two minutes; integration and rehearsals to ten minutes with child process group termination on timeout or excessive output.

The preservation scenario first applies ten historical migrations, then inserts synthetic legacy invoice/payment/allocation rows through the actual historical constraints. It advances unchanged through migration fifteen before applying migration sixteen. This creates realistic legacy data without disabling triggers or rewriting an existing managed database. Original payment/allocation JSON values and timestamps and all trigger definitions must remain unchanged. Existing legacy Payment NaN remains classified as legacy; new managed NaN must be rejected. The blocker scenario instead adds one managed NaN at baseline fifteen and requires migration sixteen to fail with the fixed prerequisite error. Its row data and triggers must remain unchanged and neither new CHECK may remain installed.

The dedicated integration test verifies three finite pending values, NaN payment rejection with its named constraint, existing infinity typmod rejection, NaN allocation rejection with its named constraint using an eligible managed invoice, real finite confirmation/receipt/allocation, validated CHECKs, and origin-enabled triggers. Existing payment lifecycle tests remain separate regression evidence. The allocation blocker scenario inserts a historical NaN allocation at migration ten through actual constraints, advances unchanged to migration fifteen, and requires the fixed PaymentAllocation prerequisite error at migration sixteen. It verifies unchanged application rows/triggers, no managed Payment NaN, and no new constraints. No guard is bypassed. Its actual outcome remains pending Main execution.

Source copies of this helper and README are preserved under the worktree's `evidence/financial-nan/qa-helper-v2/`; v1 remains intact. No actual database result follows from syntax checks or authored assertions. Main must preserve actual exit statuses and output, then obtain independent code and evidence review before integration.

Recovery note: this is the recovered historical helper template, not runnable QA authorization. Historical /private/tmp paths and identities are preserved for review only and are currently absent. Main must issue and independently review a durable-path/fresh-target adaptation before connecting. Old private files and raw QA logs were not recovered.
