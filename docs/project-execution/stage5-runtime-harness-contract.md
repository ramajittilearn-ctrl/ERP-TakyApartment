# Stage 5 runtime verifier contract

## Problem

The current hosted container check builds and smoke-tests the app, validator, and operations images, then exercises backup/restore. The separate browser Agent UAT covers UI flows but does not prove a full current-source billing-to-invoice-to-payment-to-receipt-PDF flow through the release runtime. Older Stage 5 evidence is tied to an earlier source revision. The new verifier must use an isolated synthetic Compose run and must not turn unresolved billing policy into a test expectation.

## Usage

```
node scripts/verify-stage5-runtime.mjs
```

```
STAGE5_ARTIFACT_ROOT="$RUNNER_TEMP/stage5" node scripts/verify-stage5-runtime.mjs
```

```
- name: Verify synthetic Stage 5 runtime
  run: node scripts/verify-stage5-runtime.mjs
```

The CLI identifies the clean checkout, creates one private run, builds and checks the app image, starts an isolated DB/app/Caddy stack, applies migrations, exercises one reviewed synthetic financial flow, captures sanitized evidence, and removes only resources it can prove belong to the run. On failure it removes owned containers and the network, retains owned volumes for diagnosis, and deletes the generated credential file before evidence upload.

## Shape

One orchestrator owns run identity, Docker mutations, generated credentials, Compose configuration, scenario order, evidence, cleanup, and process exit status. Small scenario modules may own billing/payment HTTP assertions and PDF inspection, but they cannot create, preserve, or tear down infrastructure.

```ts
type RuntimeOptions = {
  artifactRoot?: string;
};

type SourceIdentity = {
  pullRequestHeadSha: string;
  checkoutCommit: string;
  checkoutTree: string;
  appImageId: string;
};

type RunIdentity = {
  runId: string;
  project: string;
  ownerLabel: string;
  origin: URL; // https://127.0.0.1:<run-selected-port>
  envFile: string; // generated, mode 0600, removed in finally
  composeFiles: readonly string[];
};

type RuntimeReport = {
  schemaVersion: 1;
  source: SourceIdentity;
  run: { runId: string; project: string; origin: string };
  migrations: Array<{ migration_name: string; checksum: string }>;
  checks: Array<{ name: string; status: "passed"; evidence: string }>;
  invoice: { number: string; total: string; pdfSha256: string };
  payment: { reference: string; amount: string; allocated: string };
  receipt: { number: string; pdfSha256: string };
  cleanup: { ownedResourcesRemoved: string[]; retainedVolumes: string[] };
};

async function runStage5(options: RuntimeOptions): Promise<RuntimeReport>;
```

The caller has no project-name, database URL, origin, host-volume, or secret override. The verifier generates a validated run ID, private database identity, credentials, and a loopback HTTPS origin. It rejects dirty source and any existing resource matching the new project/owner identity before performing Docker mutations. Before inspecting or changing Docker resources, it checks `docker compose version --short`, requires Compose 2.24.4 or newer for `!override`, and records the parsed version in run evidence. Docker receives a sanitized child environment with Docker/Compose/database/run overrides removed and is forced to the `default` context; the endpoint must be a local Unix socket, and daemon identity is recorded. Before building or starting resources, it asserts rendered Compose credentials, database URL/host, origin, source/run/project labels, immutable images, network topology, exact services, and mounts. Failed subprocess checks contribute only redacted stdout/stderr and spawn-error excerpts, capped at 120 lines and 16 KiB; generated values and cookie/token/authorization/password patterns are removed. Excerpts retain both the beginning and end when truncated, with truncation recorded separately, and the thrown error remains generic. It captures redacted, bounded owned-container logs before cleanup. On failure it removes owned containers/network, retains owned volumes and image for diagnosis, and keeps credentials outside the artifact directory.

Only the database, app, and Caddy are started across three labeled networks: `db-private` is internal and connects DB plus app; `proxy-private` is internal and connects app plus Caddy; and `ingress` is a regular bridge connected only to Caddy. This keeps DB unreachable directly from Caddy and blocks app outbound access while giving Caddy the bridge path required for its loopback-published HTTPS port. Caddy is the only egress-capable workload because it alone joins the regular bridge; it runs from the pinned Caddy image and serves only this run's synthetic ERP records with generated credentials. Neither DB nor app receives a host-published port; Caddy publishes only on 127.0.0.1. Preflight requires exactly these networks and verifies their rendered drivers, internal flags, service membership, and run ownership labels. After startup, the orchestrator inspects each live run-owned network, verifies exact container membership and ownership labels, and records the network facts before checking Caddy's actual 443/tcp host binding is exactly 127.0.0.1:<selected-port>. It then makes a bounded TCP connection probe to the selected host port before running the Node API scenario; Caddy's container healthcheck only proves its internal admin endpoint and does not establish host-port readiness. Caddy is configured with the same 127.0.0.1 IP hostname used by the HTTPS origin. Its generated root CA is extracted from the run-owned volume and trusted by Node and Chromium; normal certificate chain and IP subject-alternative-name checks remain enabled. The Compose project and Docker resources carry a dedicated ownership label. Cleanup reads those labels back before removal, never uses compose down -v, prune, process/port kill, or a general remove command, and preserves the DB volume plus sanitized diagnostics on failure.

