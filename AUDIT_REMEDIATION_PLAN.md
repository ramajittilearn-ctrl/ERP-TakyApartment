# Audit remediation plan

Baseline: `701acf8cc751a9197bb83b548ef91483b7082ed3`. Audit: `01a5233f5626193ec65bcdcc6a17782c59c84733`. Branch: `codex/audit-remediation`. Worktree: `/private/tmp/taky-audit-remediation`.

## Evidence and safety

Read AGENTS.md, installed Pstack Codex adapter, bug-fix playbook, TypeScript guidance, decision-trail and writing guidance. Read the audit register, regression report, security/financial report, readiness assessment, full report and decisions at the audit commit. Their findings remain hypotheses until reproduced. Existing calling-checkout edits and UAT services on port 3700 are excluded.

Use fresh Compose project names, volumes and credentials. Reserve database loopback ports 55451 onward and browser app port 3820. Do not read operational credentials, modify retained databases, push, merge or deploy. Preserve raw redacted logs and actual exit codes in `evidence/remediation/`.

## Work packages

| Finding | Modules and hypothesis | Smallest proposed change | Verification and risk |
| --- | --- | --- | --- |
| F-09 | auth service, login route, LoginThrottle; global counter increments even successful requests | Remove global lockout; retain uniform identifier/account protection; evaluate trusted source limits and bound throttle storage | Isolated PostgreSQL reproduction, positive/negative/window/concurrency tests and existing authorization suite; medium security risk |
| F-11 | Playwright config and fixture imports trust parent env and loopback alone | Fail closed on exact effective origin and connected database identity before writes; reject redirects and overrides | Negative target/config tests, real isolated app attestation and guarded browser/API requests; medium test safety risk |
| F-13 | meter fixtures consume finite retained rooms | Guarded runner provisions a fresh database/project/volume per complete browser run; deterministic seed; retain failed evidence | Execute full workflow twice, distinct verified identities, no retained-data cleanup; low product risk |
| F-12 | responsive axe scan races invoice initial loading | Reproduce delayed loading; assert loading/error/ready semantics and wait for ready before general scan; fix UI only if defect confirmed | Unmodified axe rules in deterministic loading and ready states, full browser suite; low UI risk |
| F-06 | actual operational identity/inventory unavailable | Read-only verification procedure and closure evidence checklist | Remains OPEN pending target verification; no operational connection |
| F-10 | roadmap PDF acceptance unresolved | Owner options and milestone dependencies | Remains OPEN pending explicit decision; no PDF code |

## Sequence and acceptance

1. Verify Git state, finish isolated checkout and record reproducible evidence tooling.
2. Main agent handles browser guard, fresh-target runner and accessibility investigation. A bounded authentication specialist may own F-09 without touching browser files. Inspect capabilities before delegation.
3. Run unit, operations, PostgreSQL integration/security, target rejection tests, typecheck, lint, formatting, Prisma validation/migration status/drift, production build and standalone startup. Run browser workflow twice.
4. Independent read-only reviewer checks correctness, security, data safety, reliability, scope and Stage 3D impact. Resolve material findings.
5. Write required reports, review trail against actual outputs, confirm calling checkout/UAT identity unchanged and commit locally. CLOSED requires reproduced cause, fix, regression coverage, applicable passing verification and review support.

Stage 3D requirements/design remains conditional. Business implementation requires approved requirements and F-10 disposition. Production billing remains NO-GO pending F-06, UAT and operations commissioning.

## Evidence-driven plan updates

The independent reviewer identified page-route bypasses and missing early cleanup. The final design uses an exact-destination HTTP/CONNECT proxy rather than replacing native Playwright context internals. This preserves existing page hooks and checks every redirect destination. Cleanup now spans provisioning onward and removes only the current generated project network/container while retaining its volume. An injected setup failure and subsequent successful workflow verify the lifecycle. Docker network-pool exhaustion was resolved by removing only a stale network/container created during this remediation.

F-09's shared lockout is corrected, but source admission and hard active cardinality/work bounds remain unresolved under the existing deployment contract. Its final status remains PARTIALLY RESOLVED. No UAT deployment change is authorized to address that residual.
