# Container security remediation — 2026-10-26

## Scope

This candidate refreshes the Node runtime and PostgreSQL bases to pinned Node 22.23.4 Trixie and PostgreSQL 17.11 Trixie OCI index digests. The operations image also pins rclone 1.75.2 by its OCI index digest. The app runtime invokes the bundled Prisma and tsx CLIs directly, allowing global npm/npx to be removed from app and validator images. The operations derivative removes its inherited `gosu`; it uses `ENTRYPOINT []` and runs Node/PostgreSQL client commands directly. The actual PostgreSQL service image retains `gosu` because the official entrypoint requires it.

Operator instructions, remediation harness commands, and compose test/restore images were updated to match these runtime paths and digests. The bulk `node_modules` copy remains root-owned and readable to the unprivileged runtime user; it no longer recursively changes ownership during image assembly.

## Source verification

The following source-level totals are historical checks from the initial local candidate. Current PR-head totals from hosted run `40327186679` are recorded in `STATUS.md` and its job logs.

- `npm run typecheck`: passed.
- `npm test`: 422/422 passed across 36 files.
- `npm run test:ops`: 86/86 passed.
- `npm run lint`: passed.
- `npm run build`: passed with Next.js 16.4.1.
- `git diff --check`: passed.
- Independent Pstack review by `independent_release_audit` confirmed the base digests, gosu scope, and direct CLI paths. Its findings about stale integration-test commands and unpinned rclone were corrected and independently confirmed.

These checks validate the source tree, not a successful runtime for all new images.

## Historical local Docker checks and current limits

The local Docker Desktop observations below predate the hosted PR CI run recorded in the next section. They describe local image build/scan attempts, not the result of that hosted run.

- `taky-phase4-validator:security-review` built successfully for `linux/arm64`. Docker Scout reported 0 Critical, 1 High, 0 Medium, and 0 Low findings. The remaining High finding is Debian Trixie's `zlib` package, CVE-2026-85091, with no fixed version listed by the scanner.
- `taky-phase4-operations:security-review` built successfully for `linux/arm64` from the pinned Node, PostgreSQL and rclone sources, with `gosu` removed from this derivative. The Docker Scout scan ended with `unexpected EOF`; no vulnerability verdict is claimed for this image.
- The app image build completed the Next production build, then failed while copying all `node_modules` because Docker Desktop returned `input/output error` while changing file ownership. Removing recursive ownership changes was followed by a retry, which failed when containerd could not write its metadata database (`meta.db: input/output error`). No app image runtime or final-image scan is verified.
- At the time of failure, the host data volume reported 3.2 GB available (99% used). Docker could not retrieve the image list or `docker system df` because its metadata database returned the same I/O error. No prune, reset, volume deletion, or changes to the running UAT stack were attempted.

The Docker engine/storage condition was not changed as part of this work. Hosted runner evidence includes synthetic encrypted backup and isolated restore plus a report-only vulnerability scan; these checks do not replace production-target checks or a source-matched published release. Preserve existing UAT databases and volumes. The candidate remains **NO-GO** for production.

## Historical isolated GitHub verification path — run 40327186679

Historical PR #2 workflow run [40327186679](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40327186679) passed `container-verification` on head `6363f2248cd986ebbb980e7b7dddcb28c941b674`. `scripts/ci/verify-container-images.sh` built pinned app, evidence-validator, and operations images on a fresh `ubuntu-24.04` runner for `linux/amd64`, without registry login or push. It requires a clean checkout, records checkout revision/tree in image labels, and checks runtime CLI files. It starts uniquely named synthetic database/app/validator containers on an internal job network, checks app health and 15 seeded rooms, checks validator health, confirms an invalid token receives HTTP 401, then removes only job resources whose ownership labels match this run. It refuses pre-existing volumes before use. The validator uses its production limits and the app keeps `no-new-privileges`. The labels record the clean checkout used by the job; they are not cryptographic build attestations.

The same job runs `scripts/ci/verify-operations-backup-restore.sh` against the exact checkout-labeled app and operations images from PR merge checkout `c4fa83fa182a4fd60c7d0c140769f9d451be8363` (PR head `6363f2248cd986ebbb980e7b7dddcb28c941b674`). It creates isolated source and restore databases/attachment volumes, seeds 15 synthetic rooms and a file-only attachment fixture, creates an encrypted backup, and invokes `restore-isolated` into the separate target. It verifies the restored room count and fixture SHA-256, including readability as the app's `node` user. It does not create or verify an Attachment metadata row. The run does not prove ARM64 behavior, verify off-device backup/key recovery, or establish production-target safety. The separate `agent-uat` job passed 90 synthetic browser checks on the same PR head; its source-build scope and report are recorded in `06-final-uat.md`. No registry publication or deployment occurred.

