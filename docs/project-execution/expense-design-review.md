# Phase 4 independent expense design review

Reviewed 2026-10-24 against the current `expense-contract.md`, actual integrated schema and existing payment transaction conventions. This review changes this report only. No behavioral tests, migration rehearsal, database commands or application edits ran.

## Opinion

Accept the selected pending/ADMIN approval model, immutable content, terminal reversal, exact money, category snapshots and revisable historical expense totals as a coherent bounded design. The orchestrator corrected EDR-01 through EDR-03 and I independently re-read the revised contract. The design is accepted for implementation with the acceptance wording note below. These corrections did not require another blanket Owner approval. The orchestrator must record adoption of the stated development defaults under the standing delegation.

I used the installed Pstack Codex adapter, poteto feature playbook, TypeScript/type-system discipline and unslop guidance. This was one independent design review, not an implementation approval or cross-provider review.

## Findings

### EDR-01: remove the nonexistent property demo flag

Severity: medium. The transaction section requires resolving property existence and `isDemo=false`. The boundary section also says to reject demo entities. Actual `Property` in `prisma/schema.prisma` has no `isDemo`; neither does `ExpenseCategory`. The Expense itself does have that field.

Specify that a managed Expense requires an existing Property and `Expense.isDemo=false`. Category eligibility is its existence and active flag, not an invented demo discriminator. Remove the acceptance phrase about a property/category mismatch or define its meaning: categories are explicitly a global catalog with no property relation. A category from another property does not exist in this schema. Do not add a new property ownership model solely to satisfy the test phrase.

### EDR-02: prohibit creating new legacy rows after migration

Severity: medium. The selected schema sets `legacyUnmapped` to default true and accepts null managed metadata for legacy rows. The database section freezes origin flags and checks managed/legacy shapes, but does not prohibit a new INSERT using the legacy shape. The stated service explicitly inserts managed rows; an ordinary SQL caller can otherwise insert an expense with the default legacy flag and avoid the new lifecycle and actor requirements.

Explicitly define legacy as the rows already present at migration. Preserve those rows and freeze their original fields. After backfill and constraint installation, require every new Expense INSERT to be managed, PENDING, non-demo and version 1, with valid provenance and category snapshots. The legacy default may be removed or changed after backfill; an INSERT guard must also reject an explicitly supplied legacy=true value. Add a direct SQL test for both omitted and explicit legacy flags. Use ordinary trigger-enabled restore semantics consistent with the existing operational restore workflow; do not add a permanent application bypass to manufacture legacy records.

### EDR-03: specify valid serial outcomes for post versus category deactivation

Severity: medium. Acceptance item 4 requires exactly one valid conflicting transition to commit for every listed race, including post/category-deactivate. Under the proposed lock and eligibility rules, posting can acquire the category lock first, post successfully, then deactivation can acquire it and also succeed. That is a valid serial history. Historical POSTED expenses must remain valid after deactivation.

Require exactly one committed winner for post/post, post/cancel and reverse/reverse. For post/category-deactivate, accept either posting followed by deactivation with both commands committed, or deactivation first followed by a rejected post that leaves the expense PENDING. Require no posted row whose posting eligibility was checked after the category became inactive. Exercise both lock orders using independent database transactions and inspect the resulting row/category/audit/command state. Do not forbid later category deactivation merely to make an incorrect one-winner assertion pass.

## Correction verification

The Main Agent revised the contract, independently of this reviewer. I then re-read the actual changed text.

- EDR-01 closed. Transaction rules now explicitly state that Property has no isDemo and require its existence. The remaining phrase `property/category mismatch` in acceptance item 3 should read nonexistent property/category IDs and global-category eligibility. This is a wording note, not an authorization to add property-scoped categories.
- EDR-02 closed. The migration section now requires a BEFORE INSERT rejection for every new legacy shape after the one-time existing-row backfill, with direct SQL tests for omitted/default true and explicit true flags. No runtime import bypass is provided.
- EDR-03 closed. The race acceptance now distinguishes the two valid category-lock orders and preserves posted history after deactivation. Only genuinely conflicting expense transitions require a single committed winner.

This verification accepts the corrected design. It does not assert that triggers, tests or application behavior already exist. Keep implementation independent review and real migration/concurrency/browser gates open.

## Deposit and reporting reconciliation

The expense proposal explicitly resolves the same semantic risks noted by the deposit review without coupling the ledgers. REVERSED is terminal, so expense reversal-of-reversal is absent. Outgoing expenses do not reuse incoming rent/deposit transfer references. Approved expense totals include only POSTED managed rows and retain cancelled/reversed originals as history. October's later-reversed expense changes the current October expense view; it does not become a November cash inflow. That is a defensible current-ledger policy when the UI/export identifies it and no closed-period accounting promise is made.

Deposits remain liabilities outside rental revenue and expense totals. A deposit deduction must not create an expense automatically, and an Expense attachment is not proof that a deduction or refund occurred. The outstanding deposit reversal, mixed-transfer and totals findings still need their own corrected contract. Accepting this expense design does not close them.

Aggregates need exact precision beyond one NUMERIC(14,2) entry, and list totals must cover all filtered results within one consistent snapshot. The contract already requires exact decimal calculation and consistent list/summary reads. Implementers should preserve that requirement rather than coerce aggregate values through JavaScript Number or the single-entry input ceiling.

## Evidence and limits

Read `prisma/schema.prisma`, the original positive expense constraint, Phase 4 implementation scope, phase-2 category ownership, financial reversal architecture, the existing demo expense screen, payment command authorization/idempotency/lock/isolation code, and `deposit-design-review.md`. The source confirms globally unique category names, global classification, DATE expense occurrence, positive NUMERIC(14,2) amounts, restrictive property/category foreign keys and no property demo flag.

No installed Next.js framework code was edited. No typecheck, SQL, browser, production build, migration or financial correctness test is claimed. An implementation reviewer must later inspect real constraints, complete rollback, read isolation, concurrency outcomes, authorization, exact totals and actual browser/export behavior. Design acceptance cannot substitute for those checks.
