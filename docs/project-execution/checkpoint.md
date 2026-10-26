# Phase 4 closed at the requested stop boundary

Stage 3E and Phase 4 Expense Management are complete in the reviewed local development integration. Source and test evidence were published to private GitHub branch `codex/project-integration-snapshot` at `ffc1e7030b692dffeff063c536bf135de52e7d1f`. The connected GitHub API independently verified that exact ref. Later closeout-only commits may advance the branch.

Read `phase4-closeout.md` for executed checks, reviewers, limits and artifact paths. Main merge `4bd58c7` preserves the accepted candidate source exactly. Main's own 44-model Prisma client generation, 409 unit tests, typecheck, lint, Webpack build and copied PDF-asset checks passed. The final 35 browser cases passed without retries, skips or flaky results.

The Owner requested work through Phase 4 and then a stop, and prohibited changing completed work. No new feature task is executable until a further Owner resume. Dashboard and Reporting, maintenance-demo replacement, remaining security and commissioning, and Go-Live remain later scope. No human Owner UAT, protected-branch merge or production deployment is claimed.

Pstack `0.15.32+codex.1` is installed. Updated shipping guidance was applied only to source identity, integration, publication and handoff. Accepted modules were not rewritten. Private QA plans, local traces and synthetic volumes remain retained. Run-specific servers and proxies stopped.

## Historical checkpoints below

Earlier next-step lists are superseded by the current stop boundary and verified frontier above.

# Current execution checkpoint

Recorded 2026-10-24, Asia/Bangkok. Main thread 01a164a6-91ca-7913-ad0f-9a5d343652a6. Continue the authorized Pstack project mission without a new routine approval request.

## Controlled baseline

`/private/tmp/taky-development`, branch `codex/project-integration-snapshot`, reviewed code baseline `e683f3b` before the pending restore-v4 integration. This independent source snapshot is readable and supports local commits. It does not preserve original repository ancestry. Original Git object reads stalled; do not reset, prune, remove locks or retry expensive reads without new evidence. Original dirty application files and UAT ports 3700/3701 remain untouched. Main owns integration and execution records. Specialists own bounded files and material work receives independent review.

Reviewed integrated milestones include payment domain 0e4e302, inventory v3 bf71f9c, payment API 6da96b7, billing period/rate UI d068f40, tenant rent fix 7944594, persisted payment UI a9496e0, invoice PDF glyph fix 020cb14 and normal-order tenant regression c622374. Earlier backup/heartbeat/auth fixes remain included. Stage 3D is not complete until receipt PDF verification and integration finish.

## Verified evidence

- Integrated source unit suite 268/268 in 15 files and Webpack production build passed before receipt integration. Evidence: `evidence/agent-uat/final-integration-{unit,build}.log`.
- Operations suite 50/50 passed, `evidence/agent-uat/integrated-ops.log`. Real isolated restore v3 harness passed 48 checks, including unchanged historical v2/legacy registries. This is not operational recovery certification.
- Fresh combined PostgreSQL regression passed 92/92 in seven files. Log `evidence/agent-uat/combined-db-integration-2026-10-23T11-58-03.174Z-07d03db8-dc65-4922-a68b-07164fc1a280.log`. Dedicated payment domain 22 and actual-session API six cases passed separately.
- Billing branch Agent UAT 51/51, payment UI 14/14, tenant rent three cases plus clarified normal-order one case passed independently and are committed.
- Full combined browser run 8a6f2e8f5b3166f805353e53 finished 68 passed, one failed. The failure was an ambiguous loading-status test locator matching both billing history and invoices. Agent combined_uat_fix narrowed it to the actual invoice loading message; Main independently inspected the source and unchanged assertions. Fresh full run 2cb9d14d699644c6a08f83e0 finished 68 passed and one failed before a test because target health returned a non-2xx response. The corrected invoice case passed. Guard and timeouts remain intact. combined_uat_fix investigates the unavailable-health cause, log `evidence/agent-uat/combined-full-browser-corrected.log`. No full-suite success claimed. Test correction committed 5093da9.
- Invoice PDF five fixtures passed 48 extraction checks and visual review after Baht/superscript-three font correction. Receipt extraction uses the same supported font helper, pending independent regression review.

## Active assignments

