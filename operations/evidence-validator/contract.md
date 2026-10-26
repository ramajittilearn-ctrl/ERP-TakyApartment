# Private evidence validator contract

This component implements the selected Stage 3E file-validation boundary. It has no database, attachment-volume, ledger, browser or production-deployment authority. Main coordinates its actual Docker build and verification. The baseline is `da74f28`; this worktree owns only `operations/evidence-validator/**` and `docker-compose.evidence-validator.yml`.

## Request and result

The app sends `POST /validate` with an unencoded raw file stream and exactly one `x-taky-validator-token` header containing the configured 64-character hex secret. The validator authenticates in constant time and acquires one of two process-local permits before reading the body. There is no queue. Duplicate credentials, unsupported paths/methods, missing authentication and exhausted capacity are rejected before body consumption.

The request has one absolute eight-second deadline, including body reading, temporary storage and parsing. The input is at most 5 MiB. The service detects PDF, PNG or JPEG itself and returns only `{ "valid": true, "mimeType": "...", "bytes": 123 }` after successful validation. Invalid, unsupported, malformed, encrypted, active-content, timed-out and over-limit inputs receive a generic error. No parser output, file body, filesystem path or credential enters a response or application log.

The application must fail closed on rejection, unavailable validator or invalid response. It retains its original file bytes only after this boundary and its own admission, retention and metadata transaction succeed. This service does not authorize evidence acceptance or financial posting.

## Parsing and limits

PDF requires a byte-zero PDF signature and a final EOF marker followed only by permitted whitespace. The fixed qpdf command first performs a strict syntax check with exit zero, rejects encryption, then exports JSON version two with stream data omitted. JSON output is capped at 4 MiB. An iterative bounded traversal rejects `/JavaScript`, `/JS`, `/AA`, `/OpenAction`, `/Launch`, `/SubmitForm`, `/ImportData`, `/RichMedia`, `/EmbeddedFiles`, `/EmbeddedFile`, `/Filespec` and `/XFA`, including names normalized by qpdf. Parser children run without a shell and with fixed arguments; caller filenames never become arguments. Each child is killed on request abort, deadline or output overflow. qpdf warnings are rejection, not repair or acceptance.

PNG and JPEG require strict signatures and terminal structures without an appended second payload. Sharp uses `failOn: "warning"`, an eight-million-pixel ceiling and a single-frame policy, and forces a complete raw decode. Metadata parsing alone is insufficient.

The image is Node 22 Bookworm slim with qpdf from its distribution and explicit Sharp `0.35.5`. Main must record actual binary versions and prove supported CLI/JSON behavior rather than infer it from newer qpdf documentation. Syntax validity and restricted active-content checks do not establish malware freedom or full PDF content conformance.

## Isolation and shutdown

The Compose overlay gives the validator a hard 512 MiB memory limit, one CPU, 64 PIDs, a read-only root filesystem, a 32 MiB private temporary filesystem, dropped capabilities, no-new-privileges and a non-root user. Only app and validator join the internal validation network. The app retains its existing private database network. Production exposes no validator host port and mounts no Docker socket, database or attachment storage. Main may use a separate QA override binding loopback port 3835.

The service uses private exclusive temporary files, removes its disposable parser inputs in `finally`, terminates live parser children on disconnect or deadline and releases its permit exactly once. Retained application evidence is never mounted here or deleted. Missing or invalid secret configuration prevents service startup. Native parser memory is bounded by the container cgroup, not by a Node heap flag.

## Files and verification

`server.mjs` owns HTTP admission and lifecycle. `validate.mjs` owns pure byte-envelope checks, fixed qpdf execution and raster decoding. Focused `node:test` cases verify admission, exact errors, bounds, cleanup, signal handling and format policies. Real qpdf/Sharp success and rejection must run inside the built Linux image; injected test substitutes are not runtime validation proof.

Before integration Main must inspect the actual cgroup limits, versions, network/mount configuration and real valid/malformed/encrypted/active/oversized/truncated fixtures, plus timeout or process-failure cleanup. Independent review must inspect both source and actual results. No such runtime verification is claimed by this design.

## Throughput checkpoint

- Blocking first steps: Main reviews this contract before implementation and owns image/runtime execution.
- Independent workstreams: app evidence retention, deposit ledger and this parser service have disjoint owners and files.
- Shared mutable state: the validator has only one process-local two-permit admission counter and exclusive disposable files; it shares no database or retained filesystem.
- Smallest safe decomposition: one implementation owner keeps HTTP deadline, child cancellation and cleanup consistent; Main and an independent reviewer verify the result.
