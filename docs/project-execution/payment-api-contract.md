# Payment API implementation contract

Status: design proposed for independent review. No transport implementation or API verification is claimed. Baseline: isolated integration snapshot `0e4e302`, 2026-10-23. This is Stage 3D-2A, the bounded transport milestone after the independently reviewed payment domain.

## Workflow and grounding

The architecture phases for this assignment are ground, sketch, independent agreement, implement, and reconsider if the contract fails. Grounding and sketches are complete in this document. Main assigns the independent reviewer and implementation owner. The implementation owner must report deviations before extending financial behavior.

I read this checkout's `AGENTS.md`, installed Pstack `CODEX_ADAPTER.md`, architect and its upstream method and design red flags, how, TypeScript best practices and type-system discipline, technical-writing, and unslop. I read the installed Next route-handler guide at `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`. The source package is `pstack-codex/0.15.17+codex.1`. The adapter maps prompt roles to Codex collaboration agents. Cursor custom agent executables, Cursor model slugs, and cross-provider arena routing are unavailable. This assignment compares two sketches locally; it does not claim two model candidates or an executed arena. Main supplies independent design review before implementation.

Existing requests enter Next route handlers, which use `handle`, `requireActor`, `readJson`, `checkOrigin`, and `json` from `src/server/http.ts`. Authentication resolves the server session cookie. Mutation handlers enforce the exact configured Origin before authentication and body parsing. `readJson` limits the actual streamed body to 16,384 bytes and requires JSON content type. The envelope and error mapping belong to `http.ts`.

Payment services own authorization against the current database user, command replay, source/period/lease/invoice/payment locks, allocations, receipt issuance, audit, and transaction retries. Strict Zod inputs belong to `src/server/payments/contracts.ts`; `src/server/payments/index.ts` exports the public service interface. Transport must call that interface, never Prisma or `service.ts` internals. Money stays a decimal string. List outputs deliberately exclude demo and unmapped legacy rows. Balances use frozen invoice labels and retain VOID history with zero collectible outstanding.

The generic `[resource]` routes accept only properties, floors, rooms, tenants, and leases. They do not currently expose payments or receipts. Explicit payment route directories therefore introduce no competing financial writer.

## Compared sketches and synthesis

Candidate A uses seven explicit route files for eight operations and existing payment commands. Each file adapts HTTP inputs and delegates one operation. A small payment-local query parser converts URL pagination strings before invoking existing strict service schemas. Path mutation bodies derive from existing command schema fields with `paymentId` omitted, followed by complete command validation.

Candidate B uses one dynamic payment action endpoint and a discriminated operation envelope for create, confirm, cancel, and reverse. It centralizes dispatch but creates a second command vocabulary, complicates unsupported-method behavior, and departs from invoice routes and the approved Stage 3D contract. Reject B.

Choose A. The transport adds Origin/session/body/query adaptation only. Financial state has one owner. Do not add a payment repository, transport command bus, generic handler factory, independent receipt cancellation route, or alternate header idempotency implementation.

## Caller usage and endpoints

The browser creates a command key once per intended mutation, retains it through network retries, and sends it in JSON. It loads payment and invoice versions before confirmation. On `STALE_VERSION`, it reloads current data and requires a fresh deliberate command rather than silently reallocating money.

All paths below are under `/api/v1`. ADMIN and STAFF may read and create pending payments. ADMIN alone may confirm, cancel pending, and reverse. The services remain the authority for these roles and current user enablement.

| Method and path | Service | Input | Success |
| --- | --- | --- | --- |
| GET `/payments` | `listPayments(actor, input)` | Query `leaseId?`, `status?`, `offset?`, `limit?` | 200, `PaymentListDto` |
| POST `/payments` | `createPayment(actor, input)` | Existing `createPaymentInput` | 201, `PaymentDto` |
| GET `/payments/{id}` | `getPayment(actor, id)` | Payment UUID path | 200, `PaymentDto` |
| POST `/payments/{id}/confirm` | `confirmPayment(actor, input)` | Existing `confirmPaymentInput` minus `paymentId` | 200, `PaymentDto` |
| POST `/payments/{id}/cancel` | `cancelPendingPayment(actor, input)` | Existing `cancelPaymentInput` minus `paymentId` | 200, `PaymentDto` |
| POST `/payments/{id}/reverse` | `reversePayment(actor, input)` | Existing `cancelPaymentInput` minus `paymentId` | 200, `PaymentDto` |
| GET `/receipts/{id}` | `getReceipt(actor, id)` | Receipt UUID, not payment UUID | 200, `ReceiptDto` |
| GET `/outstanding-balances` | `listOutstandingBalances(actor, input)` | Query `leaseId?`, `offset?`, `limit?` | 200, `BalanceListDto` |

The seven owned route files are:

