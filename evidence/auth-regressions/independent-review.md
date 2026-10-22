# Independent auth regression review

Verdict: accepted for this bounded verification increment. No blocking or nonblocking defects found in `tests/auth-login-route.test.ts` or its report. F09 remains partially resolved.

Reviewed the actual test file, login POST handler, auth service, HTTP response/error mapper, Vitest configuration, focused test output, and implementation report. The test calls the real POST handler and real auth/HTTP code. Database access, Argon2, and Next cookies are explicitly mocked. The per-file aliases return real modules, rather than replacement login/error behavior.

The forged-header test derives storage counts from the key actually passed into `$queryRaw`. Rotating all three forwarding headers still yields five literal HTTP 401 responses followed by a literal HTTP 429. This would detect a request-header-derived bucket change. It does not establish a global throttle or PostgreSQL concurrency correctness.

Both throttle storage failures verify the generic HTTP 500 body and no-store header, no cookie mutation, no credential lookup/verification, and no session transaction. Session transaction rejection verifies the same public failure after password verification. Exact structured error log assertions exclude the synthetic private exception message. The success case positively checks the protected cookie call, supporting the failure-case absence assertions.

`beforeEach` resets boundary mocks and stubs only synthetic environment values. `afterEach` restores spies and environment values. Module mocks remain file scoped under the unchanged default Vitest isolation. No real database module, connection string, or credential is used by this test. The test contains no comments or TypeScript/lint suppressions requiring a separate comment review.

Independent verification executed in `/private/tmp/taky-development`:

```text
$ npm test
> taky-apartment-erp@0.1.0 test
> vitest run

 RUN  v4.1.12 /private/tmp/taky-development
 Test Files  11 passed (11)
      Tests  146 passed (146)
   Start at  01:03:27
   Duration  9.30s
```

The command exited 0. This validates the full existing unit suite with the new file included. The implementer's typecheck, focused lint, and formatting results were read but were not independently rerun.

The review applied Pstack's Test Behavior, Not Implementation principle by checking literal observable response bodies and status codes against real exported code. Type System Discipline informed inspection of the constrained failure-stage table and the absence of unchecked casts. No production source, database, Docker project, service, or UAT environment was changed. This review does not prove transaction callback effects, rollback, committed session absence, framework cookie serialization, or browser sessions.
