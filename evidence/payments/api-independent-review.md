# Independent payment API code review

Reviewer: `payment_api_code_review`. Date: 2026-10-23. Scope: the seven new payment, receipt, and balance route files, `src/server/payments/query.ts`, `tests/payment-routes.test.ts`, and `tests/integration/payment-routes.test.ts` in `/private/tmp/taky-development`. This reviewer did not implement these files or alter application code, databases, or Docker environments.

## Opinion

No findings. Accepted for the bounded Stage 3D-2A API milestone, subject to Main reconciling the complete regression checks and committing the integrated result. This does not complete payment UI, receipt PDF, Owner UAT, or production readiness.

## Review coverage

Compared the actual implementation with `docs/project-execution/payment-api-contract.md` and the accepted independent design review. Read the installed Pstack Codex adapter, poteto-mode, TypeScript and type-system guidance, independent reviewer and code-quality instructions, and unslop. Read this checkout's AGENTS.md and its installed Next 16.4.1 route-handler guide. The review uses the available Codex collaboration role; it does not claim Cursor executables or multiple provider models.

All mutations check configured Origin before session resolution, JSON parsing, and command execution. Reads resolve the session before path/query parsing and service access. Every owned handler delegates to the public payment service and uses the shared envelope and no-store error handling. No route performs Prisma writes or financial calculations. Path commands reject a body paymentId, derive field constraints from authoritative schemas, and reparse the complete reconstructed command. Confirmation retains the duplicate invoice refinement after normalized UUID handling. Command keys retain case.

The URL adapter rejects repeated or unknown keys before assigning values. Pagination must have canonical unsigned integer text, a safe integer value, and the authoritative service bounds. Empty, signed, fractional, exponent, hexadecimal, overflowing, and out-of-range values fail. Missing values retain domain defaults. Payment status is unavailable on the balance query. There is no monetary number conversion.

Reviewed actual `http.ts`, `auth.ts`, payment contracts/index, and the service authorization, command replay, detail/list/receipt/balance implementations. The real session reader checks expiry and user disablement. Payment commands recheck the current database user and ADMIN requirement before replay. Historical command results and current GET state remain distinct. Error adaptation preserves business errors and shared Prisma mapping; unexpected diagnostics contain the event and error type without account data or SQL.

## Executed checks

This reviewer independently executed the following commands in the integration snapshot. All exited 0:

- `npx vitest run tests/payment-routes.test.ts`: 63 tests passed in one file. The tests call exported handlers with native requests, real HTTP wrappers, actual query parsing and command schemas. Session resolution and service execution are mocked in this boundary suite.
- `npx eslint src/server/payments/query.ts src/app/api/v1/payments 'src/app/api/v1/receipts/[id]/route.ts' src/app/api/v1/outstanding-balances/route.ts tests/payment-routes.test.ts tests/integration/payment-routes.test.ts --max-warnings 0`: no findings.
- `npx prettier --check src/server/payments/query.ts src/app/api/v1/payments 'src/app/api/v1/receipts/[id]/route.ts' src/app/api/v1/outstanding-balances/route.ts tests/payment-routes.test.ts tests/integration/payment-routes.test.ts`: all matched files pass.

## Inspected execution evidence

Inspected the actual saved setup and integration logs, rather than treating the implementer's report as a test execution. `qa-routes-setup-2026-10-23T06-23-08.601Z-2e2ebb87-c17e-446e-8569-ff0f36020233.log` attests the isolated synthetic target `taky_payment_test_2b5214bd52_routes1`, role `taky_qa_2b5214bd52`, loopback port 55489, and zero initial public tables. All 14 migrations were applied successfully. `qa-routes-integration-2026-10-23T06-25-02.114Z-ca5128c8-5e3d-4129-bf73-917058cdcde8.log` attests the same target and records six PostgreSQL route tests passing, exit 0. This reviewer did not rerun database tests.

Read all six actual tests. Only the Next cookie access boundary supplies synthetic genuine stored session tokens; HTTP wrappers, sessionActor, payment services, database writes, and invoices execute. Assertions cover STAFF creation, ADMIN confirmation, partial balances, receipt retrieval, original pending creation replay after confirmation, confirmation replay and changed-request conflict, single payment/receipt/command/audit effects, stale version, full reversal and linked receipt cancellation, pending cancellation, STAFF transition denial, command-key case and actor scope, expired sessions, disabled users, and demoted ADMIN confirmation replay denial.

Also inspected `api-build-webpack.log`: Next 16.4.1 compilation, TypeScript phase, static generation, and final route output completed; all seven new route paths appear as dynamic handlers. This is Main's execution evidence, not an independently rerun build. Main must retain its actual successful process exit record and reconcile any earlier failed build attempts. The PostgreSQL driver log contains a concurrent-query deprecation warning; the six tests passed, and the warning is not evidence of payment failure. Browser cookie transport, payment UI, unsupported-method behavior in a running server, receipt rendering, and real operational deployment are outside these direct handler tests.

No correction cycle was required because this review found no actionable defect. Main and the implementation owner received the review outcome through the collaboration channel.