Receipt owner receipt_pdf_design froze WIP in `/private/tmp/taky-receipt-pdf`, branch codex/receipt-pdf at c622374. Handoff `evidence/receipt-pdf/handoff.md` includes source SHA256 manifest. New renderer, authenticated GET PDF route, receipt links and shared font helper. Owner reports 289/289 unit, typecheck, lint, Webpack build, 74 receipt semantic/page checks and 48 invoice glyph checks. Five receipt PDFs have 25 total rendered pages. These owner checks are not independent acceptance. receipt_pdf_design_review independently examines code and visual artifacts. Main executed genuine-session PostgreSQL cases: 2/2 passed. Reviewer independently checked actual three route PDFs and unchanged snapshot/fingerprint. Owner prepares actual browser link/download cases; Main executes them serially. No schema change.

Expense owner expense_architecture delivered `expense-contract.md`; expense_design_review reviews before code. Expense implementation began in isolated /private/tmp/taky-expenses-development, branch codex/expense-domain from c622374. Design independently accepted after three corrections, defaults explicitly adopted. Owner owns schema/backend/API/tests; no DB/Docker execution. Proposed new ExpenseCommand model makes 39 total models, requiring frozen v4 inventory after integration. Deposit design review has three open contract corrections for reversal targets, cross-stream transfer identity and total equations. Main can adopt documented development defaults under broad authorization; missing actual facts must not be invented.

## Tenant rent incident limits

The reproduced failure was explicit rent entered before selecting/reselecting a zero-default room. The fixed client preserves explicit rent including intentional zero; untouched drafts still get room defaults. A separate actual browser test proved room first, rent last, immediate save persisted 4100.75 in POST, stored lease and profile before/after reload. Original deployed-UAT normal-order failure has not been reproduced there. The user has not supplied URL/room/amount. No historical rent or invoice data was guessed or repaired. Candidate fixes are not deployed to original UAT.

## Isolated environments

Combined regression project taky-remediation-integration-4896c4d1e00a0ca6939fd8bc uses 127.0.0.1:55451, role int_4896c4d1e00a0ca6939fd8bc, DB taky_phase2_test, subnet 10.253.244.0/28. Setup completed 14 migrations; do not rerun setup. Guarded driver `/private/tmp/taky-combined-db-qa/runner.cjs` and README retain exact plan and actual role/database checks.

Payment QA2 project taky-payment-qa2-isolated uses 127.0.0.1:55489 and role taky_qa_2b5214bd52. Current private identity points to DB taky_payment_test_2b5214bd52_routes1, already migrated. All earlier databases remain preserved. Receipt tests may add synthetic fixtures here after exact attestation; no reset/drop/setup.

Completed browser run 2cb9d14d699644c6a08f83e0 used its immutable per-run private plan, DB port55452, app3820, proxy3822, subnet10.253.243.0/28. Runner validates exact generated plan and actual role/database before migrations, retains fresh evidence and only removes its own container/network. Volumes stay. Do not use ambient database credentials or convenience env as identity.

## Release facts and limits

Owner delegated UAT execution/reporting to agents and authorized proceeding toward Go-Live. No human UAT pass is claimed. Existing configured taky-erp operational target is healthy but has only 22 application tables and three migrations. Read-only aggregate inventory found zero Tenant/Lease/Invoice/Payment/PaymentAllocation/SecurityDeposit/Expense rows. Configured LAN IP192.168.1.177 differed observed en0 IP192.168.1.135. Reconcile target/network before deployment. No production mutation, migration, backup, deployment or recovery certification performed.

Actual legal issuer/account/evidence-retention facts remain unverified. Deposits, expenses, persisted reports, remaining security admission controls, non-destructive migration rehearsal and operational backup/recovery remain unfinished. Broad authorization permits engineering defaults; it does not supply missing operational facts or certify implementation.

## Next executable work

1. Finish corrected full browser run, independently reconcile result and commit the bounded test correction/evidence.
2. Close receipt code/visual findings, execute genuine-session PostgreSQL tests and real browser PDF links/download, integrate only after acceptance and regression checks.
3. Resolve expense/deposit contract findings, adopt explicit conservative defaults, then assign isolated implementation with schema/restore-registry ownership coordinated by Main.
4. Update backlog and append decisions, preserve sanitized evidence/QA drivers, copy owned execution records to original workspace, refresh and verify snapshot bundle.
5. Continue through persisted reports, security/operations and actual release gates. Never stop merely because one milestone finished. No self-restarting process or recurring automation is configured.

## Latest verified continuation frontier

Main integrated independently accepted receipt commit 5a1445e as 97d6bfc. Combined unit suite 298/298, full lint and Webpack build exited 0. Scope includes actual receipt PG2/2 and browser3/3 with independently inspected downloads and packaged fonts in the tested standalone path. Historical invoice PDF evidence was not replaced.

