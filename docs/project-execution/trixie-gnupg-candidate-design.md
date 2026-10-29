# Isolated Trixie PostgreSQL GnuPG-prune candidate

## Decision

Prepare a candidate-only derivative of the pinned PostgreSQL 17.11 Trixie image that removes `gnupg` and only the dependency closure the pinned image's APT resolver proves removable. Do not modify the operational Trixie image, shared PostgreSQL Dockerfile, existing UAT, or production resources. A passing candidate is not security clearance.

## Evidence and limits

- Current Trixie scan: 1 Critical and 61 High findings. Debian's tracker does not list a Trixie fix for CVE-2026-6653 or several other current findings.
- The reviewed Bookworm candidate's GnuPG purge removed a 16-package closure, including SQLite and ncurses packages. Do not reuse that allowlist for Trixie; its dependency graph must be measured independently.
- The PostgreSQL Trixie build uses GnuPG to verify `gosu` and import the PGDG key. The upstream runtime entrypoint does not invoke GnuPG. Application backup encryption uses Node AES-256-GCM in the separate Alpine operations image. These observations justify a candidate experiment, not runtime acceptance.
- Keep `gpgv`, Debian and PGDG keyrings, APT verification tools, PostgreSQL, `libpq`, and `libxml2` protected.

## Acceptance criteria

1. Capture `apt-get --simulate purge --auto-remove gnupg` against `postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe` on the hosted Linux runner. Freeze a sorted exact package-name allowlist from that result. Fail if the actual plan, package versions/architectures, or installed-package delta differs.
2. Preserve before/after package inventories, APT manual/automatic state, purge simulation, exact removal manifest, protected-package manifest, repository keyring hashes, image ID/platform, source revision/tree, and raw scan output.
3. Build through a separate candidate Dockerfile and Compose project with unique image/project/volume names and no published host port. Retain signed repository verification; verify `gpgv`, keyrings, PostgreSQL 17.11, `libpq`, `libxml2`, `gosu`, and the entrypoint after the purge.
4. Start a fresh candidate database and exercise readiness, version, backup, restore, and attachment integrity using synthetic data.
5. Run all nine source/target backup-restore routes for the Trixie, Bookworm, and candidate images. Preserve all existing four Trixie/Bookworm routes and add five candidate routes.
6. Scan the candidate with the same recorded Trivy database as the comparison images. Preserve raw Critical/High/Unknown results; do not suppress advisories or claim clearance from scanner absence.

## Ownership and sequence

`db_cve_triage` completed the design review. Implementation and independent cross-review are queued after the Forky provenance job is integrated so the owners do not edit `.github/workflows/phase4-ci.yml` and `scripts/ci/verify-container-images.sh` concurrently.

Open findings, target-CVE scanner coverage, production-target validation, and Owner/Go-Live acceptance remain separate gates.
