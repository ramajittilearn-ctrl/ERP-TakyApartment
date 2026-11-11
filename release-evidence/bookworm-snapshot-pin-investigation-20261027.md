# Bookworm snapshot pin alignment — 2026-10-27

## Finding

The Bookworm candidate used approximate snapshot selectors `20261027T000000Z` but its three InRelease pins did not all come from the imports selected by those URLs. Debian's official snapshot index records the canonical imports below. Snapshot's documentation says an unavailable timestamp resolves to the latest import before the requested time; use the exact import timestamp to make that selection explicit.

| Archive | Exact import / InRelease URL | Suite | InRelease SHA-256 / size | `Packages.xz` SHA-256 / size |
|---|---|---|---|---|
| Debian | [`20261026T202550Z`](https://snapshot.debian.org/archive/debian/20261026T202550Z/dists/bookworm/InRelease) | `bookworm` | `77737fa4b34f2693e982cc9ee35736816c35a7778fc2d326cc1bbf5b301fe1aa` / 151,075 bytes | `9e0b5aabb2465b3d2e7a7fe27f9913846277833f7a2826e7767acccff5b588c5` / 8,790,396 bytes |
| Debian | [`20261026T202550Z`](https://snapshot.debian.org/archive/debian/20261026T202550Z/dists/bookworm-updates/InRelease) | `bookworm-updates` | `0e92dacd52df3ec3ec76556fb82008c60a2bbb9b62a28883ece266fc3f7dbbc4` / 55,403 bytes | `87e7e94047fb7fb6f4ceecc7022d4bee55b66031cc2a7666d3196f3e0aabb846` / 6,924 bytes |
| Debian security | [`20261026T184327Z`](https://snapshot.debian.org/archive/debian-security/20261026T184327Z/dists/bookworm-security/InRelease) | `bookworm-security` | `c04f97133debb797fa029bbc8ffe42fd5c8c039bad32cbb1e69cdbebce349b76` / 34,770 bytes | `4acde4946fd57060b29890c40e18372fdebda09b1a7ec6f3c4a4c1c55a83f76a` / 358,020 bytes |

The timestamp selections are visible in the official [Debian main import index](https://snapshot.debian.org/archive/debian/?year=2026&month=10) and [Debian security import index](https://snapshot.debian.org/archive/debian-security/?year=2026&month=10). The `Packages.xz` digests and sizes above match each corresponding InRelease `SHA256` manifest entry. For example, calculate each body digest with `curl -fsSL '<URL>' | shasum -a 256`.

The former `bookworm-updates` pin `24f1a123…` matches the earlier Debian import `20261026T082512Z`; the former security pin `cc4a4805…` matches the earlier security import `20261026T044319Z`. Thus the checksum guard correctly rejected metadata that did not match its configured archive identity. Current HTTP and HTTPS requests to the approximate selectors returned identical bytes; no transport rewrite was observed.

## Package-index verification

All three `main/binary-amd64/Packages.xz` indexes fetched from these exact imports matched the SHA-256 values and byte lengths in their respective signed `InRelease` files. The Bookworm security index contains `openssl` and `libssl3` version `3.0.22-1~deb12u2` and `tzdata` version `2026e-0+deb12u1`. The main and updates indexes contain older versions, so APT should select the requested versions from Bookworm security after the suite and origin checks.

GitHub runs [40512457382](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40512457382) and [40512465979](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40512465979) show `apt-get --error-on=any update` succeeding with `Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg`, then the updates checksum check failing. This indicates APT accepted the metadata signatures before the independent exact-hash check. The correction keeps both checks fail-closed and changes only the isolated Bookworm candidate's exact import timestamps and matching hashes. The operational PostgreSQL image, existing UAT, and database volumes are untouched.

## Hosted verification — commit `8034b35`

Exact-head push run [40516314374](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40516314374) and PR run [40516323826](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40516323826) both passed all four required jobs: quality, container verification, Stage 5 runtime, and synthetic Agent UAT. The PR container artifact [12739693385](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40516323826/artifacts/12739693385) records all three exact InRelease hashes passing, APT candidate/origin checks, and a dpkg delta limited to the requested `openssl`, `libssl3`, and `tzdata` updates. PostgreSQL 17.11 and available extensions remain equal to the source image. The four source-to-candidate restore routes pass.

The refreshed Bookworm candidate has 3 Critical/69 High Trivy package findings (20 distinct High CVE IDs); operational Trixie has 1 Critical/61 High package findings (16 distinct High IDs). The scan does not establish production eligibility. Critical triage in [the Bookworm CVE report](12-bookworm-critical-cve-triage-20261027.md) leaves SQLite and libxml2 unresolved and documents zlib1g package evidence without suppressing its raw finding. Stage 5 artifact [12739937173](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40516323826/artifacts/12739937173) passed 52 checks/17 migrations. The runner summary marks baht-glyph visual status pending; two independent reviewers separately inspected all four rendered synthetic invoice/receipt pages and confirmed visible `฿` glyphs with no clipping or overlap. Agent UAT artifact [12739643061](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/40516323826/artifacts/12739643061) reports 90 passed, zero failed/skipped/flaky; this is synthetic runner UAT, not Owner UAT.

PR #2 remains OPEN/Draft and GitHub reports `REVIEW_REQUIRED`/`BLOCKED`. No merge, image publication, target rehearsal, deployment, or Owner UAT acceptance is established. Keep production NO-GO.
Source: [Debian Snapshot service](https://snapshot.debian.org/).