The fresh full integrated 72-case run 9dd280a08ff74e199d8e303d finished 67 passed, five failed. Exact log evidence/remediation/9dd280a08ff74e199d8e303d-browser.log and fresh execution JSON remain. Two pre-existing flow cases timed out, one receipt fixture could not start a Prisma transaction, and two receipt cases incorrectly assumed their reference was in the first 50 payments after earlier tests created more records. Main parsed actual trace network payloads and proved both lists returned 50 rows without the expected reference. Receipt owner now fixes only the test to select its actual lease using the existing UI filter and adds populated-database coverage. No application, guard, timeout or retry weakening is authorized by that correction. Runtime pressure was observed separately: six CPUs, load averages above eleven and 137 MiB free of 8 GiB; a contemporaneous synthetic PG aggregate showed seven of 100 connections, so connection exhaustion was not established. Main will serialize heavy builds and browser runs. No full-suite green or underlying performance fix is claimed.

Expense backend source and guarded tests froze at 83d6819 after ER01 NaN and ER02 canonical-note corrections. Independent static review accepted corrections and executed 24 focused tests. Main real PG21/21 passed on fresh integration1; rehearsal1 preserved two original Expense rows, one Category, one Attachment, thirteen constraints and twelve indexes. Reviewer requires actual service legacy exclusion/count proof and live totals above one-entry ceiling, plus finite positive-control attribution for the raw NaN test. Owner is adding those tests. Rehearsal1 must not be reset or reused as pristine; extended runner offers new exact rehearsal2 modes. Current approved helper is /private/tmp/taky-expenses-qa/runner.cjs.

Expense UI design is docs/project-execution/expense-ui-contract.md, pending Main review before code. Deposit concrete design and Main independent correction review are deposit-implementation-contract.md and deposit-implementation-review.md. Main accepted corrected design and explicit development defaults, with no deposit implementation yet. One new ExpenseCommand model reaches39; deposit's five provisional tables come later and shared schema remains single-owner. Separate Payment managed-NaN candidate was found in blast-radius inspection; needs real repro and additive independently reviewed correction, never edit already-applied payment migration in place.

Owner explicitly requested pushing completed work to GitHub. Native push succeeded to private ramajittilearn-ctrl/ERP-TakyApartment branch codex/project-integration-snapshot. GitHub connector independently verified the exact ref SHA97d6bfca38820d667cf65173eaebb39e357c3100. main and protected UAT branches were not changed. This branch retains the disclosed independent snapshot ancestry. Original e13b0051432fb27d7f2889a2f007bf08bb76a160 was not found on GitHub, so remote publication does not resolve original local ancestry recovery. A pre-push scan checked569 reachable text blobs for generated private QA values and private-key headers. Only committed reviewed work was pushed; active expense WIP remains local.

## Post-resume accepted integration

Main revalidated the GitHub ref at97d6bfc and inspected the in-app browser's logged-out404, then opened GitHub sign-in for user handoff. Repository remains private; no access settings changed.

Receipt populated-list correction was independently reviewed and passed all three fresh cases in run1285e1a7723d49c28a441bd5, including an actual target outside fifty newer foreign-lease records. Committed225d4c7 with preserved full72 failure evidence. No other timeout or full-suite pass is inferred.

Expense backend commits were cleanly integrated through e683f3b after the independent reviewer accepted22 real PostgreSQL cases and revised rehearsal2 actual-service legacy exclusion. Main regenerated its own39-model Prisma client and ran322/322 unit tests, full lint, explicit typecheck and supported Webpack build successfully. Main evidence is evidence/agent-uat/expense-integrated-*.log. Latest actual expense logs and final review were copied under evidence/expenses; schema source and immutable originals remain unchanged by the test corrections.

Restore-v4 owner commit2a59899 was independently code-reviewed. Main executed its network-disabled isolated container:60 PASS checkpoints, exit0, covering real old33 legacy/v2, old38 v3 and new39 v4 dump/restores, exported snapshots, equal-count corruption and trigger state. After supplying the already installed runtime dependency closure to its own worktree, the full operations suite passed54/54. Earlier environment failures are preserved. Final reviewer accepted both real logs. Integrate2a59899 and its final review/evidence next. Container taky-inventory-v4-proof-20261024-attempt1 is retained stopped; no host database/production was involved.

