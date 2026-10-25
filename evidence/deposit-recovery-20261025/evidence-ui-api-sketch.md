# Deposit API and UI sketch

Status: awaiting Main's design review before implementation. Baseline requested by Main is `45bc4b6` plus reviewed core `ee7e341` and evidence `8ee42ab`, on a separate durable `codex/deposit-ui-candidate` branch. Main owns migrations, core, evidence and QA integration.

## Grounding and phases

Grounding is complete against the adopted deposit contract, its review, the core factory's strict input/output schemas, existing payment command journal, genuine session/Origin/body helpers, current leases modal and installed Next route/page/server-client documentation. Sketch is complete below. Agreement is pending. Implementation and verification follow agreement; redesign is required if the public core interfaces cannot support this shape.

The current lease screen is client-fetched and shows contractual deposit only. The core factory owns financial transactions, exact arithmetic, authorization, version checks and replay. The retained-evidence service owns accepted files. The new adapter must compose those existing capabilities rather than implement another ledger or accept metadata-only evidence.

Two local designs were compared. Extending the existing lease modal with client-fetched ledger data minimizes navigation changes but does not satisfy SSR list/detail and makes unresolved-command recovery depend on modal lifetime. Dedicated server-rendered list/detail pages keep initial authorization and data fetching on the server, while a small client command component owns only interaction. Select dedicated pages with a link from lease detail. These alternatives were compared locally; no extra arena agents or cross-model runs are claimed.

## Caller usage and module ownership

```tsx
// SSR detail page, current stored session required
const ledger = await depositService.getLeaseDepositLedger(actor, { leaseId });
return <DepositScreen initialLedger={ledger} actorId={actor.id} admin={actor.role === "ADMIN"} />;
```

```ts
// Server-only composition, outside core/evidence ownership
const depositService = createDepositService(lockAndVerifyDepositEvidence);
```

New `src/server/deposit-api/` owns the factory composition, strict path/query/body adapter helpers and bounded lease-selector projection. Existing `src/server/deposits/**`, `src/server/evidence/**`, Prisma and operations code remain owned by Main and their implementers. New `src/features/deposits/` owns the Thai ledger, command forms, validated client transport, exact display formatting and actor-scoped command journal. Routes and SSR pages use those interfaces. Only a small existing lease-detail link and navigation entry are needed outside these new directories.

## HTTP and page interfaces

- SSR `/deposits/` provides a bounded non-demo lease list and selector. SSR `/deposits/[leaseId]/` loads the authorized ledger directly through the factory, with strict pagination. SSR `/deposit-entries/[entryId]/` displays the hash-verified immutable document snapshot and reversal status.
- GET `/api/v1/leases/[id]/deposits/` accepts strict unique offset/limit only. POST children `review`, `receipts`, `deductions`, `refunds` take the corresponding strict core command with lease identity supplied by the path.
- POST `/api/v1/deposit-entries/[id]/reverse/` supplies entry identity from the path. Body includes the lease identity required by the core and its other strict reversal fields. GET document uses the existing core document DTO.
- Mutations check Origin, genuine current stored session and ADMIN before bounded JSON parsing. Unknown query keys, duplicate keys and forged path-owned body fields reject. DTOs are parsed using the existing core schemas. All responses and errors are no-store. No generic CRUD endpoint or financial logic is added.

## UI and command state

The Thai detail screen separates contractual requirement, managed held liability and unverified legacy rows. Null or non-finite source values receive explicit data-quality messaging rather than displaying a verified zero. Show gross/reversed/net totals from the full ledger and a paginated history. STAFF receives read-only controls. ADMIN sees review-opening before managed posting; review requires reason, retained evidence and explicit verification. Receipts, deductions, refunds and full reversals use the existing core policies and strict variants. Money remains a canonical decimal string through entry, transport and formatting.

Evidence controls use the real raw upload endpoint, list accepted same-lease evidence and link authenticated download. File upload and financial posting are separate operations. A file upload success selects its accepted evidence ID but does not assert funds or post money. Receipt receiving-account/reference fields and refund outgoing-reference/payee/destination fields are distinct. No automatic payout, revenue classification, historical conversion or contractual auto-fill occurs.

The journal freezes actor, command key, route, exact serialized payload and expectedVersion on first submit. State is one of submitting, uncertain, rejected or successful. Network failures, 5xx and malformed responses remain uncertain. Retry sends exactly the same frozen command. No new key or edited payload is possible during uncertainty. Recovery and error text remain inside the accessible form modal. Closing a modal preserves an actor-scoped recovery notice that reopens it. Use an in-memory journal with beforeunload warning; do not persist financial payloads in browser storage. Changed actors cannot see or retry another actor's command. A successful replay refreshes the server ledger; an initial definite rejection permits correction with a new explicit command.

## Acceptance checks

1. Boundary tests cover absent/expired session, STAFF mutation, wrong Origin, forged identities, duplicate/unknown query parameters, unsupported content type and oversized JSON before service mutation.
2. Pure/client tests cover canonical exact money, every method-specific form payload, frozen replay identity, uncertain-result recovery after modal close, no fresh command while uncertain, stale-version rejection, actor isolation and malformed responses.
3. Main's genuine PostgreSQL/browser verification covers review opening zero/positive, cash/bank receipt, deduction/refund with accepted file, full reversal and immutable document read. Check legacy remains visibly unverified, STAFF cannot post, concurrency failure does not invent a new key, and downloaded bytes match retained upload.
4. Independent implementation review follows local type/lint/focused checks. This implementer cannot approve their own UI. No Stage 3E completion, Phase 4 completion or Go-Live claim follows from authoring this candidate.
