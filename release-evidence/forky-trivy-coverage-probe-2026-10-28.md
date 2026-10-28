# Synthetic Forky Trivy coverage probe — 2026-10-28

## Purpose and scope

This local experiment checks whether Trivy 0.76.1 can interpret Debian Forky package advisories. It uses minimal synthetic root filesystems with a dpkg status entry; it is not a scan of a Debian Forky or PostgreSQL image and cannot establish candidate security, runtime compatibility, or production readiness.

## Inputs

- Trivy reports version `0.76.1` (`darwin/arm64`). The downloaded archive SHA-256 is `11a9b6cd2752011b54f01ea4bd0dbfa9f0c41dc6538d5a3f9d23955f471bf4e5`.
- The local Trivy DB SHA-256 is `faa015429c6ebd9c9a672be99cfbd5aecec2eade21d1d6e59d4dc091dc752ff3`; DB metadata reports `UpdatedAt=2026-10-28T13:01:10.618103814Z` and `NextUpdate=2026-10-29T13:01:10.618103614Z`.
- Synthetic Forky and Debian 14 fixtures both declare amd64 `libxml2-16` version `2.15.3+dfsg-1`, source `libxml2 (2.15.3+dfsg-1)`, with package status `install ok installed`. Their `/etc/debian_version` values are `forky/sid` and `14.0` respectively.
- The synthetic Debian 13 control declares amd64 `libxml2` version `2.12.7+dfsg+really2.9.14-2.1+deb13u3`, source at the same version, and `/etc/debian_version=13.0`.

## Results

| Fixture and scan mode | Trivy OS metadata | Findings | CVE-2026-6653 |
|---|---|---:|---|
| Forky, default detection | `debian/forky/sid` | 0 | absent |
| Forky fixture with `--distro debian/14` | `debian/14` | 10 | absent |
| Debian 14 version file, default detection | `debian/14.0` | 10 | absent |
| Debian 13 vulnerable control | `debian/13` | 12 | present |

The Debian 14 mapped results include other libxml2 advisories, so the experimental override obtains partial advisory data. It does not contain CVE-2026-6653 even though the Debian 13 positive control detects that CVE. Consequently, an empty Forky target-CVE result cannot be treated as remediation evidence. The source-tracker fix version and a candidate's authenticated package/runtime identity need separate verification; unknown advisory coverage stays unresolved.

## Reproduce / retain

The experiment ran with `trivy rootfs --scanners vuln --skip-db-update --cache-dir <cache> --format json <fixture>`; the Forky mapped case additionally used `--distro debian/14`. Raw JSON SHA-256 values:

- Forky default: `2734fdbaeddc2d69c4353a4fb6b0af67a695f1c4a6ea247d7b443012f56dd48d`
- Forky mapped to Debian 14: `21d955736da5be2b6c366d703ff72f38492a10db1f81ab61c31ee437b80bbe0e`
- Debian 13 control: `2e345f393f68d62fc063ab56b9828d670bc18cf83d2131c1884667bf44dbcf98`

The fixture directories, DB, and JSON remain in `/tmp/erp-trivy-forky-coverage` on the local development host only; they are not CI artifacts or repository files. Re-run from authenticated current Debian/PGDG metadata before any image-level claim. Do not add a Forky CI job or change production image selection based on this synthetic probe alone.