The expense UI/CSV owner is implementing in /private/tmp/taky-expense-ui from expense83d6819. Own source, query/export additions and narrow AppShell classification only; no financial command, schema or operations writes. Owner reports329 local unit tests and typecheck, with real-session/export and six browser cases authored but not executed. Main must inspect freeze, assign independent review and run actual evidence. Do not accept implementation-owner counts as those runtime gates.

Fresh baseline regression plan d7fd72f9c44a489094ca94e7 is prepared but not started. Updated /private/tmp/taky-combined-db-qa/runner.cjs pins it, preserves v1 helpers, selects seven baseline files and excludes four separately guarded suites explicitly. Validate-plan passed. Old owned integration project4896c4d1e00a0ca6939fd8bc still occupies port55451/subnet10.253.244.0/28. Stop only that owned project without volume deletion before starting the new plan. Never stop QA2, whose database storage is tmpfs and still contains accepted test evidence. All UAT/operational projects remain protected.

## Verified continuation on 2026-10-24

Integrated restore implementation as3067aa5 and actual reviewed evidence asdf65718. Main reran all54 operations tests successfully. Pushed reviewed development branch through df6571869817b6b78175223105e5367326d2b005 and independently verified exact GitHub ref. Private browser login remains a separate access issue.

Fresh isolated baseline d7fd72f9c44a489094ca94e7 applied15 migrations and passed92/92 tests in seven files. Only old owned regression project4896 was stopped, preserving its volume. QA2 tmpfs project remains running. Current baseline container remains owned and isolated.

Expense UI candidate6cedc18 received independent61 focused tests and two Medium findings: recovery inaccessible inside detail modal, and C1-leading controls missed formula-prefix neutralization. Owner correcting both. First actual export PG attempt failed4/5 at fixture Property.code length before export behavior; one genuine session denial case passed. This is preserved evidence, not an export runtime acceptance. Owner correcting fixture under real32-character schema. New dedicated export helper is /private/tmp/taky-expense-export-qa/runner.cjs.

FIN-NaN-01 rollback reproduction helper is under review; its first oversized synthetic property code was caught before any DB execution. No payment vulnerability claim yet.

##2026-10-25 persistent recovery frontier

Durable integration .local/development-recovered-20261025 recovered baseline dd7d2dc from original bundle, UI2f41+sequential2614 fixture recovered. Fresh467locked dependencies installed offline after own stalledcopyprocesses were stopped and partials preserved; originaldeps/checkout untouched. FreshMain363unit/full lint/supportedWebpack build passed. Freshexpensebrowserrun6da15bf60576d8a202839939 passed8/8,no retries/skips,31sec. Readonlycollector automatically started atstandalonereadiness; saved33snapshots,max8actors,noblocking snapshots, then exited1 duringDBteardown. No full90collectorpass or provenrootcause claimed. TestDBvolume retained,containeronlycleanedbyexistingrunner.

Recoveredfinitebranchcodex/recovered-payment-finite atfacb581: sourcee423b33+checks6ee65d0 independently reviewedbyRoot. FreshQAprojecttaky-phase4-recovery-20261025, newcredentials/newvolume/explicit10.254.250.0/28, port55489. Integration9/9 +historicalpreserve+bothblockers allpassed. Sourcecandidate16isatomicDO; existing15unchanged. Operationsmigrationcountreconciliationstillrequiredbeforeclosure. No productionmutation.

Currentagents recover_deposit_core, recover_evidence and evidence_validator implement/recoverStage3E; sourcepersistentunderproject.local/worktrees. ValidatorprivateboundedLinuxqpdf/sharpservice approveddesign, no productiondeployment. OwnerstopALLthroughStage3EandPhase4thenSTOP; noDashboard/GoLive.


## Authoritative continuation at 2026-10-25 19:22 Bangkok

Stop boundary remains completion through Stage3E and Phase4, then stop. Main integration remains45bc4b6; no failing deposit candidate merged. Actual source worktrees now persist inside project.local. Main resumed all three available specialists after old usage errors; fresh usage permitted execution. Core owner recover_deposit_core, ops/validator owner recover_finite, UI/API owner evidence_review. The latter completed independent evidence source review before taking disjoint UI responsibility; final UI still requires another reviewer.

