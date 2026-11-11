# Container scan and Debian tracker refresh — 2026-10-30

## Scope and binding

This is a read-only audit of the latest completed hosted scan available during this refresh, not a waiver, image selection, or production clearance. PR run [40995410043](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40995410043) verified PR head `75d385d82e7ebda56c69da609f708c51ebbdd9e3`, merge checkout `4755b86e51fd4b342ac5a3659a198caf331f2336`, and tree `294bd479647ccc2addfeb0bc9f727b18d1476baa`; its push counterpart [40995405271](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40995405271) also passed all eight jobs. Container scan artifact [12951367430](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40995410043/artifacts/12951367430) has digest `sha256:a5cb1cb4cb97b7b84be87419567facac0b4c724fd8587e55f1d4008e2c093ddf`.

The scan used Trivy 0.76.1 on `linux/amd64`, vulnerability DB schema 2, content SHA-256 `a12867e2335eb513a05e7c429798051d63cc8902a8c80f3dac48e1be97fd70c7`, updated `2026-10-30T01:01:11Z` and downloaded `2026-10-30T03:12:57Z`. The metadata sidecars bind each report to an image config digest, the same source revision/tree, platform, and DB hash. Counts below are raw package finding instances; unique CVE/advisory ID counts are shown separately. Reports are unsuppressed.

| Image | Image ID | Critical / High / Medium / Low / Unknown instances | Unique Critical / High IDs |
|---|---|---:|---:|
| App | `sha256:702123d7480bd8639bc34440919122f18758bce5373a7e99f076b9cb8a333939` | 0 / 0 / 0 / 0 / 0 | 0 / 0 |
| Evidence validator | `sha256:d8539f931349c398adab8361603ce3d9a2d23d9e6160f11a0be7b91320b09421` | 0 / 0 / 0 / 0 / 0 | 0 / 0 |
| Operations | `sha256:8988bcf7fabaa28b19a8c1e4d5ae992a6cff0710f48a4564a2222064d05c1c20` | 0 / 0 / 0 / 0 / 1 | 0 / 0 |
| Operational Trixie database (also scanned as Trixie candidate) | `sha256:d4f90f31491dc3e7299a5e2a80c86903fd862d07c5bdca52426a60213d3c7596` | 1 / 61 / 109 / 138 / 4 | 1 / 16 |
| Trixie GnuPG-prune candidate | `sha256:51dd37161ec5b98d880edf624f1ffa6557cb8f50b6beeff9f8736fa45a41bbce` | 1 / 54 / 100 / 110 / 4 | 1 / 15 |
| Bookworm database candidate | `sha256:ca209e1e0766c976a5a109a5ea17eb8ee3693e5ac85796b62f37d88e4b344822` | 2 / 66 / 132 / 134 / 5 | 2 / 18 |
| Alpine database candidate | `sha256:2c61a001b59202779b99956d613b8465c8847f28c982a005d925b3da4932e94e` | 0 / 0 / 0 / 0 / 0 | 0 / 0 |

The standalone Forky/PGDG PostgreSQL candidate is covered by its own same-run evidence, not this scan artifact. PR candidate artifact [12950969224](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40995410043/artifacts/12950969224) and its independent audit report zero Trivy findings for its exact candidate image; its scanner-clearance and image-selection fields intentionally remain false.

## Current operational Trixie database Critical/High set

The raw Trixie report has one Critical, `CVE-2026-6653` in `libxml2 2.12.7+dfsg+really2.9.14-2.1+deb13u3`, and 16 distinct High IDs across 61 package instances:

- `libxml2`: `CVE-2026-74860`, `CVE-2026-86138`, `CVE-2026-86139`, `CVE-2026-86140`, `CVE-2026-86142`, `CVE-2026-86143`, `CVE-2026-86144`.
- `util-linux`: `CVE-2026-76642`, `CVE-2026-78408`, `CVE-2026-78409`, `CVE-2026-78410`.
- Other package families: GnuPG `CVE-2026-24882`; ACL `CVE-2026-54369`; systemd `CVE-2026-16742`; ncurses `CVE-2025-69720`; Perl `CVE-2026-9538`.

