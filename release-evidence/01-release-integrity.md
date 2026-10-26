# Stage 1 — Release Integrity

**Result: PASS for source/tag identity and published-asset checksums; release remains an unmerged draft candidate.**

## Evidence collected 2026-10-26

- Repository remote: `https://github.com/ramajittilearn-ctrl/ERP-TakyApartment.git`.
- `git ls-remote origin refs/heads/release/phase4` returned `89a15a1aa88e8bc1ac42ce38f653448b1a32a645`.
- `phase4-2026-10-26-rc1` is an annotated tag object `e4150007e021052df75f845eaaaa595f5b4c7424`; its peeled commit is the same `89a15a1aa88e8bc1ac42ce38f653448b1a32a645`.
- The tag manifest's `featureBaseline` is `32355958081088e1c849aff39177c86e718139d6`. The diff from that baseline to the release branch contains only the seven `deploy/phase4/` files and `docker-compose.phase4-release.yml`.
- All 20 frozen input paths in `deploy/phase4/manifest.json` match their recorded Git object IDs at `origin/release/phase4`.
- GitHub release is still draft and prerelease. Downloaded `ERP-TakyApartment-phase4-rc1.tar.gz`, `PHASE4-DEPLOYMENT.md`, `phase4-manifest.json`, and `preparation-verification.json` all match the checksums in the downloaded `SHA256SUMS` file. The separately added `phase4-rc1-image-uat.md` asset is not listed in that older checksum file; its downloaded bytes match the GitHub API's asset digest `sha256:078981d0ad7408e3b2092bea7a23ec94d1645c705f292eaa19e4e5f773ad5caf`. The archive was listed, not extracted or executed.
- PR #1, “docs: record Phase 4 RC image UAT,” is OPEN from `codex/phase4-production-prep` to `release/phase4`; it is not merge-ready under the current protection policy because its visible checks include only `required-quality`, and it has no recorded approving review. No merge was performed.

## Updated release-branch protection — 2026-10-26

After the independent audit identified that the branch previously required zero PR approvals and only `required-quality`, protection for `release/phase4` was strengthened. It now requires strict/up-to-date `required-quality`, `container-verification`, and `agent-uat` checks plus one approving review; approving reviews are dismissed on new commits. Admin enforcement, conversation resolution, and blocks on force-push and deletion remain enabled. PR #1 and PR #2 were not merged or modified by this settings change. PR #2 head `54ecf19` passed all three required checks in run `40365071119`, including Agent UAT 90/90.

## Limits

This confirms Git identity, frozen source inputs, published-asset byte checksums, and current PR state. It does not prove image availability/runtime, production database compatibility, backup/restore against the intended target, HTTPS trust, or deployment readiness. The local development worktree is a separate dirty snapshot at the accepted feature baseline and is not the tagged release checkout.