The migration phase starts only the fresh database, then probes identity and confirms its public schema is empty through the app's exact rendered `DATABASE_URL`. Only then does it run the bundled Prisma CLI with migrate deploy before the app starts. It compares the complete ordered set of checked-in migration names and checksums with _prisma_migrations rows, requiring successful completion and no failed/rolled-back entries. It never runs migrate reset or seed. Generated admin/staff passwords are excluded from the Compose interpolation file and persistent app service environment. They are forwarded by environment-variable name to the one-shot bootstrap container and separately supplied through the host-side scenario process environment for API login. Secret values are not placed in command arguments, artifacts, or logs.

Fixture setup creates only synthetic ADMIN/STAFF users and run-keyed property, room, tenant, lease, meter, billing period, and rate data. The HTTP scenario compares returned Prisma Decimal strings by exact integer satang value, since JSON serialization may omit insignificant trailing zeroes. For each utility, the HTTP scenario registers a synthetic meter and confirms a prior-period reading plus a current-period reading. With exactly one confirmed reading in the open period, billing preview selects the ACTUAL source automatically; the scenario verifies the 1.000 Decimal delta and currently selected utility rate in the preview snapshot before closing the period, preparing and issuing an invoice, recording and confirming a payment allocation, fetching a receipt, and downloading invoice and receipt PDFs. After issue and receipt, it changes synthetic live property, tenant, room-rent, and lease data through APIs, then proves the invoice and receipt snapshots, labels, numbers, and totals remain frozen and both regenerated PDFs still contain the original labels. Expected financial values come from accepted billing/payment specifications and existing behavior tests; all expected and observed amounts stay decimal strings. The scenario checks unique numbering, retry/duplicate semantics already specified by the domain, payment/allocation reconciliation, and the matching audit events. It adds no rounding, partial-payment, or receipt policy.

PDF verification checks response headers and filenames, byte length, valid PDF envelope/EOF, exactly one A4 page, text extraction, document numbers, and the exact formatted numeric amount `1,050.01`; source-mutation renders must contain the original frozen labels. Thai glyphs are checked in extracted text and OCR from rendered images using the Thai Tesseract model; text extraction alone is not treated as proof of glyph rendering. Automated OCR does not reliably identify the baht symbol, so the report marks baht-glyph visual confirmation pending; rendered PNGs are retained in the CI artifact for a reviewer to inspect. The harness does not claim that baht glyphs have been visually verified.

Evidence contains PR head SHA, actual merge/source checkout commit/tree, local Docker daemon identity, app/database/Caddy image IDs, database image reference, migration name/checksum/status, scenario check results, decimal strings, invoice/receipt numbers, PDF hashes, and ownership-aware cleanup outcome. On success, the exact run-labeled app image is removed; on failure the image is retained and reported. Evidence excludes credentials, cookies, raw DB dumps, names from real data, and full auth traces.

## Synthesis decision

The Pstack arena selected Candidate A's single lifecycle owner because one component can enforce source identity, migration ordering, evidence capture, and cleanup together. Candidate B's split API/browser scenarios are grafted under that owner so financial and browser failures remain attributable while only the orchestrator mutates infrastructure. Rejected: Candidate B's independent keep flag and arbitrary-origin browser entry points, which weaken resource ownership; extending deployment-input validation with app behavior; and reusing existing fixed-port verifiers unchanged.

Independent cross-review required these refinements before implementation: use and trust the run-local Caddy CA without disabling TLS checks; reject pre-existing project/resources and fail closed on port collision; verify migration names/checksums/status rather than counts; derive financial assertions from the accepted contracts and existing tests with decimal strings; check PDF structure and rendered Thai glyphs; and delete only Docker resources whose ownership labels match the run.

## Tradeoffs accepted

- We accept a longer CI job for source-bound financial and PDF evidence in exchange for not treating an older runtime run or broad browser suite as proof of the current release runtime.
- We accept preserving failed-run volumes for diagnosis in exchange for a manual cleanup task when ownership cannot be proven.
- We accept a single run-scoped port probe with fail-closed collision behavior because the selected port cannot be reserved atomically across Compose startup.

## Alternatives considered

- Split infrastructure orchestration among shell, CI YAML, and separate API/browser commands: rejected because project identity and cleanup invariants would be duplicated across callers.
- Extend the existing invoice verifier without changing its fixed ports, database role, and origin: rejected because those assumptions can collide with concurrent or existing test environments.
- Extend the deployment verifier: rejected because it validates release inputs and Compose rendering, not synthetic ERP behavior.

## Remaining verification

- CI installs Chromium, the isolated NSS certificate utility, PDF structural/text tools, and Thai OCR packages on `ubuntu-24.04`; the job must confirm tool compatibility.
- The app image is built from the exact source checkout. Evidence records the app image content ID, pinned DB image reference/content ID, and runtime Caddy image content ID.
- CI execution on a committed clean PR checkout and independent review remain necessary. Local container execution is avoided to protect existing UAT resources.
