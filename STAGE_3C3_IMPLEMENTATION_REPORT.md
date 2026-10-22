# Stage 3C-3 implementation report

Date: 2026-10-21, Asia/Bangkok. DEVELOPMENT COMPLETE after local closure commit. Production billing remains NO-GO.

## Baseline and scope

Branch `codex/stage-3c-billing-invoice` contains the approved Stage 3C-2 baseline `4fde51836999b271d7470c465a762fa5e9aa78b7`. Requirements, design and decisions were committed locally as `59538b8` before implementation. This milestone adds invoice persistence, validated closure, lifecycle services, protected APIs and the live `/billing` workflow. It does not add payments, receipts, deposits, taxes, optional service charges, a ledger, delivery or deployment.

The existing unrelated changes to `next-env.d.ts`, `src/app/globals.css` and `src/features/auth/login.tsx` remain outside this milestone. The verification image uses their committed baseline contents. No production data was changed and no remote push is authorized.

## Implemented behavior

### Validated closure and immutable inputs

ADMIN closure now acquires an exclusive source gate, reads fresh canonical inputs under READ COMMITTED, validates every eligible lease with the Stage 3C-2 collector, persists the immutable period/per-lease freeze, closes the period and appends audit in one transaction. Failure leaves the period OPEN. Source services and direct source DML enter the same gate before entity locks. Empty eligible periods can retain an explicit empty freeze for the existing meter-only workflow. Historical CLOSED periods without a freeze remain unissuable.

The exact Stage 3C-2 engine and PREVIEW_ONLY snapshot contract remain unchanged. Issuance verifies the immutable authority and recalculates those exact frozen inputs with that engine. Detached labels, contractual rent and dates, physical-meter identities, rate/approval references, quantities, exact rational amounts, reference line amounts and the final HALF_UP total remain available historically.

### Drafts, due dates and transitions

STAFF and ADMIN can prepare frozen lease drafts, read/list/history, edit draft notes and explicitly refresh drafts. ADMIN alone configures property due policy, overrides a draft due date, issues, voids and revises. Services enforce authorization as well as route authentication.

The property policy is an explicitly configured offset of 0 through 365 calendar days from canonical period end. No default is inserted. A draft can show missing policy, but issuance rejects it. Refresh resolves the latest configured policy; issue never silently substitutes it. ADMIN overrides require a reason. Issued documents retain resolved policy version/anchor or override identity/reason.

Allowed transitions are DRAFT to ISSUED and ISSUED to VOID. Issued financial content, due date, number, source and items are immutable. VOID and legacy rows cannot be edited or deleted. A revision atomically approves a separate correction snapshot, voids the original, creates and issues a linked child, allocates a new number and records audit. Failure preserves the original active invoice. Standalone void retains its number and source reservations.

### Numbering, uniqueness and retries

`INV-YYYYMM-0001` uses the canonical billing month, independent of issue date. A global monthly counter serializes allocation across properties and stops at 9999. It never wraps or resets. Existing formatted legacy numbers seed the high-water mark once during migration. Live issuance does not use MAX plus one.

PostgreSQL partial unique indexes enforce one non-VOID invoice per lease/canonical period and retained lease/date slots. Revision/predecessor constraints prevent duplicate revisions and branches. A retained unmapped legacy invoice on any date of the same month blocks managed preparation and direct managed insertion pending explicit legacy mapping. All historical rows remain intact.

Commands retain an actor/key, operation, request fingerprint and result in the financial transaction. Repeating the same key/body returns the committed result. Reusing the key for another request conflicts. Optimistic versions reject stale commands; period, lease, invoice and counter locks serialize shared financial state. Audit failure rolls the mutation, number allocation and command record back together.

### Corrections and allocation

The owner approved invoice-specific corrections with reason and evidence. The endpoint accepts bounded current canonical lease rent/dates, existing eligible rates and explicit quantities on the original physical sources. It recalculates through Stage 3C-2 and retains immutable before/after evidence. It never accepts caller totals or arbitrary engine JSON, reopens periods or changes closed inputs. Selecting unchanged rent/dates/rate/quantity does not manufacture a correction from fresh approval metadata.

Room caps include every frozen lease, including unprepared and VOID leases, overlaid by each lease's latest committed correction. Actual and physical replacement sources retain separate identities. Partial occupancy requires explicit allocation and compatible source overlap. Later actual-versus-estimate reconciliation remains deferred to a future-period contract; the strict correction schema rejects actual-reading replacement fields and preserves estimate classification.

### API and operator UI