## Historical hosted image vulnerability scan — run 40327186679

Run `40327186679` uploaded [scan artifact 12651862521](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40327186679/artifacts/12651862521). Trivy 0.76.1 scanned the locally built `linux/amd64` app, validator, and operations images from merge checkout `c4fa83fa182a4fd60c7d0c140769f9d451be8363`, source tree `be3c4856ea862424883bd8d06648fe79d3c0939d`, with PR head `6363f2248cd986ebbb980e7b7dddcb28c941b674`. The report is vulnerability-only, and findings do not fail CI. The artifact records image config digests and scan time, but not the Trivy vulnerability database version/digest; the result is image- and time-bound rather than fully reproducible.

| Image | Critical | High | Medium | Low | Unknown |
| --- | ---: | ---: | ---: | ---: | ---: |
| App | 0 | 8 unique IDs (43 package occurrences) | 29 (58) | 33 (60) | 1 (1) |
| Validator | 0 | 8 unique IDs (43 package occurrences) | 31 (60) | 40 (67) | 1 (1) |
| Operations | 1 unique ID (1 occurrence) | 17 (62) | 39 (110) | 61 (138) | 2 (5) |

Counts are unique Trivy vulnerability/advisory IDs; they are not necessarily distinct CVEs because the scanner also reports Debian `TEMP-*` and Go `GO-*` identifiers. Parentheses show package-level occurrences, so one ID can repeat across affected packages.

Operations Critical is `CVE-2026-6653` in Debian `libxml2` `2.12.7+dfsg+really2.9.14-2.1+deb13u3`, inherited from the pinned PostgreSQL Trixie base; Trivy reports no fixed version. Operations also reports High `CVE-2026-111943` in rclone's Go standard library `v1.27.2`, for which Trivy lists Go `1.27.3` as fixed. The shared High findings include util-linux CVEs `CVE-2026-76642`, `CVE-2026-78408`, `CVE-2026-78409`, and `CVE-2026-78410` across Debian Trixie packages.

The scan is evidence that the scanner ran, not that images are clean. No remediation or risk acceptance is recorded here. Keep production **NO-GO** until affected images have a verified fix or the Owner explicitly accepts the residual risk. See the attached raw Trivy JSON reports for package-level details.

## Prior hosted scan and bounded remediation result — run 40331167063

Run [40331167063](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40331167063) passed all three jobs on PR head `69f7ca0a12e6d154d3c6629900ef2790ae39843e`; the image scan artifact is [12653274711](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40331167063/artifacts/12653274711). Trivy 0.76.1 scanned `linux/amd64` images from merge checkout `17dbc7323db48be1214521bab8a7d9a67cbaf428`, tree `af16d6737c7855e6c0ab670c8722961a07ceca25`. This run preceded the scanner database-provenance change, so its metadata sidecars do not contain the DB snapshot hash.

| Image | Critical | High | Medium | Low | Unknown |
| --- | ---: | ---: | ---: | ---: | ---: |
| App | 0 | 8 unique IDs (43 package occurrences) | 29 (58) | 33 (60) | 1 (1) |
| Validator | 0 | 8 unique IDs (43 package occurrences) | 31 (60) | 40 (67) | 1 (1) |
| Operations | 1 unique ID (1 occurrence) | 16 (61) | 39 (110) | 61 (138) | 2 (5) |

The rclone rebuild now embeds Go 1.27.3, and the current operations report no longer contains `CVE-2026-111943`. The inherited PostgreSQL Trixie `libxml2` Critical (`CVE-2026-6653`, no fixed version reported) and shared Debian High findings remain. Unique counts are Trivy IDs, not necessarily CVEs, and include non-CVE identifiers. The Trivy DB provenance verification is recorded in the following section. The reports remain non-blocking, production remains **NO-GO**, and no image was published.

## Trivy database provenance verification

