# Payments UI independent code review

Reviewer: `payment_ui_code_review`, 2026-10-23. Baseline: `6da96b7`. Scope: the new payments page, `src/features/payments/**`, and `tests/payment-ui.test.ts`. I read AGENTS.md, the installed Pstack adapter, feature/review sequence, TypeScript/type-system guidance, unslop, React guidance, installed Next server/client guide, and the accepted UI contract/design review. I did not change application code, Git state, databases, or browser environments.

Decision after final evidence review: the scoped persisted Payments UI and its recovery correction are accepted for local integration. UI-CR-01 is closed. The14 reviewed Agent UAT cases passed in the actual isolated app. Broader integrated regression and remaining release requirements still apply; this is not project completion or production approval.

## UI-CR-01 — preserve uncertainty after a failed retry

Priority: high; financial duplicate-prevention risk.

`src/features/payments/journal.ts:92` classifies every well-formed 4xx as a definite rejection, regardless of whether this POST retries an earlier uncertain command. `retryAttempt` at line139 changes state to submitting and retains no marker that the original response was lost. A later 403 therefore replaces the unresolved attempt with a dismissible rejected attempt. `dismissSettled` at line64 and `submitAttempt` at line122 then permit discarding it or submitting a fresh command key.

Concrete sequence: the first confirmation commits but its response is lost; the ADMIN is demoted before exact retry; authorization runs before replay lookup in `src/server/payments/service.ts:110`, so retry returns403. That response does not establish whether the original confirmation committed. The UI nevertheless says rejected and allows a new intent. A create command can similarly encounter changed authorization or an intervening HTTP boundary rejection. The accepted UI contract explicitly requires preserving the prior unconfirmed result on403 and states that a later rejection cannot prove the disconnected attempt failed.

I executed the actual journal module with a mocked transport only: first call throws response-loss, second returns a JSON403/FORBIDDEN, then `submitAttempt` is invoked with a new key. Observed output:

```text
after lost response uncertain 1
after retry403 rejected 2
after fresh key new-key 3
```

Execution used `node --import tsx --input-type=module -e` against the real module. The initial tsx CLI invocation could not open its local IPC pipe under the sandbox; the Node loader invocation above succeeded without a listener or escalation. This reproduction proves the client state transition and request admission, not a real database duplicate.

Required correction: model prior uncertainty independently of the latest HTTP response. Preserve the original key/body and block new financial commands when a retry returns a rejection that does not establish the first outcome. Retain actionable permission/error text. Do not clear the uncertainty merely because a later response is4xx; only a valid replay/current authoritative reconciliation can establish the earlier result. Preserve the documented401/full-document-exit handling and generation protection.

Retest: lose the initial response, retry with403 and a structured422 boundary response, then attempt dismissal and a new-key command. Both must leave the original unresolved command protected, with no third POST. Verify exact successful replay subsequently settles and permits normal commands. Run the actual browser response-loss/navigation/role-change case against isolated persisted data.

## Executed checks and remaining evidence

Independent command `npx vitest run tests/payment-ui.test.ts` passed26/26 tests in one file. Those tests cover exact decimal helpers, Bangkok calendar validation, transport envelopes, basic response-loss replay, double submission, actor/generation clearing, and document lifecycle events. They do not cover UI-CR-01. The browser lifecycle test uses an EventTarget substitute; it does not establish Next navigation, real logout, browser cache restoration, dialog focus, or persisted payment uniqueness.

Static review found no additional material issue in exact minor-unit arithmetic, HTTP body omissions, server/client imports, invoice-version selection, managed-only paging, frozen receipt label rendering, STAFF action gating, or stale detail-read abortion. This is bounded code review, not proof that all required browser scenarios pass. Main must retain the required real browser tests, including all-history allocation paging, malformed/slow responses, stale-version races, receipt mismatch, keyboard/narrow viewport behavior, and real logout/navigation recovery. Full integrated typecheck/lint/build and broader suites were reported by the implementation owner, not re-executed in this review.

## Correction retest and browser test review

The implementer added `mayHaveCommitted` to the frozen attempt. Initial transport ambiguity sets it true. Retry retains it. A later structured403 or422 now leaves the attempt uncertain, displays the server code/message, and retains the original key/body. Existing uncertain-state guards prevent dismissal or a new command. Valid schema-checked replay can settle successfully; the accepted401 and pagehide clearing/generation rules remain intact. This corrects UI-CR-01.

I independently reran `npx vitest run tests/payment-ui.test.ts`:28/28 passed. The two new parameterized cases exercise the actual journal with lost initial response, retry403/422, attempted dismissal and new-key submission, and subsequent exact successful replay. They assert the original serialized bodies across all admitted POSTs and assert no third request before the deliberate replay. These checks would fail on the previous implementation. They use mocked transport and do not prove persisted uniqueness.

The serial AppShell change only adds Billing and Payments to the existing database-backed route classification and corrects help/footer wording. Other unfinished modules remain described as demo. It changes no authentication, navigation, data mutation, or shared journal lifecycle.

I inspected all10 new guarded `payment-persisted.spec.ts` scenarios. They retain the existing verified target fixture, synthetic data, actual payment/invoice services, and exact persisted count/snapshot checks. Response-loss handlers call `route.fetch()` before dropping the browser response, so those cases intend to exercise actual committed financial operations. The real demotion case restores the test ADMIN role in `finally`. The101-invoice case checks that the second page appears, rather than assuming the first100 entries cover history. Malformed responses and receipt mismatch are intentionally injected HTTP failures, not actual database corruption. No browser test was executed by this reviewer, and collection/code presence is not a pass.