- `src/app/api/v1/payments/route.ts`, GET and POST.
- `src/app/api/v1/payments/[id]/route.ts`, GET.
- `src/app/api/v1/payments/[id]/confirm/route.ts`, POST.
- `src/app/api/v1/payments/[id]/cancel/route.ts`, POST.
- `src/app/api/v1/payments/[id]/reverse/route.ts`, POST.
- `src/app/api/v1/receipts/[id]/route.ts`, GET.
- `src/app/api/v1/outstanding-balances/route.ts`, GET.

Every success uses `{ data: result }` and `Cache-Control: no-store`, including reads and command replay. Creation replay returns the same stored result with 201, matching the create endpoint's response convention; this status does not imply a second insert. Other commands return 200 on first application and replay. Unsupported verbs use Next's default 405 behavior. No PATCH or DELETE is exported. Framework-generated 405 is not claimed to use the custom envelope.

POST create accepts exactly `leaseId`, positive two-decimal `amount`, `method` CASH or BANK_TRANSFER, offset-bearing ISO `receivedAt`, `commandKey`, and optional bank identity fields. BANK_TRANSFER requires both `externalReference` and `receivingAccountKey`; CASH rejects either field. All lengths and precision limits come from the existing schema.

POST confirm accepts exactly positive integer `expectedVersion`, `commandKey`, 1 to 100 distinct allocations of `{invoiceId, expectedVersion, amount}`, and optional `duplicateOverrideReason`. Cancel and reverse accept exactly `expectedVersion`, `reason`, `commandKey`. For cancel/reverse, derive the body schema with `cancelPaymentInput.omit({ paymentId: true })`. Confirm has an object-level uniqueness refinement, and an executed local Zod probe proves `.omit()` throws on refined object schemas. For confirm, destructure `paymentId` from `confirmPaymentInput.shape` and pass the remaining shape to `z.strictObject`. This preserves field constraints without copying their definitions. Parse that strict body, reconstruct `{ ...body, paymentId: pathId }`, and parse the complete `confirmPaymentInput` before delegation so the full uniqueness refinement executes. The service also validates its public input. A body `paymentId` is an error, even if equal to the path. Do not remove the uniqueness refinement or cast around Zod restrictions.

The domain normalizes `leaseId`, `paymentId`, and allocation `invoiceId` UUIDs to lowercase. `commandKey` is trimmed text of 8 through 100 characters, retains case, and is not a UUID. The transport must never lowercase command keys. Detail GET services already validate UUIDs. A malformed path returns 422 through the existing Zod boundary. Do not allow client actor, role, payment status, receipt number, snapshot, fingerprint, calculated balance, or legacy flags.

List query adaptation must distinguish missing values from invalid values. Absent pagination uses existing defaults offset 0 and limit 50. Present pagination accepts only canonical unsigned integer text, `0` or a nonzero digit followed by digits. Convert only after lexical validation, then enforce existing schema bounds offset 0 through 100000 and limit 1 through 100. Reject empty strings, whitespace, signs, fractional/exponent/hex notation, unsafe integers, and zero limit. `leaseId` uses the existing UUID schema and `status` uses the existing enum. Reject unknown keys and repeated keys, even repeated equal values, with 422 VALIDATION. Preserve key presence until validation; `Object.fromEntries` alone loses repeated keys and cannot meet this contract. Do not coerce money, timestamps, versions, or command bodies.

Use a narrowly scoped `src/server/payments/query.ts` for URLSearchParams adaptation if duplication would otherwise occur. It can export `parsePaymentListQuery(params)` and `parseBalanceListQuery(params)`, returning schema-inferred inputs. It must not import Next, Prisma, or payment transaction services. Reuse the existing list schemas for final parsing, and share only the actual duplicate-key/pagination conversion mechanics. This helper is transport adaptation, not an alternative source of financial policy.

## Idempotency and errors

`commandKey` remains the sole accepted idempotency field. No Idempotency-Key header fallback is implemented. Header-only requests fail the required body field. The service scopes replay by authenticated actor, operation, and canonical validated request fingerprint. Reusing one actor's key for a changed body or another operation returns 409 IDEMPOTENCY_CONFLICT. A retry must preserve its original versions and body; do not synthesize a new timestamp or key server-side. No transport retry loop wraps the service. Replay returns the originally stored DTO, including its historical state and version after any later transition. GET returns current state. Current session and service authorization still run before replay; replay cannot bypass expiry, disablement, or role changes.

Use the existing `handle` error mapping unchanged. Every handler must put Origin, session lookup, URL/path parsing, body parsing, and service execution inside `handle`; otherwise rejected input can escape the JSON/no-store boundary.