Fresh Core3 isolated database taky_deposit_test_20261025_core3 at owned loopback55489 applied all17 migrations successfully. Candidate branch codex/deposit-qa-candidate through90ae6a0 contains core ee7e341/8083b98/e8411c3 plus evidence8ee42ab. Original Core1 failed migration and Core2 fixtures retained without reset. Actual adapter probe established P2010.meta.driverAdapterError.cause.kind TransactionWriteConflict and originalCode40001. Core retry classifier corrected to recognize that exact typed shape without increasing existing two-retry bound. Actual original concurrency case now passes. Expanded46-case PostgreSQL suite passed44, failed2: service PAYMENT_FIRST and rawPayment DIRECT_FIRST bank identity races both fulfilled. No acceptance of bank duplicate prevention; core owner investigating actual source/test identities. Other13 core and24 integrity cases passed, seven other race cases passed. Raw log retained in evidence/deposit-recovery-20261025.

Actual evidence PostgreSQL/filesystem tests6/6 PASS on Core3 using real validator and synthetic owned0700 retained storage. Includes genuine persisted session/cookie adapter, actual upload/download bytes, currentrole denial, admission/rate/stream limits, twoactorcapacityrace and tamper denial/restoration. Not browser acceptance or backup proof. Retained synthetic files preserved.

Validator image taky-evidence-validator-qa:20261025 built successfully. Actual qpdf11.3.0 and Sharp0.35.5, UID1000,512MiBmemory/swap,1CPU,64PIDs, readonlyroot/no volume mounts verified. ActualHTTP12/12validPDF/PNG/JPEG plus encrypted/active/malformed/appended/truncated/oversize/pixel/wrongcredential passed. Initial QAinternalnetwork blocked DockerDesktoploopbackpublishing; recreated ONLY new QA container/network with internalfalse and fixed127.0.0.1:3835. Production overlay remains internal without publishedport; no productionruntimeisolation proof inferred. Current validator native suite flaky27/28 on declared oversize fetch uploading while server rejects/closes; prior28/28 preserved. Owner recover_finite investigating transportfixture, no parser or size weakening.

Ops candidate frozenfa7f068 oncodex/deposit-operations: publication sessionlock73422195 beforeinventory/exportSnapshot, V5fivetables append, preservedoldSQLregistries, new44modelrestoreharness and syntheticnon-superuser/loss/backuporphan proofs authored. Main actual fullops and ownnetworknone Docker build started; results pending. Core owner asked independentreview but bankracefix takespriority. No runtimebackupacceptanceyet.

UIcandidate branchcodex/deposit-ui-candidate througha396d76 prerequisites, own467lockeddeps and44Prismaclient generated. evidence_review implementing approved SSRlease list/detail, strictcurrentrole/Origin/pathownedfinancialroutes, explicitactorheader and currentidentityreplay, evidenceupload, fullauthoritativetotals/pagination, immutable document views. No UI/browser acceptance yet.

Next: resolve bankidentityrace without weakeningassertions, independentlyreviewfix, newtargetif003changes; finishopsactualharness+crossreview; settlevalidatortransporttest; independentUIreview plus realbrowseragentUAT; finalintegratedregressions, reviewedlocalcommits+GitHubpublication; closePhase4thenstop. No Dashboard or GoLive work authorized beyond this stop boundary.


## Verified correction after the previous frontier

Root independently accepted source correctionaffae02 after directional reproduction: deposit SERIALIZABLE snapshot was established before waiting for bank admission, while Payment uses READ COMMITTED. Post-lock snapshot stayed stale and could miss the committed Payment claim. Deposit commands now use READ COMMITTED with unchanged mandatory source/bank gates, version/idempotency/SQL guards and retry bound. Ledger/document reads remain REPEATABLE READ. Actual50/50 PostgreSQL cases passed on Core3 with fresh synthetic fixtures, including added cross-lease bank identities in both arrival orders. Old unsafe synthetic fixtures remain preserved without repair. Evidence50-case rawlog copied alongside original44/46 failure. No production database touched.

UI e8f8d16 was integrated only in the QA candidate329edca, not Main. Fresh406/406 unit passed and NextWebpack build produced the full routes/standalone artifact; full lint initially failed on unused finite-rehearsal readFileSync import. Root removed only that unused import; corrected full lint exited0. UIbrowser tests authored in separatecandidate but not yet executed. Fresh planned6b12a4f60acb471aa2e09183 browserDB container nowhealthy: ownproject, port55452, explicit10.254.247.0/28, freshretainedvolume. FixedMainwrapper allows actualvalidator3835/token and freshowned0700syntheticstorage while retainingexistingplan/currentDB/roleattestation. No browser success inferred yet.

