# Phase 2 architecture

Browser → protected Next.js layout and JSON route handlers → validation / authorization → services → repositories / Prisma → PostgreSQL 17. The Node process also mounts a private attachment volume. There is no cloud dependency during operation.

## Boundaries

`src/server/auth.ts` owns Argon2id, opaque sessions, login throttling and account creation. `http.ts` owns origin checks, bounded JSON parsing, cookie authentication and safe errors. `validation.ts` defines the API input contracts. `services.ts` owns transactions, role policy and lease lifecycle rules; `repository.ts` owns read projections and deletion queries. Neither depends on React. `src/features/live` contains validated browser DTOs and the three persistent screens. Existing `src/demo` remains separate and is never imported by backend services.

The protected route group preserves all ten URLs. The room grid, tenant profile/tabs and lease table reuse the original CSS and accessible shared controls. Login is the only new public UI. Every API authenticates independently of the layout. Responses use decimal strings and ISO dates. List endpoints return up to 1,000 records; pagination is a future extension.

## Database relationships

| Tables | Relationships / purpose |
| --- | --- |
| Property → Floor → Room | Restrictive foreign keys; unique property code, floor number per property, room number per floor. |
| Tenant → Lease ← Room | Lease snapshots rent/deposit; partial unique index permits only one ACTIVE lease per room. Occupancy is derived. |
| SecurityDeposit → Lease | Separate received/refunded/deducted liability ledger; no financial workflow yet. |
| UtilityMeter → Room; MeterReading → UtilityMeter/User | WATER or ELECTRICITY; unique meter/period readings. |
| UtilityRate → Property | Effective-dated decimal unit prices. |
| Invoice → Lease; InvoiceItem → Invoice | Unique invoice numbers and lease/period, decimal item snapshots. |
| Payment → Lease; PaymentAllocation → Payment/Invoice | Unique references and allocations, positive amounts; future transactional allocation workflow. |
| Expense → Property/ExpenseCategory | Category identifies OPEX/CAPEX. |
| MaintenanceRequest → Room/User | Status, priority and optional assignee. |
| User → Session | ADMIN/STAFF, disabled flag, hashed opaque session tokens with eight-hour expiry. |
| LoginThrottle | HMAC identifier keys and atomic fixed-window counters, persistent across app restarts. |
| Attachment → User plus one Tenant/Lease/Payment/Expense | Metadata and private storage key; exactly one owner; upload API deferred. |
| AuditLog → User | Append-only operation metadata, not copies of PII/passwords. |
| BackupHistory → User | Status/checksum/storage metadata; backup worker deferred. |

All 22 tables have UUID primary keys and UTC creation timestamps. Mutable tables have update timestamps. All monetary values use NUMERIC, with two decimal places for money and four for unit rates. FK indexes, unique keys and checks are in the migrations. Audit rows have creation time only because updates/deletes are prohibited by a database trigger. Application-role database ownership is an initial deployment simplification: a database owner can deliberately bypass triggers; audit logging is not a tamper-proof external archive.

## Roles and API

| Operation | ADMIN | STAFF |
| --- | --- | --- |
| Read properties/floors/rooms/tenants/leases | Yes | Yes |
| Create/update properties/floors/rooms | Yes | No |
| Create/update tenants/leases | Yes | Yes |
| Delete unreferenced records / draft leases | Yes | No |
| Create additional local accounts | Yes | No |

`GET/POST /api/v1/{properties,floors,rooms,tenants,leases}/`; `GET/PUT/DELETE /api/v1/{resource}/{uuid}/`. PUT accepts a complete validated record (not an arbitrary patch). Unknown fields are rejected. `POST /api/v1/users/` creates an account; there is no public registration. `POST /api/auth/login/` and `/logout/`; `GET /api/health/` reveals only readiness.

Errors have `{ error: { code, message } }`; success has `{ data }`. Authentication 401, authorization/origin 403, missing 404, conflicts 409, body size 413, content type 415, validation 422, throttle 429. Mutations require exact `Origin` equal to `APP_ORIGIN`. No permissive CORS. Bodies are capped at 16 KiB. Passwords are 12–128 characters at account creation; Argon2id uses 64 MiB, three iterations, one lane. Sessions are random 256-bit tokens, stored as keyed SHA-256 hashes; HttpOnly, SameSite=Strict, eight-hour absolute lifetime and explicit logout revocation. No “remember me.” Secure cookies require HTTPS.

Login throttling permits five attempts per normalized username/email and 100 globally in fifteen minutes. Client-forwarded IP headers are not trusted. This trades availability under an intentional LAN denial-of-service for a bounded password-hashing workload. Expired sessions are cleaned at login. Account and role management UI, password reset and MFA are deferred; initial/admin account creation is supported.

## Data preservation

Startup applies committed migrations with `migrate deploy`, never reset or db push. Initial seed is one transaction, protected by an advisory lock. An existing TAKY property is left untouched, including intentionally deleted rooms. Fresh installation creates exactly 101–105, 201–205, 301–305 with zero rent requiring configuration. No sample people, money or passwords enter the normal database.

CRUD writes and audit records commit together. Referenced entities cannot be deleted. Only draft leases can be deleted; active leases must end or cancel. Started leases cannot move to another room/tenant or revert to draft. Competing occupancy operations use serializable transactions and room locks; the partial unique index remains the final constraint. A serialization conflict returns 409 for a deliberate retry. Demo classification must match the tenant and lease.

## Sources

Implementation checked against bundled Next.js 16.4 route-handler, cookies and authentication docs; [Prisma 7 PostgreSQL adapter](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql); [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) and [session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