| Endpoint                              | Contract                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------- |
| GET `/api/v1/invoices/`               | Strict optional canonical period, room, lease and status filters.          |
| GET `/api/v1/invoices/options/`       | Authorized periods, candidates, policies and rates for the UI.             |
| GET `/api/v1/invoices/{id}/`          | Managed immutable detail or read-only unmapped legacy metadata.            |
| GET `/api/v1/invoices/{id}/history/`  | Retained revision chain.                                                   |
| POST `/api/v1/invoices/drafts/`       | Frozen period/lease and command key.                                       |
| PATCH `/api/v1/invoices/{id}/`        | Expected version, command key, notes and authorized optional due override. |
| POST `/api/v1/invoices/{id}/refresh/` | Explicit draft refresh.                                                    |
| POST `/api/v1/invoices/{id}/issue/`   | ADMIN issuance.                                                            |
| POST `/api/v1/invoices/{id}/void/`    | ADMIN void with reason.                                                    |
| POST `/api/v1/invoices/{id}/revise/`  | ADMIN bounded correction, reason and evidence.                             |
| PUT `/api/v1/invoices/due-policy/`    | ADMIN explicit property policy and expected policy version.                |

Mutation routes enforce exact Origin, authenticated identity, bounded JSON and strict schemas. The dynamic path supplies the authoritative invoice ID. Responses use existing no-store `{data}` or `{error:{code,message}}` conventions. Malformed JSON returns 400, forbidden 403, missing resource 404, lifecycle/version/idempotency conflicts 409, and schema or billing validation 422. Existing period-close endpoints are reused.

The responsive Thai invoice UI follows existing cards, controls, navigation and dialogs with a scoped stylesheet. It provides filters, frozen source preview, reference-line reconciliation, policy configuration, role-appropriate actions, required reasons/evidence, confirmations, submission locks and revision links. It uses decimal strings for financial display and does not recalculate totals with floating-point arithmetic.

## Persistence and migration review

Three additive migrations extend Invoice, introduce freeze/correction/policy/counter/command records and replace incompatible all-status uniqueness with reviewed partial uniqueness and guards. Reference quantity/unit-price columns widen without changing stored values. The third migration changes only the legacy date predicate in the lifecycle guard from exact date to canonical month range. Applied migration files were preserved; fixes after application use a new migration.

Both month-start and mid-month synthetic legacy fixtures retain original invoice/item values, unmapped provenance and reserved counter 42. No legacy sources are inferred. Index creation, trigger replacement and numeric alteration still require an operational migration rehearsal because they can lock tables. Synthetic verification is not evidence about actual production legacy data.

## Review and verification

Pstack architecture comparison, synthesis and independent review are recorded in the design and decision log. Review fixes include source cutoff coordination, SQL NULL handling, historical issuer deactivation, restrictive references, actual freeze membership, snapshot binding, zero-quantity reference lines, numeric capacity, no-op corrections and the full-month legacy barrier.

Actual verification, initial failures, corrected harness issues and remaining checks are recorded in `STAGE_3C3_TEST_REPORT.md`. Two active user chats initially ran the same database concurrently. After explicit owner authorization, they coordinated and the second chat stopped. This chat owns final reports and commits. Failed overlapping runs are not used as passing evidence.

## Deferred work and production readiness

Stage 3C-4 and operational commissioning remain separately scoped. Required follow-up includes actual target identification, legacy inventory/mapping, backup/restore and migration rehearsal, operator acceptance, deployment controls and carried-forward meter UI findings F-04/F-05/F-06/F-08. Historical Stage 3B full browser coverage remains 14/15. No production billing, real invoices, migration or public deployment is authorized by this milestone.

## Closure evidence and commits

Final checks passed: 120 unit tests, 71 related PostgreSQL tests, 46 HTTP/API checks, nine desktop/mobile browser groups, 13 migrations and zero drift, typecheck, lint, scoped formatting, Prisma validation and the production Docker image. The test report records exact commands, initial failures, fresh-install build requirements, fixture isolation and remaining limits. No Stage 3C-3 functional finding remains open from this review and verification.

| Gate                                      | Local commit                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 3C-3A requirements and design             | `59538b8`                                                                                                           |
| 3C-3B persistence and domain services     | `0271ea05371a7781a89041731047bb5816e62934`                                                                          |
| 3C-3C APIs, UI and verification artifacts | `3d6cc8c07aa2a1de6344fbda0d7db4e423317a92`                                                                          |
| 3C-3D closure                             | Latest commit touching this report, resolvable with `git log -1 --format=%H -- STAGE_3C3_IMPLEMENTATION_REPORT.md`. |

All milestone changes are local. Stage 3C-4 can proceed from this development foundation under its own scope. Production billing remains NO-GO until the operational gates above are independently cleared.