Validator declaration-size transportfixture7b3840e now reads413 before sending any oversizedbody; actualchunkedoverflowtest unchanged. Main freshnative28/28PASS. Image native12/12 remainsaccepted.

Ops Mainactualfull64/64PASS. Imagebuildpassed, first17/V5actualrestorefailedguardfingerprint. Diagnosticd0dcd42 actualattempt2 provesonlyfiveCHECK deparse differences, no missing/addedguard and noindex/trigger/functionchange. NativePostgreSQL canonical CHECK reparse comparison withbounded4passfailclosed andsemanticnegativecontrols approveddesign; implementation andindependentreviewpending. Broaderactualpublication/backuporphanproof notyetreached. Requiredlate003atomicityprobe stillpending. Do notreplacefailedlogsorclaimrestorepass.

## Production Go-Live continuation checkpoint — 2026-10-26

This checkpoint supersedes the older Phase 4 stop-boundary note above. The owner later authorized preparing Go-Live for `phase4-2026-10-26-rc1` and directed automated Agent UAT in place of manual Owner UAT. No new approval is being requested for routine preparation. Production cutover remains NO-GO because the target and required recovery/network gates are not technically reconciled.

### Verified baseline and completed work

- Release source baseline: `89a15a1aa88e8bc1ac42ce38f653448b1a32a645`. Remote `release/phase4` points to that commit and annotated tag `phase4-2026-10-26-rc1` peels to the same commit. The draft GitHub release remains unchanged.
- Automated RC image Agent UAT: **85/85 passed**, zero failed/skipped/flaky, on a new PostgreSQL 17 synthetic database and run-specific database role. The app and evidence-validator ran from the local RC images; the Playwright target HMAC/role guard passed. Coverage included rent persistence, billing, meters, payments/receipts, deposits/evidence, expenses/CSV, responsive accessibility and target safety. The release operations image separately backed up that synthetic database and restored it into an isolated Compose project; all six attachment hashes verified.
- Database migration rehearsal: restored clone moved from 3 to 17 migrations with no seed. All 17 database checksums match release SQL, all are finished and none are rolled back. Exact checksums and postflight aggregate counts are in private evidence.
- Current local stack: a fresh encrypted local backup and isolated restore passed. This does not prove off-device recovery for the intended Production target. A target-shaped local runtime smoke passed health/login/unauthenticated-denial checks.
- Independent reviewers: finance/UAT report PASS, backup/restore PASS for local current-stack and synthetic RC exercises, final readiness report-accuracy PASS. Their combined verdict remains NO-GO for Production cutover.
- A fresh read-only continuation audit confirmed that the running `taky-erp` stack belongs to the primary checkout and local Docker Desktop, but did not establish it as the intended Production host. The release Compose configuration cannot render in the current shell because `PHASE4_PROJECT` is unset; no registry or off-device backup/recovery path is configured. No credentials or services were changed.
- Cleanup verification found a leftover test-only host-network HTTP probe with no mounts. It is now stopped and retained as an exited container; the four original `taky-erp` services remain healthy and all volumes were preserved.
- Public-safe report is `docs/project-execution/phase4-rc1-image-uat.md`. It was added in commit `1ee44a3`; the documentation PR branch `codex/phase4-production-prep` contains the report and this continuation checkpoint, with PR #1 open against `release/phase4`. The release branch/tag and application source were not changed.
- Detailed raw browser traces, PDFs, credentials for synthetic users, keys, encrypted backup archive, host/network metadata and readiness evidence remain private under the ignored `.local/phase4-prep/` directory. Test containers were stopped and their volumes retained. The original `taky-erp` services and volumes were left running/unchanged.

### Open cutover gates

1. Identify the intended Production host/context/project/database/attachment-volume mapping and reconcile the checked-out versus running app/Caddy configuration and network binding. Private endpoint details are kept out of this public checkpoint.
2. Configure an authorized off-device encrypted backup location, escrow the recovery key separately, and prove download plus restore/rollback on a second device.
3. Publish immutable images to the selected registry and pull/run them on the intended host/architecture; local Docker image IDs are not registry manifest digests.
4. Prepare and verify UID/GID 1000, mode 0700 attachment permissions on the intended target and confirm owner-device trust for its HTTPS certificate.
5. Re-run target-bound checks and independent final audit after those gates pass, then execute cutover and post-deployment verification. Do not treat the local RC UAT as Production acceptance.

Private release evidence `STATUS.md` is the detailed live status. Current verdict: **NO-GO; no Production migration, restart, cutover or deployment occurred.**
