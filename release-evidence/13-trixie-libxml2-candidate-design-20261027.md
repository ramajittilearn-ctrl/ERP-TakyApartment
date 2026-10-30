# Isolated Trixie libxml2 candidate design — 2026-10-27

## Decision

Proceed only with an isolated prototype that rebuilds Debian Trixie's exact `libxml2` source package and adds the proposed Ubuntu Jammy patch for CVE-2026-6653 after Debian's complete patch series, once patch provenance is authenticated. Install only the resulting runtime package in a new PostgreSQL 17.11 Trixie candidate image. Do not alter the operational PostgreSQL Dockerfile, Compose service, existing candidate images or volumes, UAT, or production.

This is the preferred design because it retains Debian package ownership and Trixie dependency resolution. A private-prefix shared library is rejected as the primary design because the Debian package would remain flagged and loader shadowing adds ambiguity. Installing an Ubuntu binary, removing `libxml2`, or mixing in an unstable/Forky binary is out of scope.

## Evidence and review

- Source review used checkout `/private/tmp/erp-alpine-cve-investigation` at `9ba89d67c324f4354559d66c82e09d071075b077`; it was clean before this documentation update.
- The assessment reports source `2.12.7+dfsg+really2.9.14-2.1+deb13u3`, 40 Debian patches, and clean application of the Jammy patch after that series. It does not establish a successful package build or runtime behavior.
- Previously downloaded input hashes are `.dsc` `04b1da890535b11e3db231f39114ee09e643badceff79441d749d0ca78efaaa5`, orig tar `4fe913dec8b1ab89d13b489b419a8203176ea39e931eaa0d25b17eafb9c279e9`, Debian tar `3b6d265f482d6a8fbe3c056d2006fb3b563b4a838f7258b388ac5f0b29206921`, and Jammy patch `b4cc290c275b250c3170259386887a679857d97e760e114f6fb1f0d2c617c82c`. These are identity checks only; the `.dsc` signature and Ubuntu patch's immutable authenticated source identity remain unverified.
- Debian `.dsc` signature verification remains outstanding. Archive hashes matching an unsigned/unverified `.dsc` are not sufficient provenance. The Jammy patch must also be bound to an immutable Ubuntu source revision or signed source package and its exact hash.
- Primary-source research identifies Ubuntu Jammy source package `libxml2 2.9.13+dfsg-1ubuntu0.12` as the patch-bearing upload and Debian's Trixie source page as listing the target package. That research did not verify signed `Sources` metadata, either `.dsc` signature, or the extracted Ubuntu patch hash; it is package-identity evidence only. Sources: [Ubuntu accepted upload](https://lists.ubuntu.com/archives/jammy-changes/2026-June/047025.html), [Ubuntu Jammy source package](https://packages.ubuntu.com/jammy/i386/libxml2), [Debian Trixie source package](https://packages.debian.org/trixie/source/libxml2).
- The patch changes entity-amplification accounting, including `XML_PARSE_HUGE`, and appends fields to public `xmlEntity` and `xmlParserInput` structures. ABI/API and PostgreSQL XML behavior therefore remain hard acceptance gates.
- Pstack design work was performed by `libxml2_candidate_a` and `libxml2_candidate_b`; `libxml2_design_cross_review` independently preferred the Debian package rebuild, confirmed source and CI references, and required patch provenance, conditional `xml2` extension coverage, an exact package delta, and candidate-only disposition. The durable decision and review constraints are recorded here and in the project backlog.
- `source_provenance_research` confirmed package/release identities from official pages but could not verify archive signatures or patch bytes. `libxml2_ci_architecture_review` recommended integrating the isolated candidate into existing hosted container verification only after source authentication; no separate workflow or deployment/publish path is needed.

## Required gates before a build

1. In a pinned Trixie environment, authenticate Debian `InRelease`/`Sources` metadata, verify the `.dsc` signature and fingerprint, and verify each source archive hash against authenticated metadata.
2. Identify the immutable Ubuntu Jammy source revision/source-package identity for the patch, verify its hash and provenance, and compare its changes with upstream commit `463bbeeca1805b5c4828f50d0fefc4eebaf620df`.
3. Preserve the exact Debian patch order; apply the CVE patch last with zero fuzz and no rejects. Permit context-exact line offsets only when the complete patch log is retained and independently reviewed; reject all unreviewed changes.
4. Use a new candidate-only Dockerfile, Compose project, network, image identity, and named volume. Fail closed on any collision. Never run cleanup against shared or existing resources.
5. Require an exact runtime package delta of one `libxml2` version replacement. Stop if installation requires any other package additions, removals, or upgrades.
6. Verify symbols and struct layout, upstream/Debian libxml2 tests, CVE reproducer, XML limits and `XML_PARSE_HUGE`; test PostgreSQL XML behavior and the `xml2` extension only if the pinned base provides it.
7. Run fresh candidate runtime and restore compatibility checks plus an unsuppressed scan bound to exact source tree, image ID/platform and scanner DB. Preserve any raw CVE finding and all other Critical/High findings.
8. Obtain independent code/security review and exact-head CI. A passing prototype does not remediate other findings or authorize publication, operational replacement, UAT changes, merge, or production deployment.

## Current state

Design and independent cross-review are complete. No source package was built, no candidate image/container/volume was created, and no production/UAT resource changed. The local `docker info` query returned no daemon result during this run and was interrupted; candidate package/image verification must use a functioning isolated Linux CI runner. PR #2 remains open/Draft and production remains NO-GO.


## Source provenance gate completed — 2026-10-27T21:35:46Z

The previously outstanding authenticated source and patch gates passed for exact head `dc6ea58be6b705e6ffb3a22eb216a2f0908ed6fe` in push run [40586592456](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40586592456) and PR run [40586599034](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40586599034). Provenance artifact [12772091667](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40586592456/artifacts/12772091667) records authenticated Debian Trixie `libxml2` and Ubuntu Jammy patch source metadata, valid `.dsc` signatures, listed source hashes, and the exact Jammy patch hash. An independent audit recomputed all six source artifact hashes and the patch hash and confirmed both `dscverify` logs validated every listed source file. The pinned Bookworm bootstrap metadata was accepted by APT with two pinned Bookworm signers; the only unavailable additional signer was the expected Trixie signing subkey. The downloaded keyring package hash/version and authenticated package index match the manifest.

This supersedes the design-time statements above that source and patch provenance were still outstanding. It does not satisfy the build or runtime gates: no package or candidate image exists; exact patch application, Debian package build, one-package runtime delta, ABI/API, libxml2 tests/CVE reproducer, PostgreSQL XML behavior, restore, and candidate scan remain open. Existing operational images, candidate tags/volumes, UAT, and production remain untouched.


## Patch offset policy clarification — 2026-10-28

Hosted run [40653266486](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40653266486) applied the authenticated Jammy patch to the pinned Trixie source with `--fuzz=0` and no rejects; several hunks shifted by one or two lines. The isolated prototype now permits those exact-context offsets, retains the full `last-patch.log`, and still fails on any fuzz or reject. An independent security review accepted this policy for the pinned inputs. Build, runtime, restore, and raw-scan evidence remain outstanding.
