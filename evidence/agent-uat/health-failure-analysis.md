# Browser health failure analysis

Run `2cb9d14d699644c6a08f83e0` completed with 68 passes and one failure. The corrected invoice accessibility test passed. The failed `768px payments protected responsive smoke and accessibility` test stopped in the automatic `verifiedTarget` fixture before its test body ran. It does not establish a defect in the payments page.

## Evidence

- `evidence/agent-uat/combined-full-browser-corrected.log` records the failure at `tests/phase2/guarded-test.ts:68`. That branch requires `response.ok` to be false. Fetch completed with an HTTP response; a transport exception would fail at the awaited fetch instead.
- The fixture uses Node's native `fetch` with redirects rejected. It sends a fresh 64-character hexadecimal challenge to the pinned loopback origin. It rejects an unsuccessful response before parsing or verifying the target proof.
- The failed test's `trace.zip` contains `test.trace` with 50 events and no network resource snapshots. It records the fixture error but cannot reveal the native fetch response's status or body. The current fixture error also omits them. The retained evidence therefore proves a non-success response, but does not independently retain its exact status. A 503 is consistent with the health route's failure response.
- `src/app/api/health/route.ts` first queries `SELECT 1`. For a valid E2E challenge it then validates the pinned environment, queries the actual database and role, compares them to the expected identity, and signs the proof. Its catch maps every exception from those stages to the same `{status: "unavailable"}` response with status 503 and no diagnostic log.
- `standalone-1792796752266.log` records two `PrismaClientKnownRequestError` events and a pg warning about querying a client already executing a query. These entries have no timestamps or request correlation. The known-error events originate from the generic HTTP error handler, while the health catch does not log through that handler. These lines cannot identify the health exception or establish a connection-pool failure.
- The standalone server had passed initial health readiness. Subsequent tests passed their own mandatory identity proof, including the next responsive test and later payment workflows. This rules out a persistent configuration or database identity failure across the entire run. It does not rule out a transient database or server failure at the failed request.

## Conclusion and next check

The direct mechanism is a failed health response during the mandatory target attestation. The route discards the exception needed to distinguish database availability, environment validation, actual identity mismatch, or proof-generation failure. Current artifacts cannot resolve that distinction. Pool contention, resource pressure, and the pg warning are hypotheses, not established root causes.

Before the next full run, add minimal diagnostic reporting while retaining the same failure behavior. Record the unsuccessful health response's numeric status in the fixture error. In the health route, track the current stage and log only a fixed stage name, error class, and a validated error code on failure. Do not log exception messages, stack traces, URLs, credentials, challenge values, proof material, or environment values. Keep the HTTP body generic and retain the 503, exact identity checks, proof checks, and current timeouts. A successful rerun alone would not explain this failure; the diagnostics should remain available to distinguish a recurrence.

## Authorized diagnostic implementation

After the read-only analysis, the Main Agent authorized the minimal diagnostic changes. The health route now records the fixed stage, a finite allowed error class, and an optional validated Prisma or allowed PostgreSQL connection code only when `E2E_RUN_ID` is set. It still returns the same generic 503 response. The browser fixture now includes the numeric HTTP status in its failure error and preserves all attestation checks and timeouts.

`node node_modules/vitest/vitest.mjs run tests/health-route.test.ts` passed all nine cases. They cover silent production failure, safe E2E probe/configuration/identity diagnostics, identity mismatch rejection, exclusion of arbitrary thrown names/codes/values, and unchanged successful proof response. Scoped diff whitespace validation passed. No database, Docker, or browser commands were run for this assignment. These changes improve evidence collection and do not establish or fix the cause of the previous unsuccessful health response.

Main independent review checked the exact route and guard diff, and independently executed all nine focused tests plus scoped ESLint successfully. Production error JSON/status are unchanged; diagnostic values are selected from fixed sets or the bounded Prisma-code format, without exception messages or query details. The change improves evidence capture and is not claimed to fix the original unavailable response. Full built verification remains pending.
