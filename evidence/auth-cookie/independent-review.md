# Independent secure cookie review

Reviewer: `cookie_security_review`, independent of implementer `secure_cookie_fix`.
Baseline: the frozen working diff against HEAD in `/private/tmp/taky-development`.
Scope: `src/app/api/auth/login/route.ts`, `src/server/http.ts`, and `tests/auth-login-route.test.ts`.

Outcome: accepted. No actionable defects found in this change.

The login route uses the URL returned by the real `checkOrigin` implementation. That implementation parses configured `APP_ORIGIN`, rejects missing configuration with HTTP 403, and rejects an absent or mismatched request Origin before returning. Invalid configured URLs still fail closed through the existing generic error handler. An HTTPS URL enables Secure regardless of a missing, false, or misspelled flag. Explicit `COOKIE_SECURE=true` also enables Secure on HTTP. Forwarded headers and the request URL do not determine the cookie protection.

All other production `checkOrigin` call sites discard its return value. The new URL return adds no asynchronous operation or behavior change for those callers. Cookie creation remains after successful login storage. HttpOnly, SameSite strict, root path, and the eight-hour lifetime remain intact. Installed Next.js 16.4.1 cookie documentation confirms the existing awaited `cookies()` and route-handler `set(name, value, options)` usage is supported.

I inspected the actual regression tests. They execute the real POST handler, authentication implementation, and HTTP helpers. Database storage, Argon2, and Next.js cookie storage are mocked at their boundaries. The table covers HTTPS including uppercase schemes with false, absent, misspelled, and true flags; HTTP false, absent, and true behavior; forged forwarding headers; and missing or forged request Origin. Existing tests also verify complete cookie options and that storage failure cannot emit a cookie. Each test resets mocks and stubs its required environment; afterEach restores mocks and all stubbed environment values. Test cases run sequentially under the existing file configuration.

Independent execution: `npm test -- --run tests/auth-login-route.test.ts` passed 18 of 18 tests on 2026-10-23 at 06:58 local tool clock. No database, Docker, UAT, deployment, or environment secret was accessed or changed by this review. Implementation evidence records a 159-test full suite, typecheck, focused lint, formatting, and the before-fix regression; I inspected those records but did not independently rerun those broader checks.

Limits: assertions verify options passed to the cookie storage boundary. They do not demonstrate actual browser transport or reverse proxy configuration. The new tests do not directly exercise missing or malformed APP_ORIGIN; inspection confirms these paths still reject before login, and their existing behavior is unchanged. This review accepts only this secure-cookie change and does not close remaining F-09 source/admission gaps or certify overall security readiness.
