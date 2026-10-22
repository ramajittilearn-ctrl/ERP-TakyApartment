# F-09 login throttle remediation

The audited code consumes a shared `login:global` bucket with a limit of 100 before checking the submitted identifier. Successful logins also consume that bucket. Once any combination of users reaches 100 attempts in fifteen minutes, every user receives `429 RATE_LIMITED`, including users submitting correct credentials for the first time. The identifier counter cannot prevent that shared denial of service.

The remediation removes the global bucket and retains the existing five-attempt allowance per normalized username/email in a fifteen-minute fixed window. The same counter and generic errors apply to existing, disabled, and nonexistent accounts. Password verification continues to use Argon2id and a dummy hash for missing accounts. Session creation, authorization, ADMIN and STAFF roles are unchanged. A successful login clears only its own identifier counter.

Counter updates remain atomic PostgreSQL upserts. Blocked counters saturate at six, avoiding integer overflow under sustained requests. The window expires at its fifteen-minute boundary. Each valid-format login removes expired throttle rows using the existing `windowStart` index; raw identifiers never enter this table.

## Source limits and proxy trust

The current Route Handler receives the Web Request API, which does not expose the transport peer address. Client-provided `Forwarded`, `X-Forwarded-For`, and `X-Real-IP` values cannot establish a trustworthy source in the current application configuration. This change does not interpret them as a security identity.

A source limit should be applied at a verified ingress boundary that knows the socket peer and replaces client forwarding headers. Enabling an application source limit would require a deployment contract that prevents direct app access, identifies trusted proxy hops, defines the canonical source header, validates IPv4/IPv6 addresses and chains, and proves that forged headers cannot vary the resulting source key. A single fallback source such as `unknown` would recreate the global lockout and is unsuitable.

The existing application continues to limit each normalized identifier uniformly. Username and email have separate allowances, as before, so a known account can receive at most two identifier allowances per window. Consolidating those aliases would change the relationship between a public identifier and an account and needs an explicit enumeration analysis. This remediation preserves the existing behavior.

## Storage bounds and remaining limits

Retention is bounded by the active fifteen-minute window when login traffic occurs. The table stores one fixed-size HMAC and a saturating integer per active identifier. Expired rows are removed on the next valid-format login even if no successful login occurs. No schema migration or operational data change is needed.

There is no hard upper bound on the number of distinct identifiers submitted within one window. A sufficiently high-rate spray can grow active rows and consume password-verification capacity. A hard global admission ceiling would recreate the reported availability failure; fixed hash buckets could lock out unrelated users through collisions. Both approaches were rejected. Apply a trustworthy ingress source limit before exposing this deployment to untrusted networks, and monitor active row count and login failure volume. This limitation must remain visible in the remediation report and production readiness decision.

## Verification

`tests/integration/auth-throttle.test.ts` contains the direct global-exhaustion regression plus existing/missing identifier parity, case and whitespace normalization, concurrent attempts, integer saturation, exact window expiry, expired-row cleanup, and successful-login reset. The global regression verifies both ADMIN and STAFF sessions. The test requires the isolated `taky_phase2_test` database and generates independent fixture accounts and credentials per run.

The main remediation test report records actual execution, raw evidence paths, and exit codes. This document describes the intended behavior and does not claim a passing run.
