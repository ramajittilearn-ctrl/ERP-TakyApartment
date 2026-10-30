# Forky exact-head verification 20

## Scope and result

This report records exact-head hosted verification for PR #2 at `13d9857213ba99c3fc0ce3402fab1c4ae8a9a016`. Both the pull request run [41008239322](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41008239322) and push run [41008233599](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41008233599) completed successfully with all eight jobs passing. An independent artifact auditor reviewed the PR run bindings and evidence. This head changes project records only; it contains no ERP application or container implementation changes relative to `f2e50b9`.

The PR run's candidate and container evidence binds to merge checkout `29bbd4a4514825220bb37424619301b5da61892f` and tree `3e081c960df2ea278d690b314c3c4ce2677b85a0`.

## Exact-run evidence

| Evidence | Artifact | Digest | Verified result |
|---|---:|---|---|
| Stage 5 runtime | [12957060159](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41008239322/artifacts/12957060159) | `sha256:6eac11917cc5d65e2b3718f39ac47fca9d7d7b681996092a6bf113d4fef18fa3` | 52 checks, 17 migrations, no failures; synthetic rent `1000.00` persisted; invoice/payment/receipt `1050.01` reconciled with explicit `-0.01` adjustment. |
| Container vulnerability and restore evidence | [12957351529](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41008239322/artifacts/12957351529) | `sha256:6c21c85533851af1eb6fc769edb3d1b733e212398dff7f38dbf5fd5dea79e068` | Eight restore routes pass; embedded and uploaded matrices match at SHA-256 `0893f9d9ab893ea12cb0408282811227b774cb3d00666c3c880e8207602b34d6`. Both Forky routes use image ID `sha256:fdfbb0deae0e832f64ceb812a26a35332d4f4c0694034e04cb43d7e0b0916767`. |
| Forky candidate image | [12956409096](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41008239322/artifacts/12956409096) | `sha256:b67076ac3f3cb7451e5986f5920ef052c2d1e3c37f6e76d58904b0a046ebe7ee` | Same-run candidate image artifact; candidate only. |
| Forky candidate finalizer evidence | [12956558492](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41008239322/artifacts/12956558492) | `sha256:b084e2b45de9d6a258b2badfdb2a5791d3b7090f64038fbff0ec383b0d9bc19e` | `candidateOnly=true`; `gosuTrivyNoCriticalHigh=true` applies to the gosu target only. Scanner clearance, CVE disposition, image selection, and production clearance remain false. The image-wide Forky raw scan report was not inspected by this audit. |
| Synthetic browser Agent UAT | [12956527196](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41008239322/artifacts/12956527196) | `sha256:70c4a7cf0a4c60e43746426f855442375d223bfe741eec79adced5a652d9dc30` | Source-bound synthetic Agent UAT report; this is not Owner UAT or production acceptance. |

The raw scan counts remain Bookworm 2 Critical/66 High, Trixie 1 Critical/61 High, GnuPG-pruned Trixie 1 Critical/54 High, and one Operations UNKNOWN. These counts and candidate results do not constitute production security clearance.

## Release status

PR #2 remains OPEN / `REVIEW_REQUIRED` / `BLOCKED`; one approving review is required and none is recorded. The repository still has no configured production deployment environment/workflow or attested production target/registry. Target-matched recovery and rollback, immutable publication/pull, deployment, and post-deployment evidence remain open. Production remains **NO-GO**. Report 19 remains the historical record for parent head `f2e50b9`.
