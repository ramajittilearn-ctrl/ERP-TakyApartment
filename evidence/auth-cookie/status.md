# Secure session cookie hardening

The login route previously set `Secure` only when `COOKIE_SECURE` was exactly `true`. An HTTPS deployment with the flag missing, false, or misspelled issued a session cookie without the attribute.

The route now uses the parsed configured `APP_ORIGIN` returned after the existing exact origin check. HTTPS always enables `Secure`; explicit `COOKIE_SECURE=true` can also enable it for HTTP. HTTP development behavior remains compatible. Request URLs and forwarding headers do not control this decision.

Returning the already parsed URL avoids parsing configuration twice. Rejecting HTTPS configurations with a non-true flag was considered, but automatic secure cookies preserve login availability while enforcing the intended protection. This change does not change authentication, throttling, authorization, billing, or database policy.

## Executed verification

- Before the fix, the actual POST handler regression suite failed six HTTPS flag cases. Twelve other cases passed. See `before-fix.log`.
- After the fix, the focused POST handler suite passed all 18 tests. See `after-fix.log`.
- The full Vitest suite passed 159 tests in 11 files. See `unit-suite.log`.
- `tsc --noEmit --incremental false` passed. See `typecheck.log`.
- Focused ESLint passed with zero warnings. See `lint.log`.
- Focused Prettier check passed after formatting. See `format.log`.
- `git diff --check` passed.

Tests execute the real login POST route and origin validation. They mock database, Argon2, and Next.js cookie storage boundaries. They assert the options passed to cookie storage, not browser transmission or a deployed reverse proxy. No database, Docker project, UAT environment, deployment, or secrets were modified.

Independent review and the final local commit remain the orchestrator's gates. Implementation files are frozen for review.