| Status | Codes or condition |
| --- | --- |
| 400 | `JSON`, malformed JSON body |
| 401 | `UNAUTHENTICATED`, missing or expired session |
| 403 | `ORIGIN`, `FORBIDDEN` |
| 404 | `PAYMENT_NOT_FOUND`, including missing receipt under the existing service convention; Prisma `P2025` becomes `NOT_FOUND` |
| 409 | `PAYMENT_STATE`, `STALE_VERSION`, `IDEMPOTENCY_CONFLICT`, `DUPLICATE_PAYMENT_REFERENCE`, `CASH_DUPLICATE_REVIEW_REQUIRED`, `INVOICE_NOT_PAYABLE`, `LEGACY_MAPPING_REQUIRED`, `ALLOCATION_EXCEEDS_BALANCE`, `PAYMENT_NOT_FULLY_ALLOCATED`, `RECEIPT_SEQUENCE_EXHAUSTED`, `RECEIPT_SNAPSHOT_MISMATCH`; mapped Prisma conflicts use `CONFLICT` |
| 413 | `BODY_TOO_LARGE` |
| 415 | `CONTENT_TYPE` |
| 422 | `VALIDATION`, schema/path/query rejection |
| 500 | `INTERNAL`, unexpected exceptions or unmapped database failures |

Errors return `{ error: { code, message } }` and no-store. Preserve service codes and messages; do not expose SQL, database metadata, request body, account references, stack traces, or session values. The existing 500 logger emits only event and error type. No new sensitive logging is needed. This table records actual service behavior; do not invent a receipt-specific 404 code or map every database exception to an alleged business conflict.

## Implementation ownership and verification

One owner edits only the seven new route files, optional payment-local query adapter, and new route tests. Main owns integration and execution records. No migration, domain/service policy change, shared `http.ts` refactor, invoice handler change, or UI change belongs to this milestone. Main reported the integrated payment/cookie snapshot passes 172 unit tests and typecheck, and old-module PostgreSQL regressions pass 91 tests across seven files on a fresh 14-migration synthetic target. The separately guarded payment database suite passes 22 tests. These are integration inputs supplied by Main, not checks executed in this read-only assignment. Main generates each implementation checkout's own Prisma client first. The owner reads the current installed Next docs before code and uses awaited route params, as existing invoice handlers do.

Focused tests call exported handlers with native Request objects and awaited params. Keep real shared HTTP functions and real payment input schemas. Boundary tests may mock session resolution and payment service execution to check transport adaptation; mark these as request-boundary evidence, not financial or PostgreSQL evidence. Assert exact response bodies, status, no-store, forwarded actor, parsed input, and zero command calls on rejected requests.

Required boundary cases cover each of the eight operations; missing authentication; Origin missing/wrong for every mutation; unsupported content type; malformed JSON; actual streamed oversized body without a trustworthy Content-Length; strict unknown fields and body/path identity conflicts; invalid UUID; missing command key and header-only key; two-decimal money; confirm duplicate UUID aliases and allocation limits; valid and invalid pagination; repeated/unknown queries; service AppError preservation; mapped Prisma conflict; and generic 500 without sensitive details. Test query conversion directly with real schemas, rather than mocking the parser.

Before accepting transport financial integration, call these actual route handlers against a fresh, explicitly attested synthetic PostgreSQL database. Use the existing real payment fixture builders and actual payment services. Mock only Next cookie access to return genuine stored session tokens, so real `requireActor` and `sessionActor` execute. Do not substitute an arbitrary Actor for the session in this integration layer. Verify STAFF create plus ADMIN confirm and receipt read, replay of create and confirm with one persisted payment/receipt/audit command, changed-body conflict, STAFF transition denial, stale version, exact balance after partial payment and reversal, and a receipt cancellation linked to the reversal. Also verify expired and disabled sessions are denied, and an ADMIN demoted to STAFF cannot replay confirmation. Verify creation replay after confirmation returns the original PENDING DTO while GET returns CONFIRMED. Verify command keys retain case. The existing 22 domain database tests remain separate evidence and do not prove these routes. Preserve database guards and never widen existing safety allowlists for convenience.

Run focused boundary tests, relevant PostgreSQL route tests, complete unit tests, typecheck, lint, formatting, and Next build or generated route type checks as supported locally. Record exact commands and actual counts. A fresh reviewer examines integrated route code, tests, and outputs; fixes return to the owner and the reviewer verifies corrections. Commit only after required checks and review. Do not call Stage 3D complete merely because transport passes.

## Dependencies and remaining scope

The accepted domain migration, generated Prisma client, reviewed v3 restore inventory, and old-module PostgreSQL regressions are integration dependencies. Main may schedule isolated transport work while those checks run, but must reconcile them before marking integration complete.

This API milestone exposes managed payment reads and commands plus immutable receipt JSON. Payment UI, Thai A4 receipt rendering, legal issuer configuration, private evidence upload, post-VOID exceptions/refunds, historical mapping, owner UAT, and production release remain separate work. The adopted defaults in `policy-authorization.md` and `stage3d-contract.md` remain authoritative. No additional owner policy decision is introduced here.

Primary source paths inspected: `src/server/payments/{contracts,domain,service,index}.ts`, `src/server/http.ts`, `src/server/auth.ts`, `src/server/services.ts`, `src/server/validation.ts`, existing invoice list/draft/void handlers and generic resource handlers, `tests/auth-login-route.test.ts`, `tests/integration/finance-foundation.test.ts`, `vitest.integration.config.ts`, `docs/project-execution/policy-authorization.md`, and `docs/project-execution/stage3d-contract.md`.
