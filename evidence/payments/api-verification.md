# Payment transport verification

Seven route files expose eight operations through the existing payment services. The payment-local query adapter rejects duplicate/unknown keys and noncanonical pagination. No schema, financial service, shared HTTP or UI changes belong to this unit.

Owner executed focused63boundary tests and full235unit tests in13files, typecheck, scoped ESLint and formatting. Independent reviewer reran63boundary tests plus lint/format and accepted without findings in api-independent-review.md.

Main created a new synthetic database taky_payment_test_2b5214bd52_routes1 in the already isolated QA2 server and attested its exact database/user/loopback endpoint before deploying all14reviewed migrations. Main then ran six actual-route tests successfully using genuine stored hashed sessions, real HTTP/auth/payment services and only the Next cookies adapter mocked. Retained immutable setup/integration logs identify the exact runs. This proves route-level lifecycle/replay/authorization/balance/cancellation behavior, including session expiry, disabled users and demoted ADMIN replay. It does not replace browser UI or full managed lifecycle concurrency tests, which have separate22case evidence.

Main ran node_modules/.bin/next build --webpack on the combined integration checkout; exit0. Raw output api-build-webpack.log includes compilation, TypeScript checks, static generation and seven dynamic payment route files. Webpack is an installed Next16.4.1 supported build mode verified by local CLI help. The prior Turbopack attempt lost its session across a usage-limit pause and has no successful completion evidence.

The scoped QA runner now selects the integrated checkout only for routes-setup/routes-integration, requires the payment-prefixed exact attested database name and no URL query, and requires zero public tables for setup. All prior baseline/payment modes and immutable sanitized log capture remain. Database credentials stay in private temporary files and are not committed.

Development, local integration, automated verification and independent code review are complete for transport. Payment UI, receipt print/PDF, owner acceptance and deployment remain incomplete. PostgreSQL driver query-concurrency deprecation warnings are retained and do not change the successful test exit.
