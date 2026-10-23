# Independent payment API design review

Reviewer: `payment_api_design_review`. Date: 2026-10-23. Source baseline: `0e4e3020b7fa2a448387358c74c9045f91738026` plus the proposed `payment-api-contract.md`. This review changes only this report. It does not approve transport implementation or claim database, browser, or release verification.

## Opinion

Accepted for implementation. The proposed transport design preserves the accepted financial service boundary. No material financial, security, or correctness blocker was found. The designer corrected all three bounded documentation and verification clarifications below, and this reviewer verified the saved corrections. This acceptance covers the design only.

1. DR-API-01, ownership count. The contract describes eight endpoint files, but its eight operations occupy seven route files because GET and POST `/payments` share `route.ts`. List the exact seven files so implementation ownership and review coverage are unambiguous.
2. DR-API-02, replay meaning and current authorization. State explicitly that replay returns the originally stored DTO, even after a later payment transition. Current state comes from GET. Extend the planned real-session PostgreSQL checks to expired and disabled sessions, and an ADMIN demoted to STAFF before confirmation replay. `sessionActor` checks current session expiry and user disablement. `command` calls `authorize` before reading `PaymentCommand`, so replay must not bypass current role restrictions. These additions verify existing behavior and introduce no financial policy.
3. DR-API-03, identifier wording. Replace "normalizes command UUIDs" with the exact identifier names `leaseId`, `paymentId`, and allocation `invoiceId`. `commandKey` is trimmed text of 8 through 100 characters, retains case, and is not a UUID. The transport must not lowercase command keys.

## Contract checks

The seven expected owned route files are:

- `src/app/api/v1/payments/route.ts`, GET and POST.
- `src/app/api/v1/payments/[id]/route.ts`, GET.
- `src/app/api/v1/payments/[id]/confirm/route.ts`, POST.
- `src/app/api/v1/payments/[id]/cancel/route.ts`, POST.
- `src/app/api/v1/payments/[id]/reverse/route.ts`, POST.
- `src/app/api/v1/receipts/[id]/route.ts`, GET.
- `src/app/api/v1/outstanding-balances/route.ts`, GET.

The optional `src/server/payments/query.ts` owns URL adaptation only. The owner may add transport tests. Shared HTTP/auth code, payment service policy, Prisma, migrations, invoice handlers, and UI remain outside this assignment. Existing dynamic resource routes accept a bounded resource enum and do not provide a competing payment writer.

Full command validation remains required after rebuilding path commands. The confirm schema's object refinement rejects duplicate invoice IDs after UUID normalization. The proposed shape-derived strict body does not retain that refinement by itself; parsing the reconstructed complete `confirmPaymentInput` restores it before the service call. Create uses the complete refined create schema. Cancel and reverse can safely use the unrefined object schema's `.omit` and then the full command. Unknown body fields, including a matching `paymentId`, remain errors.

The proposed mutation order matches existing invoice handlers: exact configured Origin, genuine session resolution, strict body/path validation, then the public payment service, all inside `handle`. Reads use the same session boundary and no-store response. Service `authorize` reloads the current database user and verifies enablement and role. The command helper performs this check before replay. No new arbitrary Actor construction, role from JSON, Prisma write, financial arithmetic, receipt cancellation route, or transport retry is authorized.

Idempotency is actor-scoped by the database key `(actorId, commandKey)`. Stored operation and canonical request fingerprint must also match. Confirmation sorts validated allocations before fingerprinting. HTTP success status remains the endpoint's status for both execution and replay. The existing service returns its historical stored command result, rather than reconstructing a current payment DTO. The proposed error table matches the inspected `AppError` and shared Zod/Prisma mapping, including the existing `PAYMENT_NOT_FOUND` code for an absent receipt.

List parsing retains repeated-key evidence, rejects unknown keys, validates pagination lexically before number conversion, and finishes with the actual bounded list schemas. It does not coerce monetary strings or use current tenant assignment to calculate historical balances.

## Evidence and limits

I read actual `payments/contracts.ts`, `index.ts`, relevant `service.ts` command, authorization, read and confirmation logic, `http.ts`, `auth.ts`, resource validation, existing invoice and generic resource route handlers, payment integration fixtures, the integration test configuration, and the approved Stage 3D contract and policy checkpoint. I read this checkout's AGENTS instructions, the installed Next route-handler guide, and installed Pstack Codex adapter, architect method and design red flags, TypeScript/type-system guidance, and unslop. This is an independent review assignment. I did not run additional design candidates or claim unavailable Cursor agent/model routing.

Executed one read-only local Zod probe with `node --import tsx --input-type=module -e ...`. It imported actual payment schemas and returned exit 0 with all five assertions true: confirm `.omit()` throws; shape-derived strict body parses; full reconstructed confirmation rejects duplicate upper/lower UUID aliases; the body rejects `paymentId`; cancel `.omit()` works. This proves the proposed schema derivation approach against the installed Zod version. It does not prove route implementation.

The required real-route PostgreSQL plan correctly preserves actual HTTP wrappers, payment services, and stored sessions. Only Next cookie access may be mocked to supply a genuine token. The plan requires STAFF create, ADMIN confirmation and receipt read, replay without duplicate records/audits, changed-request conflict, STAFF transition denial, stale version, exact partial/reversed balances, and linked cancellation. The corrected plan also includes the current-session/role cases in DR-API-02. Fresh attested synthetic database guards must remain intact. Existing domain database tests and prior 172-unit/91-old-module results are separate inputs supplied by Main, not tests executed by this reviewer.

Transport implementation, financial route tests, independent code review, complete regression checks, generated Next route checks/build, and local commit remain pending. Owner UAT and production readiness remain separate gates.

## Correction verification

Re-read the corrected saved contract on 2026-10-23 after Main relayed the designer's handoff. DR-API-01 is closed by the seven exact owned paths and corrected seven-file ownership statement. DR-API-02 is closed by the explicit historical replay/current GET distinction, authorization-before-replay requirement, and actual-session PostgreSQL cases for expiry, disablement, demotion, and original PENDING replay after confirmation. These match `sessionActor` and the payment command helper inspected above. DR-API-03 is closed by naming the normalized UUID fields and explicitly preserving command-key case. No remaining design findings. The listed tests remain planned until the implementation owner executes them.
