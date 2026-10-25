# Retained deposit evidence candidate

This implementation follows the adopted deposit contract and the route transport accepted by Main. It needs independent review and actual database, validator, backup and browser acceptance before integration. The copied 44-model Prisma schema is coordinator-owned and deliberately excluded from this component's commits. The generated client is private to this worktree.

Implemented raw upload, accepted-only listing, verified download and the required financial verifier. Upload authenticates current enabled ADMIN under an actor-specific held database session lock, records durable rolling admission before reading bytes, stages at most 5 MiB, calls the explicitly configured real validator, then acquires the shared source gate and publication transaction gate. It rechecks authorization and lease, counts actual retained bytes including orphans and partials, durably retains the file, and atomically inserts Attachment, DepositEvidence and acceptance audit. Database failure after retention leaves an unaccepted retained orphan; ordinary code does not delete it. Unaccepted OS input is cleaned separately.

`lockAndVerifyDepositEvidence(tx, { leaseId, evidenceId })` locks evidence and attachment metadata, requires same-lease accepted ownership and returns evidence/attachment identity only after reading the regular retained file through a bounded descriptor and verifying exact length and SHA-256. No metadata-only fallback exists. Downloads serve those same verified bytes with attachment disposition, no-store and nosniff. Current STAFF/ADMIN read authorization is reloaded in repeatable-read transactions. Filenames never choose a storage path.

## Exact API transport

- POST `/api/v1/deposit-evidence/?leaseId=<uuid>&originalName=<encoded filename>` accepts raw binary bytes and canonical `Content-Type` application/pdf, image/jpeg or image/png. It requires the existing mutation Origin and current ADMIN. Query parameters are strict and unique. Forged actor/path/header-shaped query keys, compressed request transport, missing body and invalid or over-limit Content-Length reject. Streamed bytes are bounded independently of Content-Length. Existing JSON body limits are unchanged.
- GET `/api/v1/deposit-evidence/?leaseId=<uuid>&offset=0&limit=50` returns only accepted evidence and current same-snapshot count. Default limit50, maximum100. Unknown and repeated query keys reject.
- GET `/api/v1/deposit-evidence/<id>/download/` takes no query parameters and requires current STAFF/ADMIN. The public DTO contains id, leaseId, originalName, mimeType, bytes as a safe number, sha256, uploadedById and acceptedAt. No private storage key or absolute path is exposed.

## Validator and filesystem requirements

The application sends the staged bytes to `/validate` at configured `EVIDENCE_VALIDATOR_ORIGIN` and authenticates with the exact64 lowercase-hex `EVIDENCE_VALIDATOR_TOKEN`. Only http loopback or the exact evidence-validator service hostname on port3835 is accepted, with no credentials/path/query/fragment in the configured origin. Redirects reject. The response must be no more than1024 bytes of JSON matching exactly `{ valid: true, mimeType, bytes }`; MIME and count must match the submitted file. Missing configuration, failure, timeout or an unexpected response fails closed. No parser is faked in application code.

The validator owner supplies the independently reviewed Linux qpdf/sharp implementation and container resource bounds. The application boundary has a ten-second validator deadline. Source body staging has a thirty-second deadline after admission. Acceptance uses a ten-second transaction and a nonblocking publication lock, returning409 while backup/publication owns the gate. These are new documented local technical bounds, not performance measurements or a claim about production capacity.

`ATTACHMENT_DIR` must identify a canonical, owner-owned private directory with no group/other permission. Test helpers must create it0700; the older Docker-created0755 directory is not silently accepted. Existing accepted files remain0400 inside private0500 random namespaces. Parent directory symlinks, nonregular retained entries, traversal and unexpected retained-file length/hash reject. Directory counting uses iteration rather than materializing an unbounded directory listing.

## Local proof and pending real gates

Focused tests exercise actual temporary-file staging, quota counting including partials/orphans, private retention, file mutation/missing-file rejection, abort and failure cleanup, strict query parsing, routes, and the validator protocol. Database metadata and framework actor boundaries are replaced in selected unit cases; the actual filesystem is used for verifier cases. The validator protocol unit cases replace only fetch. They do not establish real session locks, SQL admission, the real structural parser or production upload integration.

The first storage test failed because macOS returned a noncanonical `/var` temporary path. The fixture now resolves its own directory to the canonical path; application path checks were retained. That correction is not a relaxation of storage security.

Main must execute real PostgreSQL role/admission/quota/concurrency tests with the real validator, mutation rollback/orphan tests, current-role changes, same-lease retained-file posting, malicious file cases and the publication session-lock backup/restore proof. Browser Agent UAT must cover a genuine retained upload and download. No such runtime gate has been executed in this implementation worktree.

Executed on this candidate: 23 focused tests in four files passed; scoped ESLint and TypeScript --noEmit both exited0. Exact local outputs are unit.log, lint.log and typecheck.log. Empty lint/typecheck logs mean those commands produced no output; Main's command completion evidence records their exit codes. Source whitespace verification passed after staging.