The scan artifact from [run 40333071309](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40333071309), [artifact 12656880472](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40333071309/artifacts/12656880472), exercised the new provenance path on merge checkout `374fbaca6407c3bc9c492928c9d11c4c0febea86`, tree `c2881bcd72f1f44d83769f9a4ab9e846f4ca516e`. All three image sidecars carry the same Trivy DB file-content SHA-256 `d941f76c20fd916816fd04fa80d67bcd8dec6a5f68d353cb0c00be3fd3c9d2f8`, schema version 2, `UpdatedAt` `2026-10-26T07:15:18.945937093Z`, `DownloadedAt` `2026-10-26T13:48:15.530097116Z`, and `NextUpdate` `2026-10-27T07:15:18.945936953Z`; these match the included `trivy-db-metadata.json`. This confirms one stable DB file and consistent metadata for the three scans, not a fully reproducible scan or OCI digest.

The scan findings match the prior hosted result: app and validator each have 8 unique High IDs; operations has one Critical (`CVE-2026-6653`) and 16 unique High IDs. The rclone Go stdlib issue `CVE-2026-111943` remains absent. The Agent UAT job in that run failed one report-month interaction test; quality and container verification passed. Keep the security finding and UAT states separate. Production remains **NO-GO**.

## Prior hosted scan artifact before retrieval recovered — run 40335249346

At the time of the previous audit, run [40335249346](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40335249346) had succeeded and listed a `container-vulnerability-scan-40335249346-1` artifact (archive SHA-256 `d1aa528b91cf5fa37016d4db6c17a6a37250fe786aed61d93556803864b0b102`). GitHub returned HTTP 403 during that audit, so its raw scan JSON was not inspected then. The later run `40356454371` evidence is recorded below.

## Prior inspected hosted scan — run 40356454371

Run [40356454371](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40356454371) passed all three CI jobs on PR head `8ca7f4fff329fa15bc9095208911120ea2074088`. The vulnerability report is [artifact 12666751076](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40356454371/artifacts/12666751076); its archive SHA-256 is `fc7745e50b0bafb5ce54b4f4d2185a89fc8104f5f86e8eee0dcb61f766a0c0e7`. Trivy 0.76.1 scanned three local `linux/amd64` images built from merge checkout `a3268cc17ca2f59f641548dec5bdc41998c42662`, tree `1da11b27793408670b879c5c9edb352f15f275cf`. These are CI-local images, not published registry images.

All three image sidecars report the same Trivy DB file-content SHA-256 `36cfc99204b7ee124c2e47daf8a83cd0cf98bf4e6b6a67c30687da049d5828f6`, schema version 2, `UpdatedAt` `2026-10-26T14:38:04.845305817Z`, `DownloadedAt` `2026-10-26T16:15:13.107919584Z`, and `NextUpdate` `2026-10-27T14:38:04.845305326Z`. This ties the three reports to one DB snapshot; it does not establish a reproducible scan or published OCI digest.

| Image | Critical | High | Medium | Low | Unknown |
| --- | ---: | ---: | ---: | ---: | ---: |
| App | 0 | 8 IDs (43 package occurrences) | 29 (58) | 33 (60) | 1 (1) |
| Validator | 0 | 8 IDs (43) | 31 (60) | 40 (67) | 1 (1) |
| Operations | 1 ID (1) | 16 (61) | 39 (110) | 61 (138) | 2 (5) |

Counts are unique Trivy vulnerability/advisory IDs; package occurrences can repeat an ID. Operations' Critical remains `CVE-2026-6653`; the shared util-linux High findings remain unresolved. The operations image no longer reports rclone Go stdlib `CVE-2026-111943`. Findings remain report-only and have not been suppressed or risk-accepted. Production remains **NO-GO**.

The same run's container verification log confirms synthetic encrypted backup and isolated restore with 15 rooms, Attachment metadata owner links, uploader and Tenant links, and matching attachment SHA-256 `68e533fab04c85212338f91bd9dc0acf508f772764fea84333f966cd7275ffd4`. This validates database ownership metadata and file-byte recovery for its fixture; it does not test an application download-authorization endpoint, production target recovery, or off-device recovery.

## Prior inspected hosted scan — run 40360707470

