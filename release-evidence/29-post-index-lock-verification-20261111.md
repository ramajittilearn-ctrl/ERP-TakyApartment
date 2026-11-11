# PR #2 post-lock verification — 2026-11-11

Commit `adc5a103c26251d489d23585b393a664f95a75db` passed all eight jobs in exact-head PR run [42987991137](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/42987991137). This revalidated the Trixie signature and refreshed active-index lock, completed the isolated GnuPG-removal candidate and its runtime checks, ran Stage 5 and synthetic Agent UAT, and completed container verification.

## Current image evidence

The scan artifact is [13841163450](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/42987991137/artifacts/13841163450), SHA-256 `4b4fedc220b548936bd6623b6c8af08ae15ea4c039ba6c3295b4051bfdd34514`; Trivy 0.76.2 used DB SHA-256 `cf7fa3086682e8f77298ca8178419a530f97d7c4bd3ac203a64f2977f82e94a6`.

- Operations was rebuilt with the digest-pinned Go 1.27.4 Alpine builder. The image-bound Trivy inventory reports `krb5-libs 1.22.3-r0` and `libxslt 1.1.43-r4`, with zero Critical/High findings and one Unknown (`GO-2026-5932`). Exact-binary govulncheck no longer reports `GO-2026-6859`; raw `GO-2026-5932` remains visible and is only paired with the narrow source/import analysis.
- Alpine PostgreSQL has the same pinned package fixes and zero Critical/High findings.
- The operational Trixie PostgreSQL image still has 1 Critical (`CVE-2026-6653`) and 122 High findings. The isolated Trixie GnuPG-prune candidate has 1 Critical and 115 High. Bookworm has 2 Critical and 102 High.
- The same-run Forky candidate has zero Trivy matches, but Trivy identifies it as `forky/sid`, outside its documented Debian 7–12 coverage. Treat this as incomplete coverage, not clearance.

No severity finding was suppressed or accepted. Candidate runtime/restore evidence is synthetic and does not establish production backup recovery or Owner UAT.

## Release state

Phase 4 remains **NO-GO**. PR #2 remains OPEN/`REVIEW_REQUIRED`; an independent approving review is still required. On the selected Mac target, the private HTTPS hostname is configured, but the last read-only inspection found the running proxy still bound to its prior address; no Caddy CA was installed, per the owner's choice. The last encrypted host backup is dated 2026-10-26, and the operations service was previously observed unhealthy, so exact-target backup, restore, and rollback readiness is unproven.

No registry image was published, PR was merged, or deployment performed. The scan and candidate image were retained as GitHub Actions evidence artifacts for verification only.
