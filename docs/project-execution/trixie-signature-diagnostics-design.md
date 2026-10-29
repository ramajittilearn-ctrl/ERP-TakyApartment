# Trixie signature diagnostic design

## Problem

The exact-head hosted run 40856630605 completed all four isolated APT updates and emitted a proposal. The following host-side `gpgv` check failed on an `InRelease`, but the validator discarded the executable version, exit code details, status lines, and stderr. The same failure occurred in PR run 40856639185. The current result is a real rejection with an unknown cause. APT update success does not replace the independent verification gate.

The accepted signature policy is strict: `gpgv` must exit zero, produce at least one `VALIDSIG`, and produce none of `BADSIG`, `ERRSIG`, `NO_PUBKEY`, `EXPKEYSIG`, `REVKEYSIG`, or `NODATA`. This policy is unchanged by the diagnostic work.

## Synthesis decision

Use candidate A's separate, structured, per-suite diagnostics artifact. Keep the discovery evidence immutable because its `evidenceSha256` inventory is finalized before proposal validation. The validator writes per-attempt diagnostics and a terminal validation manifest to a fresh sibling directory supplied by CI. A failed diagnostic write remains a validation failure.

Graft from candidate B: verify private snapshots of the exact InRelease/keyring bytes against their already-bound hashes immediately before and after subprocess execution; add real multi-signature verifier fixtures; and, when needed, trace the pinned image's actual APT-selected verifier without replacing or assuming it is `sqv`.

## Shape and flow

`validate_proposal(evidence_dir, diagnostics_dir)` receives the immutable discovery root and a separate output root. It rejects symlinks, path overlap, and nonempty stale diagnostic directories. The validated acquisition loop passes a bound request to `verify_inrelease_signature`:

```python
@dataclass(frozen=True)
class SignatureRequest:
    suite: str
    source_file: str
    source_stanza_sha256: str
    inrelease_file: str
    inrelease_sha256: str
    inrelease_size_bytes: int
    keyrings: tuple[BoundKeyring, ...]

@dataclass(frozen=True)
class VerifierObservation:
    verifier_path: str
    verifier_sha256: str
    version: str
    argv: tuple[str, ...]
    returncode: int | None
    status_tokens: tuple[StructuredStatus, ...]
    stdout_sha256: str
    stderr_sha256: str
    redacted_stderr: str
    accepted: bool
    failure_reason: str | None


def verify_inrelease_signature(
    request: SignatureRequest,
    evidence_dir: Path,
    diagnostics_dir: Path,
) -> VerifierObservation: ...
```

The verifier snapshots only the validated release and source-bound keyrings to private temporary files, checks hashes before and after invocation, uses an empty private homedir, fixed locale, no shell, explicit keyrings, bounded execution/output, and a finite timeout. Missing tools, malformed status, timeout, launch failure, mutation, unknown verifier failure, nonzero exit, missing `VALIDSIG`, or any forbidden status reject. Diagnostic collection never changes the acceptance predicate.

Each suite writes one safe-named JSON record with run identity, suite/source stanza, evidence-relative release path/hash/size, exact keyring paths/hashes/sizes, verifier path/hash/version, normalized argv, return code/termination, ordered structured statuses, redacted stderr, stream hashes, and acceptance reason. `validation.json` binds the diagnostics to the GitHub run/head and discovery `run.json`/proposal hashes, and ends `REJECTED` or `VALIDATED`. It is outside the discovery evidence tree and is uploaded with `if: always()`.

Do not store arbitrary UIDs or raw environment/configuration. Preserve well-formed public key fingerprints and technical status fields; redact `GOODSIG`/`BADSIG`/`EXPKEYSIG`/`REVKEYSIG` user IDs, credentials, temp paths, and control characters. Hash raw subprocess streams for correlation, but persist only bounded, sanitized output. Sanitization must not alter the in-memory status evaluation.

## Reproduction

A diagnostic-only comparison uses the exact captured InRelease bytes and exact source-bound keyrings with the same pinned PostgreSQL image digest. Record APT version, verifier package versions, executable identities, effective signature configuration, and the actual verifier APT invokes. Do not infer the selected executable from installed-tool inventory or from a fixture. If the method invocation cannot be established, mark the comparison inconclusive.

Compare host `gpgv`, image `gpgv`, and the actual APT-selected verifier on the exact hashed bytes. If APT requires derived detached-signature input or other framing, capture/hash the derivation and preserve the original InRelease hash link. Use no network or ambient keyrings in replay. A comparator result never overrides a failed host check. Change acceptance or verifier policy only after a controlled reproduction identifies the cause and a separate cross-review approves a narrow correction.

## Alternatives considered

- Raw stderr in the GitHub log was smaller but gives weak per-suite traceability, exposes arbitrary output to CI logs, and does not preserve successful or failed attempts as machine-readable evidence.
- A verifier adapter without a separate output manifest isolates subprocess mechanics but risks mixing diagnostics into the discovery hash inventory and makes partial-run state hard to distinguish from success.
- Changing trust policy immediately based on APT's success was rejected because the actual failed signer/status is unknown and APT may use different signature semantics.

The chosen separate report costs a small schema and lifecycle contract, while preserving immutable evidence and making each signature attempt reproducible.

## Verification criteria

- Unit tests cover zero/nonzero exits, nonzero plus `VALIDSIG`, missing `VALIDSIG`, every forbidden status, valid plus forbidden status, malformed/unknown status, launch failure, timeout, output limit, and report-write failure.
- Tests verify source-specific keyring selection, stable hashes before/after invocation, exact suite/path identification despite all files being named `InRelease`, and no mutation of discovery evidence.
- Redaction tests include UID, credential, control-character, and path injection without changing acceptance results.
- Linux cryptographic fixtures cover valid, tampered, wrong-key, and multiple-signature inputs. The hosted pinned-image comparison retains exact verifier identity and per-suite diagnostics.
- A successful comparison alone does not mark the candidate verified; all original four-suite source-bound `gpgv` checks and proposal validation must pass.

## Arena record

Candidate A was selected; the cross-judge scored it 5/5 on each rubric criterion. Candidate B scored 5, 4, 4, 4, 5. The useful grafts from B are private input snapshots with pre/post hash checks, a controlled APT-verifier trace, and explicit multi-signature fixtures. The distinction between APT's configured verifier and tools merely present in the image remains a risk and must be established by observation. Neither design resolves the current hosted rejection; exact status evidence is still required.
