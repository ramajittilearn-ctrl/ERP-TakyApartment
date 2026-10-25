# Deposit API and UI candidate

Main accepted the interface sketch before implementation on 2026-10-25. The candidate starts from Main `45bc4b6`, reviewed core `ee7e341` and retained evidence `8ee42ab`, integrated through `a396d76`. The implementer owns the new API adapter, pages and deposit feature. Main retains core, evidence, schema, migration, operations and runtime QA ownership. Independent implementation review is still required.

## Design and interfaces

The existing lease modal displays contractual requirements and uses a client-fetched workspace. Extending that modal would make recovery depend on its lifetime and would not provide the requested server-rendered list and detail. The selected design uses dedicated SSR pages with a small client command component and a link from the lease detail. No global navigation source changed.

`src/server/deposit-api/service.ts` composes the existing `createDepositService` factory with the real `lockAndVerifyDepositEvidence`. Routes do not implement financial arithmetic, create evidence metadata or bypass retained-byte checks. The core remains the authority for strict commands, current role, version checks, same-lease evidence, replay, immutable documents and transactional posting.

The routes use the existing stored-session, Origin, bounded JSON and no-store helpers. Financial POSTs also require `X-Taky-Deposit-Actor` to equal the current authenticated actor UUID. The journal freezes that header identity with the command. A preflight GET alone could race a cookie change between the identity lookup and the actual POST; the bound POST rejects that change before reading its JSON body. The header does not confer authorization.

| Method and path | Contract |
| --- | --- |
| GET `/api/v1/deposit-session/` | Current authenticated actor id and role only, no query parameters, no-store |
| GET `/api/v1/leases/[id]/deposits/` | Strict unique offset/limit, full core totals and paginated entries |
| POST `/api/v1/leases/[id]/deposits/review/` | Core review command without body leaseId |
| POST `/api/v1/leases/[id]/deposits/receipts/` | Core receipt command without body leaseId |
| POST `/api/v1/leases/[id]/deposits/deductions/` | Core deduction command without body leaseId |
| POST `/api/v1/leases/[id]/deposits/refunds/` | Core refund command without body leaseId |
| POST `/api/v1/deposit-entries/[id]/reverse/` | Core reversal command without body entryId, retaining required leaseId |
| GET `/api/v1/deposit-entries/[id]/` | Hash-checked immutable document DTO, no query parameters |

POSTs reject unknown query keys and body fields, forged path-owned identity, unsupported JSON transport, oversized bodies, missing authentication, wrong Origin, non-ADMIN roles and missing or mismatched actor binding. The adapter restores path identity before applying the authoritative strict core command schema.

SSR `/deposits/` lists non-demo leases with a total count and bounded pagination. `/deposits/[leaseId]/` loads the authorized ledger directly from the service and displays contractual requirement, managed held liability and unverified legacy data separately. Entry pagination does not change the complete server totals. Data-quality warnings preserve unknown legacy/contractual values; the UI does not add an eligibility prohibition beyond the core's policy. Explicit finite opening review remains possible after operator verification.

`/deposit-entries/[entryId]/` uses the hash-verified original document snapshot for names, room, amount, bank provenance and posting details. It does not substitute mutable current lease or tenant fields. Present reversal status and links are separate from the original document. Legal issuer verification remains explicitly unconfirmed.

## Commands and evidence

Money stays in decimal strings. Only opening review accepts explicit zero. Receipt, deduction and refund amounts must be positive. Full reversals derive their amount from the original entry. Receipt receiving-account/incoming-reference fields and refund payee/destination/outgoing-reference fields remain distinct. No automatic payout, rent allocation, expense or revenue classification is introduced.

The modal uploads raw files through the real evidence API, selects accepted same-lease evidence and offers authenticated downloads. Its 25-file selector has pagination. Upload success does not post money. The operator must separately confirm verified funds, liability or refund settlement.

The actor-scoped in-memory journal freezes route, actor, key, expectedVersion and serialized body on submit. It verifies the current session before each financial POST and binds the POST to the original actor. A network failure, 5xx, invalid response or idempotency conflict keeps the command uncertain. Recovery inside the modal sends the same bytes, key and actor. Closing the modal retains a visible recovery action. A fresh command cannot replace an uncertain one. A prior uncertainty cannot become a definite rejection merely because a later replay gets a 4xx.

The journal does not store financial payloads in browser storage. It warns before page unload while a command is unresolved. Reloading or leaving the page can lose the in-memory command, so the pending modal directs the operator to finish reconciliation before doing so. Actor changes clear the visible actor-scoped journal. Reads have a ten-second fetch deadline and POSTs have a 75-second deadline; a lost response therefore eventually enables uncertain-command recovery. These are technical request bounds, not measured service performance. Successful commands refresh authoritative SSR data rather than replacing present totals with a potentially older stored replay result.

## Executed checks

All of the following commands exited zero in this worktree after the final source changes:

- Six focused Vitest files passed all 37 cases: new API/form/journal cases plus the existing evidence route, storage, validator-client and verifier cases. Output is `evidence/deposit-ui/focused-tests.log`.
- Full `tsc --noEmit` passed. `evidence/deposit-ui/typecheck.log` is empty because the command produced no diagnostics.
- Scoped ESLint passed on all new source/tests and the modified lease component. `evidence/deposit-ui/lint.log` is empty because the command produced no diagnostics.
- Scoped Prettier verification passed. Output is `evidence/deposit-ui/format.log`.

The focused tests use real strict schemas and financial transport/journal behavior. Route tests replace the cookie/session transport and service implementation. They do not prove actual database roles, real retained uploads, ledger posting or browser interaction. No database command, container, native parser, app build or browser session was run by this implementer.

## Remaining review and runtime acceptance

Main must obtain independent implementation review, run a real build and browser UAT, and verify the current-role/actor-header cases against stored sessions. Exercise actual upload/list/download, zero and positive opening review, receipt, deduction, refund, full reversal, same-lease evidence rejection and original snapshot document reads. Simulate a lost financial response, close/reopen the modal and prove the same command commits only once. Verify stale version recovery, STAFF reads, ADMIN demotion, actor switching, more than one ledger/evidence page and finite-value warnings.

Main owns the six real PostgreSQL evidence tests, native validator runtime proof, migrations and backup/restore gates. This candidate does not claim those gates passed. Project work remains authorized through Stage 3E and Phase 4, then stops without Go-Live.

## Independent review correction DUI01

Main found that valid UUIDs for missing leases or deposit entries reached the generic SSR error boundary. Both pages now translate only service `AppError` status404 into Next's `notFound()`. Lease header and ledger reads remain concurrent. Authorization failures, unexpected database errors and framework authentication redirects continue to propagate.

Three focused page-boundary tests passed, and full TypeScript plus scoped ESLint passed after this correction. The tests substitute data/authentication boundaries and do not establish HTTP status behavior. The guarded browser suite adds real authenticated missing-UUID requests with strict HTTP404 and not-found-UI assertions. They were authored but not run by this implementer. Installed Next documentation says streaming can retain HTTP200 after a loading fallback starts, so Main must inspect the actual response before accepting the runtime status claim.
