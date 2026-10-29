# Isolated Trixie PostgreSQL GnuPG-prune candidate

## Purpose and boundary

This work investigates whether the digest-pinned PostgreSQL 17.11 Trixie image can remove `gnupg` and the exact dependency closure selected by Debian APT. It does not change the operational image, shared PostgreSQL Dockerfile, existing Trixie collation candidate, UAT, or production. The discovery job performs no package installation or removal in a built image; its disposable container runs only authenticated metadata refresh and APT simulation.

Pinned discovery target: `postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe`, platform `linux/amd64`.

## Phase 1: hosted discovery evidence

The `container-verification` job pulls and inspects the exact target image, then runs `scripts/ci/discover-trixie-gnupg-removal.py` in a disposable container. Hosted discovery found `sqv` installed and `gpgv` absent. The shell-only collector records the detected verifier binaries and APT verifier configuration without installing or assuming `gpgv`, as well as sanitized APT source files, keyring hashes, installed package inventory, manual/automatic package state, authenticated `apt-get update` output, APT index targets, raw `InRelease` and local `Packages` files, and the purge simulation. It hashes each explicit Signed-By keyring with its referencing source file and fails if a keyring is missing or any active source enables `trusted=yes`, `Allow-Insecure`, `Allow-Weak`, `Allow-Downgrade-To-Insecure`, or disables `Check-Valid-Until`. Effective global trusted-keyring paths are captured with `apt-config shell`; Debian APT 3 intentionally leaves `Dir::Etc::Trusted` unset, so discovery records it as unset and does not reinstate the legacy `/etc/apt/trusted.gpg` trust path. The trusted-parts directory is normalized and required to resolve to `/etc/apt/trusted.gpg.d`. APT update uses error mode `any`, signature validation, and freshness validation with `Acquire::Check-Valid-Until=true`; any repository error, insecure repository, or stale `Valid-Until` metadata fails the discovery. It requires the four exact Release codename/suite pairs: `(trixie, stable)`, `(trixie-updates, stable-updates)`, `(trixie-security, stable-security)`, and `(trixie-pgdg, trixie-pgdg)`. HTTP transport is permitted because APT verifies repository metadata signatures; scheme and URI are recorded with the authenticated targets. URI credentials are redacted and malformed authorities/non-default ports are rejected.

The generated `gnupg-removal-lock-proposal.json` records a sorted package tuple of name, version, and architecture for every simulated removal. `signedReleaseIndexHashes` contains SHA-256 and size rows for all index paths and compression variants in each APT-verified InRelease; `packageIndexTargetBindings` maps each APT canonical Packages URI to the variants listed by that signed Release without claiming which compression APT fetched; `localAptIndexFiles` contains separate hashes and sizes for local APT copies, which may be transformed `.lz4` files. `sourceTrustEvidenceSha256` binds the source-policy evidence, including hashes of explicit `Signed-By` keyrings. The proposal also records signed Release hashes, simulation, pinned image identity, platform, revision, and Git tree. Discovery fails closed if `gnupg` is absent, metadata refresh or suite validation fails, metadata is missing, the simulation is empty or omits `gnupg`, inventory versions do not match the plan, or the plan includes a protected package. A failed attempt still leaves diagnostic files for the existing always-upload evidence step.

The proposal is not an approved removal lock. Runtime clearance and CVE clearance are explicitly `NOT_EVALUATED`.

## Required next phase

An independent reviewer must inspect the hosted closure and its authenticated metadata, verify every package and the proposed package delta, resolve any unexpected removals, then freeze the exact name/version/architecture lock with its evidence hashes. Only after that review may a separate candidate Dockerfile and Compose project be built. That later phase must preserve and verify the actual APT signature verifier found in discovery (the base image may use `sqv`; do not assume or install `gpgv`), Debian and PGDG keyrings, and then prove `apt-get --error-on=any update` still succeeds after the purge. It must also test package delta, PostgreSQL startup/runtime checks, backups/restores, attachment integrity, and comparable vulnerability scans. No candidate build or purge is authorized by Phase 1 discovery evidence alone.

## Existing findings and constraints

- Current Trixie scan findings and Debian tracker status are recorded in the Phase 4 vulnerability evidence; this design makes no clearance claim.
- The reviewed Bookworm GnuPG purge removed a 16-package closure, including SQLite and ncurses packages. That closure is not evidence for Trixie and must not be reused.
- The PostgreSQL Trixie build uses GnuPG to verify `gosu` and import the PGDG key. The upstream runtime entrypoint does not invoke GnuPG. Application backup encryption uses Node AES-256-GCM in the separate Alpine operations image. These observations justify investigation, not runtime acceptance.
- The actual APT signature verifier (`sqv` or `gpgv`, as observed in the image), Debian and PGDG keyrings, APT executables and `libapt-pkg`, PostgreSQL, `libpq`, `libxml2`, and `gosu` are protected from the proposed purge.

## Ownership and sequence

The discovery helper and this design are isolated from the operational Dockerfile and existing candidate. The hosted evidence is uploaded through the existing `phase4-container-scan` artifact path. Independent review and lock freeze precede any candidate implementation. Open findings, target-CVE scanner coverage, production-target validation, and Owner/Go-Live acceptance remain separate gates.
