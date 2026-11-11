# F09 security remediation status

**Status: partially implemented; production ingress and general login admission remain open.** This report reconciles the repository evidence for F09. It records implemented safeguards separately from residual risks; it does not certify production security or close F09.

## Implemented: login identifier throttling

The login service derives an HMAC key from the normalized identifier and applies an atomic PostgreSQL fixed-window counter. It allows five attempts per identifier in fifteen minutes, saturates blocked counters, removes expired rows during valid-format login, and clears only that identifier's counter after successful login. The former shared `login:global` bucket is not consumed by current code. See [`src/server/auth.ts`](../../src/server/auth.ts#L62) and the integration cases in [`tests/integration/auth-throttle.test.ts`](../../tests/integration/auth-throttle.test.ts#L51), including independent ADMIN/STAFF access after a legacy global bucket is populated, parity for known and unknown identifiers, concurrency, saturation, expiry, cleanup, and reset.

Request-level regressions rotate `Forwarded`, `X-Forwarded-For`, and `X-Real-IP` and confirm that those values do not change the tested identifier throttle key. Those tests mock storage, so they do not establish PostgreSQL persistence or concurrency. The integration tests cover those properties against an isolated database. The implementation report documents the scope and test limits in [`evidence/auth-regressions/report.md`](../../evidence/auth-regressions/report.md#L3) and its independent review in [`evidence/auth-regressions/independent-review.md`](../../evidence/auth-regressions/independent-review.md#L3).

HTTPS session-cookie hardening uses the configured origin after exact-origin validation to set `Secure`; forwarding headers and request URL do not control the decision. The recorded focused route suite and full unit suite passed, while browser transport and deployed proxy behavior were outside that verification. See [`evidence/auth-cookie/status.md`](../../evidence/auth-cookie/status.md#L3) and [`evidence/auth-cookie/independent-review.md`](../../evidence/auth-cookie/independent-review.md#L5).

## Implemented: deposit-evidence upload bounds

The deposit-evidence flow has a 5 MiB per-file maximum, a durable rolling attempt limit (default ten attempts per ADMIN in ten minutes), one active upload per actor, and a 5 GiB retained-byte ceiling. See [`src/server/evidence/contracts.ts`](../../src/server/evidence/contracts.ts#L2) and [`src/server/evidence/contracts.ts`](../../src/server/evidence/contracts.ts#L46). Admission requires an enabled ADMIN and explicit database configuration, takes an actor-scoped PostgreSQL advisory lock, records admitted attempts durably, and holds the lock through upload work; see [`src/server/evidence/admission.ts`](../../src/server/evidence/admission.ts#L17) and [`src/server/evidence/admission.ts`](../../src/server/evidence/admission.ts#L49). The evidence upload integration test verifies that invalid and oversized admitted attempts consume the durable rolling limit and that a simultaneous upload is rejected while the actor lock is held: [`tests/integration/deposit-evidence.test.ts`](../../tests/integration/deposit-evidence.test.ts#L270).

These bounds apply to the deposit-evidence upload path. They are not a general request-rate, login-work, or whole-application resource-admission limit. JSON request bodies also have an application-level 16 KiB cap in [`src/server/http.ts`](../../src/server/http.ts#L26).

## Open: general login source and work admission

Current login limiting is identifier-based, not source-based. The Route Handler cannot establish a trusted transport peer from client-supplied forwarding headers. The design explicitly requires a verified ingress that knows the socket peer, replaces untrusted forwarding values, prevents direct application access, and defines trusted proxy hops before a source limit can safely be enabled. See [`docs/auth-throttle-remediation.md`](../../docs/auth-throttle-remediation.md#L9).

There is no hard upper bound on the number of distinct identifiers admitted during a fifteen-minute window. A distributed identifier spray can therefore increase active throttle rows and Argon2 verification work. The remediation record explains why a shared global cap would reintroduce cross-account denial of service and why fixed hash buckets can collide: [`docs/auth-throttle-remediation.md`](../../docs/auth-throttle-remediation.md#L17). This availability/security tradeoff remains unresolved; this report does not introduce a new cap or policy.

## Open: production ingress verification

The repository includes a private-LAN HTTPS overlay. It removes the app's published HTTP port and publishes Caddy HTTPS on the configured bind address; the Caddy proxy is configured in [`docker-compose.https.yml`](../../docker-compose.https.yml#L3) and [`operations/Caddyfile`](../../operations/Caddyfile#L10). The documented operating path is `scripts/ops.mjs up` or `reload`, which applies that overlay; the base compose file still defines a direct app port mapping. See [`README.md`](../../README.md#L39).

This configuration is not proof of the eventual production ingress or deployment. Read-only discovery of the configured operational project found a host-address mismatch and explicitly calls for target reconciliation and a safe upgrade rehearsal: [`evidence/deployment-discovery/read-only-target.md`](../../evidence/deployment-discovery/read-only-target.md#L3). No production source-IP limiter, trusted proxy chain, direct-app isolation, or production ingress verification is claimed here.

## Required follow-up

1. Identify and verify the intended deployment target and the exact command/configuration used to expose the application.
2. Verify that only the intended HTTPS ingress is reachable and that clients cannot reach the app directly or spoof trusted source headers.
3. Decide and document a safe general login admission/monitoring policy that bounds distributed identifier spray without recreating a shared user lockout; validate its behavior under concurrency before implementation.
4. Re-run the relevant security and deployment checks against the exact candidate and target after any change.

F09 remains open until these findings are resolved and independently reviewed. Existing evidence above establishes development safeguards only within the stated test and deployment boundaries.
