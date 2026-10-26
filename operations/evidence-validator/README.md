# Private evidence validator

This service validates a staged file for the Stage 3E evidence owner. It does not retain accepted evidence or authorize a deposit command. Read `contract.md` for the agreed boundary and limits.

Run it through `docker-compose.evidence-validator.yml` together with the base application Compose file. Generate a private 64-character lowercase hex `EVIDENCE_VALIDATOR_TOKEN` outside source control. The app uses `EVIDENCE_VALIDATOR_ORIGIN=http://evidence-validator:3835` and sends that token once in `x-taky-validator-token`. Production has no validator host port. Main may add a separate loopback-only QA override.

`POST /validate` accepts at most 5 MiB of raw, uncompressed bytes. The successful response contains exactly `valid`, `mimeType` and `bytes`. The client must reject redirects, non-success statuses, malformed responses, MIME disagreement and byte-count disagreement. `GET /health` exposes only a readiness boolean and no parser or file details.

Each parse runs in its own Node worker process. qpdf descendants inherit the same process group. The parent kills that group on abort, deadline or output overflow and awaits process closure before releasing the admission permit. This stops native Sharp work as well as qpdf. The worker receives no service token or application environment. Its heap limit supplements the container's hard memory ceiling; it does not replace that ceiling.

The private service permits two active requests without a waiting queue. The absolute request deadline is eight seconds. qpdf output is bounded, JSON graph traversal is bounded, image decoding has an eight-million-pixel ceiling, and temporary inputs live on the bounded disposable filesystem. A container OOM or parser crash makes the app fail closed. It is not a validation success.

Use `npm ci` with the committed mini-package lock and `npm test` for focused tests. Main seeded this lock from the repository's existing locked Sharp closure and pruned it offline. This component changes no application package manifest or lockfile.

## Validation limits

qpdf's syntax check, encryption test and restricted JSON object graph are combined with strict PDF prefix/final-marker checks. They reject the listed executable/action/attachment forms; they do not prove complete PDF conformance or malware freedom. Images undergo a real full raw decode. Animated PNG and appended payloads are rejected. The accepted subset can reject uncommon but otherwise valid image/PDF constructs.

Bookworm's installed qpdf version and JSON version-two behavior must be measured in the built image. Newer online documentation is not runtime proof. Missing qpdf or Sharp prevents service startup. The production implementation has no permissive parser fallback.

## Main-owned acceptance

Before integration, independently review the source and execute the HTTP tests with loopback permission. Build the Linux image once, record qpdf/Sharp versions and inspect actual memory, swap, CPU, PID, filesystem, user, capability, mount and network settings. Verify real valid PDF/PNG/JPEG, malformed and truncated inputs, encryption, restricted PDF names/actions, oversize and pixel limits, authentication, duplicate credentials, capacity, disconnect, deadline, process failure and cleanup. Confirm no validator production host port, Docker socket, database or retained attachment mount exists.

HTTP lifecycle tests deliberately inject parser barriers to test admission and cancellation. They do not establish real qpdf acceptance. The real Linux validator and the application's upload-to-evidence integration remain separate required gates.
