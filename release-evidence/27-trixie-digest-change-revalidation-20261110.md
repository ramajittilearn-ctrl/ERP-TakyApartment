# PR #2 Trixie digest-change revalidation — 2026-11-10

## Follow-up: container-verification failure root cause

The digest-change tests and authenticated Trixie discovery passed. The follow-up Grype gate failure was caused by an invalid Debian 14 positive control: it labeled `libxml2-16 2.15.3+dfsg-1` vulnerable, although Debian records `2.14.5+dfsg-0.1` as the first fixed unstable version and current Forky as fixed. Grype correctly returned no CVE match for 2.15.3. The control now uses `2.14.4+dfsg-0exp1`, below the Debian fix threshold. With current Grype DB `v6.1.10`, pinned Grype 0.121.0 and Grype 0.121.3 each returned one exact Debian 14 CVE-2026-6653 match for that fixture. The old hosted failure is therefore not evidence of a scanner coverage gap. Corrected hosted verification is pending.

Commit `8c79ec10d0a79d4aea7e1dcb3497f226c59d84c7` passed the complete push workflow [42848605940](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/42848605940), including `container-verification`; authenticated Trixie discovery and the corrected Grype control passed. PR workflow attempt 1 [42848618784](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/42848618784) failed in its separate Forky artifact download with HTTP 503, before container verification. Retrying only the failed downstream job advanced the run attempt but reused the prior attempt's producer artifact, which the same-run binding correctly rejected. A new full PR workflow run is required to verify matching producer and consumer attempt evidence.

## Finding and lock decision

Investigated PR #2 at head `32f516aa123846a3245aed845f61bd0b11a34109`.
The signed package-index drift failure already has a reviewed fix in commit
`7251e93162a3` (see report 23). Keep that lock unchanged: the current authenticated
proposal matches its exact active package-index map, purge tuples, trust inputs,
release identities, and freshness policy. A changed InRelease digest alone is
not authority to refresh a lock or weaken signature checks.

The latest PR [run 42796905135](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/42796905135)
tested merge revision `7a37f5fdb8d9878f9d7044aed634314d3d0b5291`, tree
`b14716a635cd0e92fe598f854363da8b0fc375db`. Its authenticated discovery step
passed. The container job failed later because the Grype Debian 14
CVE-2026-6653 control reported `DEBIAN14_COVERAGE_GAP`. That run used the
subsequently identified fixed 2.15.3 fixture, so its no-match was expected.
The final log says
`Grype Debian 13 calibration passed; Debian 14 CVE-2026-6653 coverage gap recorded. Release gate remains blocked.`
Commit `32f516aa1238` explicitly preserves that fail-closed behavior. The
corrected vulnerable fixture requires exact-head hosted verification before
the gate can be considered verified.

## Independently checked evidence

Downloaded container artifact [13754944052](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/42796905135/artifacts/13754944052),
verified ZIP SHA-256 `33156cc4c03d65e28915a7e92b497cf6532441ab7d1503357fd58fcb73495213`
against GitHub's job log, and compared all 146 extracted files with the ZIP.
The discovery proposal SHA-256 is
`862a889617608008a2cde7a05fb590c357444a6ed1e77c53ba3e4ffceff6ab8c`.

Ran the repository's unmodified `validate-proposal` and `validate-candidate-lock`
against this captured evidence in a disposable local Python/GnuPG container,
with the source and evidence mounted read-only. This replays the recorded run
identity; it is not a new discovery run or a new image/runtime verification.
Both commands passed. All 84 discovery evidence-file hashes passed, all four
InRelease signatures verified against the captured Signed-By keyrings, and
the current 13-row selected Packages variant map and 14 exact removal tuples
match the existing reviewed lock. Release freshness checks passed for all four
sources without warnings. Candidate-only status remains true; runtime and CVE
clearance remain `NOT_EVALUATED`, and production use remains `NOT_AUTHORIZED`.

As a real-evidence regression check, fetched all five lock files from
pre-refresh revision `7623146d60fa465962de98dd74166bd3c4924590` and replayed
the same authenticated proposal against them. The validator exited 1 with
`current authenticated active Packages variant map differs from the exact reviewed lock`.
The current lock passes against those same captured signed inputs.

Captured authenticated InRelease digests:

| Source | SHA-256 | Bytes |
| --- | --- | ---: |
| trixie | `0584fba32e13e0ab8285fb16c27adea1ec03a73669c18702821094fd6ca86675` | 140421 |
| trixie-updates | `da15969dd6990c093516d6c4830a5222e2fb12b7ea60b7c9c83d19811aa0d92e` | 47340 |
| trixie-security | `8cfb86ff1190b904539e1c8c2069e9b373ec8add28f59cdab7f4839edb0cb5b6` | 43409 |
| trixie-pgdg | `ac533f523687800ace432f7c778113abc87f92f3a7655170da834ed98a81149e` | 240985 |

Also fetched `https://deb.debian.org/debian/dists/trixie/InRelease` live:
its bytes exactly match the independently signature-verified captured Trixie
file. Its signed identity is Debian / stable / trixie, version 13.7, dated
`Sat, 12 Sep 2026 07:55:41 UTC`. It has no Valid-Until field; its age passes
the existing 90-day maximum. GnuPG accepted signing fingerprints
`4CB50190207B4758A3F73A796ED0E7B82643E131`,
`B8E5F13176D2A7A75220028078DBA3BC47EF2265`, and
`41587F7DB8C774BCCF131416762F67A0B2C39DE4`.
The other three digest values above describe the captured CI evidence, not a
claim that those moving repositories were freshly rediscovered locally.

## Focused changes and validation

Added two tests to `scripts/ci/test_validate_trixie_gnupg_evidence.py` and a
fixture option that changes only Trixie's signed compressed-index hash:

- A self-consistent new proposal with a changed InRelease/index digest and
  unchanged removal tuples validates as discovery, rejects the stale reviewed
  index lock without writing any lock files, then passes after an explicit
  fixture lock refresh. Purge, release, and trust lock bytes remain unchanged;
  candidate-only and no-clearance restrictions remain asserted.
- Even a refreshed matching digest lock rejects a failed signature verification.

These two tests mock the signature-verifier boundary to test lock policy;
they do not claim synthetic signatures are authentic. The separate real
GnuPG test and independent artifact signature replay cover cryptographic use.

The existing workflow already runs this test module before discovery and
candidate-lock validation. Its final discovery-outcome check, strict build-time
revalidation, exact index equality, trust/freshness rules, protected-package
guards, and scanner gate remain unchanged. No lock or workflow edit is needed.

Validation command:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest \
  scripts.ci.test_validate_trixie_gnupg_evidence \
  scripts.ci.test_discover_trixie_gnupg_removal \
  scripts.ci.test_container_candidate_evidence_contract -q
```

Host result: 86 tests ran successfully with one real-GnuPG test skipped because host
GnuPG is unavailable. Disposable container result with `gpg`, `gpgv`, and
`gpg-agent` installed: all 86 passed, no skips. The first container attempt
omitted `gpg-agent`, so key generation in the real-GnuPG test failed; installing
that test dependency resolved it. `git diff --check` passed.

No image was published, no PR was merged, and nothing was deployed. The hosted
run's failure was at the Grype control configured with the fixed 2.15.3 fixture;
it was not a failure of the Trixie digest checks. The corrected 2.14.4 fixture
was verified locally with pinned Grype 0.121.0 against DB v6.1.10 and is now
pending exact-head hosted verification. The full container runtime/restore
pipeline was not rerun locally.