The10 cases do not yet establish every accepted browser requirement. In particular, the navigation case waits for the uncertain response before leaving, so it does not prove original POST settlement while Payments is unmounted. There is no explicit real browser double-click submission, two-ADMIN allocation race, or console/hydration assertion. The keyboard case checks Escape/focus return and reopening plus Axe, rather than completing the whole financial flow only by keyboard. Payment list pagination beyond50 records is not exercised by the101-invoice allocation test. Main should record these as remaining UAT coverage, execute the required additional scenarios or document a scoped deferred acceptance, and avoid marking the full browser contract verified solely from these10 cases. No additional material application-code defect was established during this bounded correction review.

## Browser-discovered recovery correction review

Main subsequently executed14 actual isolated browser scenarios. The preserved `evidence/agent-uat/payment-ui-browser.log` reports10 passed and4 failed for run `09315d4d52c7272074c81c2b`. Three failures exposed a real recovery UX defect: the journal controls were outside the active Radix modal and therefore unavailable while that modal made background content inaccessible. I inspected the saved demotion-case accessibility context: it contained the dialog and disabled financial controls but no retry button. The fourth failure was a strict locator matching both the intended application alert and Next's route announcer. That distinction matters: the first three required an application fix; the fourth required a more precise assertion.

The correction extracts `CommandRecovery`. With an active payment form, submitting/uncertain recovery renders inside the dialog; after close it renders on the page. These placements are mutually exclusive. Rejected form responses remain in the existing inline error, avoiding a duplicate live alert. Recovery buttons use the existing Button default `type=button`, so retry cannot accidentally submit the enclosing financial form. There is no new command construction, key replacement, journal reset, or persistent storage. The original immutable attempt and `mayHaveCommitted` protections are unchanged.

Three revised browser scenarios now require the retry control inside the active dialog. The retry403 scenario actually clicks it there, checks the protected error in the dialog, closes, then checks the same unresolved state on the page. The malformed-response assertion selects the visible alert containing the expected message, without hiding or deleting the framework's valid announcer. These assertions test the observed failures rather than bypassing modal semantics.

Four additional browser scenarios address the prior coverage review: a native double click with an explicitly delayed original POST settling after navigation unmount; two distinct ADMIN contexts racing a real invoice;51 managed payments requiring list pagination; and a keyboard-only payment/confirmation flow with console/page-error checks. They remain subject to the fresh actual run. I have not executed browser tests or inferred their success from their presence. Main owns the fresh build and14-case rerun.

Independent correction check: `npx vitest run tests/payment-ui.test.ts` passed28/28 again. No new material code finding remains. Code review accepts the scoped recovery correction; browser verification remains pending.

Reviewed SHA-256 values:

```text
97f88f99d62097f9401595a397e5c771ba0a751d8b0ae585c09f5207420cc357  src/features/payments/recovery.tsx
455d369a2bcc368c2e3160d74e48466562b9d62dfee654f976aef12bdecebef7  src/features/payments/screen.tsx
108cdea01dcdb650430bbc9d00b501d75fc95130859de5e42c1baae1ed8b0f4d  src/features/payments/journal.ts
f892a6c0fb5f9626c4f8b7fcad510efa1cffc5dfb35394fb0e26bb8be56c44fe  tests/phase2/payment-persisted.spec.ts
6107e09d347500c9870367eb4ee75991ecafcc51c9396eab7ecc6413d69448e0  tests/payment-ui.test.ts
```

## Final independent Agent UAT evidence acceptance

I independently inspected the fresh run `4ab0ea5ccac38cee31e0d4cb`: the parent log, raw child browser log, `results.json`, `execution.json`, `database-identity.json`, attempt record and nonsecret isolated project manifest. They agree on the run, loopback app3820/proxy3822, isolated database port55452, database `taky_phase2_test`, and generated role `e2e_4ab0ea5ccac38cee31e0d4cb`. The raw browser log contains the existing challenged target verification before the scenarios. The manifest names the dedicated Docker project/volume/subnet. I did not reconnect to the database or run another browser session.

The JSON results contain14 expected passes, zero skipped/unexpected/flaky tests, one result per case with retry0 and no errors. Duration is72767.836ms. The child log records exitCode0, the execution record says browserStarted/succeeded true, and the parent reports successful scoped cleanup while retaining its test volume. The recovery-build log reaches the completed Next route output; its process exit0 was recorded by Main, rather than independently rerun here. The previous10/14 failure evidence remains preserved.

The actual passes cover STAFF pending bank capture and reload; Bangkok timestamp; ADMIN exact multi-invoice allocation, immutable receipt labels/snapshot, reversal and pending cancellation; lost create response with Next navigation and exact replay; cash duplicate review; stale invoice rejection; maximum amount/precision checks; narrow viewport/Axe; uncertain403 recovery inside the dialog; logout/account change; real ADMIN demotion and successful exact replay after restoration;101-invoice allocation paging; malformed list, delayed detail and receipt mismatch; bank duplicate and failed allocation source; native double click with original POST committing after unmount; two ADMIN browser sessions racing real explicit allocations with one200/one409 and exact0.80 paid/0.20 outstanding;51-payment list paging; and a complete keyboard payment/receipt flow with clean browser console/page-error assertions.

All five current source SHA-256 values still match the frozen values above, including the recovery renderer, screen, journal and two test files. No application change occurred during this review.

Scoped acceptance: the reviewed Payments UI, its financial command recovery and these14 Agent UAT cases satisfy the local implementation acceptance checked here. Full cross-module integration regression must still run before the milestone is closed. These scenarios do not establish every possible session-expiry/disabled-account path or durable recovery after browser crash. Receipt PDF/operational print remains unimplemented and is deliberately absent from this UI. No claim of human Owner UAT, real-data reconciliation, legal receipt facts, deployment, Go-Live or production readiness follows from this acceptance.