PR #2 documentation head `76860a474faf49fbcc5292284df4c274619ed4e7` passed all three jobs in run `40360707470`; Agent UAT artifact [12667957853](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40360707470/artifacts/12667957853) reports 90/90. Its scan report is artifact [12668551696](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40360707470/artifacts/12668551696), archive SHA-256 `d093de2e277f68ff0de627258a8fdc1f9597f0d714f3da81eafb32428f3eba47`. Trivy 0.76.1 scanned the isolated `linux/amd64` app, validator and operations images from merge checkout `01fa4f15872f33293987c251bb4c5265297894a7`, tree `12e0273957b19e08c11e2e534cd0b739b8ab451c`. Image scan counts are unchanged from run `40356454371`:

| Image | Critical | High | Medium | Low | Unknown |
| --- | ---: | ---: | ---: | ---: | ---: |
| App | 0 | 8 IDs (43 package occurrences) | 29 (58) | 33 (60) | 1 (1) |
| Validator | 0 | 8 IDs (43) | 31 (60) | 40 (67) | 1 (1) |
| Operations | 1 ID (1) | 16 (61) | 39 (110) | 61 (138) | 2 (5) |

All three sidecars again match vulnerability DB content SHA-256 `36cfc99204b7ee124c2e47daf8a83cd0cf98bf4e6b6a67c30687da049d5828f6` and report the same schema version 2 and update/next-update times recorded above; only the download timestamp advanced to `2026-10-26T16:40:45.489592488Z`. Operations Critical `CVE-2026-6653` and shared util-linux High findings remain. `CVE-2026-111943` remains absent. Findings are report-only; no image was published.

## Latest inspected hosted scan — run 40362968827

PR #2 head `aa171b8e0273e86e77212bf56972d0a2bab89b6e` passed all three CI jobs in run `40362968827`; Agent UAT artifact [12668289110](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40362968827/artifacts/12668289110) reports 90/90. Scan artifact [12669796308](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40362968827/artifacts/12669796308) has GitHub digest `sha256:871dac2ebc5aefd38d93d22accf460e485b1ef19615e0d5867b371bf9bc69612`. Trivy 0.76.1 scanned isolated `linux/amd64` app, validator and operations images from merge checkout `08eaa89ed5258b1c1c22a80f649db882afe574aa`, tree `1beb81abad4ad5643f800451e6d72b5f7e2eb009`; counts match the prior scan: app 0C/8H/29M/33L/1U, validator 0C/8H/31M/40L/1U, operations 1C/16H/39M/61L/2U. All sidecars share DB content SHA-256 `36cfc99204b7ee124c2e47daf8a83cd0cf98bf4e6b6a67c30687da049d5828f6`, schema v2, UpdatedAt `2026-10-26T14:38:04.845305817Z`, DownloadedAt `2026-10-26T16:55:41.048078253Z`, and NextUpdate `2026-10-27T14:38:04.845305326Z`. Operations Critical `CVE-2026-6653` and shared util-linux High findings remain; `CVE-2026-111943` remains absent. Findings are report-only, and images remain unpublished.

### Bounded remediation review

An independent security review traced the current findings to the scanned image packages and inspected the Dockerfiles plus backup/restore commands. App and validator inherit util-linux from the pinned Node Trixie base. Operations inherits util-linux from PostgreSQL Trixie and explicitly needs `flock` to serialize backup, upload, and restore operations. The operations Critical is libxml2 inherited from the PostgreSQL Trixie base; removing that dependency or replacing the base could affect `pg_dump`/`pg_restore`.

No safe, bounded remediation was established. Do not remove locking utilities or swap database/client bases without an equivalent-lock design, source-pinned build, and complete restore rehearsal. Monitor for supported Trixie fixes and refresh pinned digests when available. A minimal operations image or lock helper would require design review and end-to-end backup/restore verification. Do not suppress the findings; they remain unresolved production blockers unless fixed or explicitly dispositioned.

## Debian's disposition for the remaining Critical finding

The [Debian CVE tracker](https://security-tracker.debian.org/tracker/CVE-2026-6653) still marks `CVE-2026-6653` vulnerable in Trixie and labels it `<no-dsa> (Minor issue)`; its tracker lists a fixed package only for unstable. The [libxml2 source tracker](https://security-tracker.debian.org/tracker/source-package/libxml2) likewise shows Trixie vulnerable/no DSA. This explains why the pinned PostgreSQL Trixie image keeps the finding and why an automatic base refresh is not a verified fix. Trivy's Critical classification remains visible in the candidate scan; no suppression, override, or Owner risk acceptance is recorded. Reachability in the deployed SQL/application paths has not been established, so production remains **NO-GO** until the finding is fixed or its residual risk is explicitly dispositioned.