The GnuPG-prune candidate removes the seven GnuPG package-instance findings for `CVE-2026-24882`; its raw report falls from 61 to 54 High instances and from 16 to 15 unique High IDs. It does not remove the libxml2 Critical or clear any remaining finding. This candidate-only package removal does not alter the operational database image or volumes.

The Bookworm candidate has two Critical IDs (`CVE-2023-45853` in `zlib1g` and `CVE-2026-6653` in `libxml2`) and 18 unique High IDs across 66 package instances. Its High set includes Bookworm util-linux `CVE-2026-53613` and `CVE-2026-53615`, plus the Trixie/Bookworm shared util-linux issues. The separate package-payload review for the zlib finding remains non-applicability evidence only; the raw finding is retained.

Every Critical/High finding in the three Debian database reports above has an empty Trivy `FixedVersion` field. Do not treat the zero findings in the Alpine/Forky candidates as a reason to switch a database image automatically; image selection is a release decision that must account for PostgreSQL/data compatibility and target-specific evidence.

## Debian tracker cross-check

Checked Debian's primary security tracker on 2026-10-30. It continues to list Trixie's `libxml2` as vulnerable for `CVE-2026-6653`; Trixie is also listed vulnerable for the newly scanned libxml2 High IDs above, with the source-package page showing fixes only for Forky/Sid for that group. Debian lists Trixie vulnerable/no DSA for `CVE-2026-74860`. For the other source families, Trixie is listed vulnerable/no DSA for GnuPG `CVE-2026-24882`, ACL `CVE-2026-54369`, systemd `CVE-2026-16742`, Perl `CVE-2026-9538`, and ncurses `CVE-2025-69720`; these statuses are not Owner risk acceptance.

The util-linux comparison illustrates why scanner and distro evidence must remain separate. The scan reports Trixie `CVE-2026-76642` and `CVE-2026-78408` through `-78410` against `2.41.5-0+deb13u1`; Debian's current tracker reports those issues vulnerable in Trixie. The same installed Trixie version is fixed for `CVE-2026-53613` and `CVE-2026-53615`, and those two IDs are absent from the Trixie raw report. The Bookworm package version remains vulnerable to both. Preserve raw output and avoid applying statuses from one suite to another.

Primary tracker pages: [libxml2](https://security-tracker.debian.org/tracker/source-package/libxml2), [util-linux](https://security-tracker.debian.org/tracker/source-package/util-linux), [GnuPG](https://security-tracker.debian.org/tracker/source-package/gnupg2), [ACL](https://security-tracker.debian.org/tracker/source-package/acl), [systemd](https://security-tracker.debian.org/tracker/source-package/systemd), [Perl](https://security-tracker.debian.org/tracker/source-package/perl), and [ncurses](https://security-tracker.debian.org/tracker/source-package/ncurses). Tracker status is package/version evidence; it does not establish workload reachability or negate raw Trivy output.

## Raw report integrity and limits

The downloaded CI artifact was unpacked without modifying repository files. SHA-256 values of the raw JSON files are:

| Raw report | SHA-256 |
|---|---|
| `debian-trixie-database.trivy.json` | `f3404b7ca3eefd83804cf0bb0765d07bc42e2aed18a59defc0749f396febbf90` |
| `debian-trixie-gnupg-prune-database.trivy.json` | `54a3191d7b2c3ea4000bb2d70d347195046f7ed70e8e702a07dba09fda2444c6` |
| `debian-bookworm-database.trivy.json` | `915e0cbac056e68cb2e6cba32064750efb84e6cbaca62e9d83f7d142e2f75548` |
| `operational-database.trivy.json` | `d5adcfa0ea37c261ec51f311247f4be77072ac6b631ec9a8d57ccb99d9dec834` |

The four raw-report severity totals, unique Critical/High IDs, package/CVE mappings, image IDs and per-file hashes were independently checked against this exact artifact. The Trivy database content hash matches the prior completed scan; the scan refresh changes source/image bindings, not the finding set. All security disposition, scanner clearance, image selection, production target/recovery and deployment gates remain open. Production remains **NO-GO**.
