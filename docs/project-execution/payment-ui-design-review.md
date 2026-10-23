# Payment UI independent design review

Status: accepted after correction retest, 2026-10-23. Reviewer: `payment_ui_design_review`. Reviewed `payment-ui-contract.md` against the accepted payment contracts, transaction service, HTTP routes, invoice contracts/detail route, existing lease resource route, protected layout, AppShell navigation, shared Field/Modal, and current demo payments screen. This is a design review, not implementation acceptance or browser evidence.

I read checkout AGENTS.md, the installed Pstack Codex adapter, architect, TypeScript best practices, type-system discipline and unslop, React best practices, and installed Next server/client-component and fetching-data guides. The design's two competing sketches are documented comparisons. No cross-provider arena or browser run occurred in this review.

## UI-DR-01: preserve uncertain commands across client navigation

Priority: material, fix before implementation. The contract keeps the sole frozen key/body in the mounted screen and protects reload with beforeunload. AppShell uses Next Link at `src/components/app-shell.tsx:30` and `:49`. Client navigation and browser Back can unmount PaymentsScreen without beforeunload. An operator can lose an already committed but disconnected create command, return to Payments and record it again with a new key. Modal-close protection does not cover this path.

Specify a supported mechanism that covers same-origin client navigation, Back/Forward, and logout/account changes. Options include a reviewed navigation guard with complete lifecycle handling, or an actor-scoped in-memory pending-attempt owner that survives route unmount and clears on session/account changes. Do not claim beforeunload alone protects Next navigation. Reconcile feature-only ownership with Main if shared lifecycle support is necessary. No request to persist sensitive bodies in browser storage is implied.

Acceptance for correction: the contract names the state owner, how the original POST settles after unmount, how the frozen key/body is recovered on return, how account changes prevent cross-user replay, and required real-browser navigation tests. Implementation must prove one persisted payment/receipt after response loss, navigation away/back and exact retry, or prove navigation cannot discard the attempt.

## UI-DR-02: make route bodies explicit

Priority: clarification before implementation. Confirm, cancel and reverse strict HTTP body schemas exclude paymentId and inject it from the URL. See `src/app/api/v1/payments/[id]/confirm/route.ts:11` and cancel/reverse route omissions. Full domain schemas include paymentId. Define HTTP command bodies as schema-derived omissions, keep paymentId in the request path/attempt metadata, and preserve commandKey in the serialized body. Sending the full domain input directly returns422.

## Remaining design assessment

No other material design findings. The contract correctly keeps exact money in BigInt minor units and decimal strings, validates Bangkok wall dates independently of workstation timezone, freezes receivedAt/key/body on retry, distinguishes uncertain commands from rejected intent, requires current payment/invoice versions, guards stale GET responses, paginates managed history, preserves immutable receipt snapshots and cancellation metadata, and keeps ADMIN transitions behind current server authorization. Separate reads are correctly described as advisory rather than transactional balance locks. STAFF cannot confirm/cancel/reverse. Pending records do not claim settlement, credit, or post-VOID resolution.

## Correction retest

UI-DR-01 is closed at design level. The corrected contract puts the immutable attempt, POST promise and settlement in a feature-local module rather than the mounted screen. Same-document navigation unsubscribes the view without aborting or deleting the attempt. Returning restores the same actor's key/body; the original promise can settle while the page is absent. The module owns beforeunload independently of the screen. Actor changes, 401 and pagehide clear sensitive state and increment a generation that rejects late completion. Pagehide also covers back-forward-cache entry. I checked the existing AppShell logout and login source: successful logout and login use full document location.assign. The contract explicitly limits recovery across full reload, other tabs and external session changes. These constraints fit the scoped ownership without an unsupported Next navigation blocker.

UI-DR-02 is closed at design level. The corrected contract requires schema-derived bodies omitting paymentId for confirm/cancel/reverse and freezes the exact path separately with the serialized body/key.

The corrected browser acceptance cases cover Next Link, Back/Forward, settlement while unmounted, logout/account change, cache restoration and late completion. Main approved a separate serial AppShell wording update so the persisted Payments route is not labelled demo. That prerequisite does not require shared lifecycle changes.

No material design findings remain open. Implementation may proceed within the contract. Agent-run UAT requested by the user must execute the same acceptance scenarios and retain a report and actual evidence; it does not establish human acceptance or production readiness. Unit, integration, independent implementation review and actual isolated browser verification remain required before implementation acceptance.
