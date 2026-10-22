# F09 request-level auth regressions

Scope is a policy-independent verification increment against the existing identifier limit of five attempts per fifteen minutes. No production code, financial rule, trusted-header policy, global cap, database, Docker project, UAT environment, or credential was changed.

`tests/auth-login-route.test.ts` invokes the real exported login POST handler, login service, input parser, origin check, JSON reader, and HTTP error mapper. Only database access, Argon2 work, and the Next cookies API are mocked. Per-file module reexports provide the existing TypeScript aliases without changing the shared Vitest configuration.

Five tests verify:

- Successful login returns HTTP 200, the literal authenticated body, no-store, and a session-cookie call with HTTP-only, strict same-site, secure, root path, eight-hour expiry, and a 64-character token.
- A caller rotating Forwarded, X-Forwarded-For, and X-Real-IP receives five identical 401 responses then 429 for one identifier. Every response has no-store and no Set-Cookie; no cookie call occurs. The in-memory mocked storage records by the actual throttle key supplied by login.
- Throttle cleanup failure and throttle query failure each return generic HTTP 500 with no-store and no cookie. User lookup, password verification, and session transaction are not reached. Logs contain exactly request_failed and Error, without the synthetic secret-bearing exception message.
- Session transaction rejection returns the same generic HTTP 500, no-store, and no cookie after password verification. Logs contain only the error type.

Verification limits: these tests exercise application control flow through real Request/Response objects. Mocked storage does not prove PostgreSQL atomicity, rollback, concurrency, or committed session absence. Mocked Next cookies verifies the protected-cookie call contract; it does not prove framework cookie serialization or a browser session. Existing database integration tests remain the authority for actual persistence and concurrent attempt counts. F09 remains partial pending its other requirements.

Checks executed:

- `node_modules/.bin/vitest run tests/auth-login-route.test.ts` exited 0; five tests passed. Output is in focused-vitest.log. An earlier `npx vitest run tests/auth-login-route.test.ts` also exited 0 with five passing tests.
- `node_modules/.bin/prettier --write tests/auth-login-route.test.ts` exited 0.
- `node_modules/.bin/eslint tests/auth-login-route.test.ts --max-warnings 0` exited 0.
- `npm run typecheck` exited 0. TypeScript reported no errors.

Independent review and integration are owned by the orchestrator. No local commit was created by this implementer.
