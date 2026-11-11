# Forky candidate cross-run image comparison — 2026-10-30

## Scope

Compare the Forky candidate image emitted by the pull-request run and the push run at source head `41f8e761bba710f1ee439e7fc73ddab8b3247425`, after their image IDs differed. This checks cross-run image content and does not replace either run's same-run CI evidence.

## Evidence compared

- Pull-request run [41023304913](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41023304913), candidate artifact [12962513261](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41023304913/artifacts/12962513261), image ID `sha256:5db8ed41b5ab995891b40a6d62b4832aec39d28fe003a1c5064b30c986f2a388`, artifact digest `sha256:85aa66f2c341828ef35fcce766edd57bed35e427df95d98f9c38472501f621f2`.
- Push run [41023298571](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41023298571), attempt 2, candidate artifact [12963643480](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41023298571/artifacts/12963643480), image ID `sha256:1381297be3ea24bab66411b006d92657472a27ef77fee55df7a9760dced0c17a`, artifact digest `sha256:dd0b6d8004d00dba91de92fc014c0a0c0431cc46c838d6326749b9f193a25434`.
- Independent artifact reviewer `/root/head_artifact_audit` streamed the OCI archives and compared config, layer manifests, paths, file-content hashes, and package inventory. It did not unpack OCI layers onto the constrained local disk.

## Findings

Both candidate artifacts bind to the same source revision/tree, pinned Debian Forky base digest `sha256:98af9d99779532814d4b51c34d50df8d8886286a2a1ab9625a62db59b9cf1b2d`, PostgreSQL entrypoint source, Go builder, gosu commit/modules, and PGDG package set. The 88 package tuples have matching SHA-256 `ff09e966d40ec5f5ea39d631467615eb377da1cfec7b551c615a578590fa169c`. The Debian base layer is byte-identical.

The image manifests have seven layers. Layers 2, 3, 4, and 7 have the same paths and file contents; their mtimes differ. Layer 5 is the same empty layer. Layer 6 has the same 6,841 paths and eight content differences:

- `/etc/machine-id`;
- Debian ssl-cert snakeoil certificate and private key;
- `/var/cache/debconf/config.dat` and `config.dat-old`, whose textual difference is a generated temporary pathname;
- ldconfig auxiliary cache;
- `alternatives.log` and `dpkg.log`, recording the same package install sequence at different run times.

The Postgres, gosu, entrypoint, and package `.deb` payload bytes match. The image config/history timestamps differ. The layer digests differ for layers 2, 3, 4, 6, and 7; layers 1 and 5 match. This is build-time nondeterminism with actual generated filesystem byte differences, not only image metadata or timestamps.

## Disposition

Do not treat the two image IDs as interchangeable or reproducible. The generated machine ID and private key require explicit security/runtime review before any image cleanup is implemented. Each run's Stage 5, restore matrix, and container verification is bound to its own candidate image, so per-run evidence remains valid. Those checks do not prove cross-run equivalence or establish whether the generated certificate/key could be selected by a runtime configuration.

## Independent review

`/root/checkpoint_cross_review` independently inspected push artifact 12963643480 and the repository's PostgreSQL image setup. In the candidate image, `postgresql.conf.sample` defaults to `ssl = off`; its certificate and key names are relative (`server.crt` and `server.key`). The candidate creates clusters by calling `initdb` directly, with `create_main_cluster = false` and `start_conf = disabled`. The checked Compose configuration has no PostgreSQL TLS mount; its HTTPS Compose override configures Caddy for web traffic. This supports the claim that the fresh default cluster path does not select the system snakeoil key.

The candidate CI does not record runtime `SHOW ssl`, and the audit did not test an existing PGDATA/configuration that explicitly points at the snakeoil files. Therefore it does not prove that every supported runtime avoids the key. The key is a real private key embedded in a distributable candidate layer; do not make it fixed or infer that it is harmless. If removal is later chosen, perform it in the same image build layer that creates it, and test both fresh PGDATA and supported existing configuration behavior. A later-layer deletion would leave the key recoverable from the lower layer. Removing generated files alone would not guarantee reproducible OCI digests because package timestamps and image config/history timestamps also differ.

The independent review recommends keeping cross-run reproducibility and generated-state handling open until exact runtime TLS behavior and a complete repeat-build comparison are verified. Production remains **NO-GO**. No source code, protected branch, UAT environment, or production environment was changed by this comparison.

## Fresh-cluster runtime evidence follow-up

To close the specific evidence gap for a fresh isolated candidate cluster without changing PostgreSQL configuration, the candidate build now captures `SHOW ssl`, `SHOW ssl_cert_file`, and `SHOW ssl_key_file` after the health check. It fails closed unless the output is `off`, `server.crt`, and `server.key`. The finalizer also requires and validates all three evidence files before it can mark `freshClusterTlsDefaultsVerified=true`; missing or contradictory evidence leaves the candidate status `INCOMPLETE` and production clearance false.

Independent reviewer `/root/checkpoint_cross_review` approved this scoped probe and its finalizer contract. Local `node --check`, `bash -n`, `git diff --check`, and 11 finalizer behavior tests pass. Hosted exact-head CI for the change is pending. This probe covers only a fresh isolated candidate cluster; it does not establish TLS handshake behavior, existing PGDATA behavior, production connections, snakeoil key safety, image interchangeability, or production clearance.

### Hosted exact-head evidence — `fc489d7`

Both hosted events reached the new candidate finalizer at the exact source head:

- Push run [41030717308](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41030717308), candidate artifact [12966586939](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41030717308/artifacts/12966586939), artifact digest `sha256:b8af49bccb9a97f8d69b15fa7ba2a795a65cb5b8840e4331818cec2540ba74a0`.
- Pull-request run [41030723476](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41030723476), candidate artifact [12966538172](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41030723476/artifacts/12966538172), artifact digest `sha256:94fcceaea7af65885cc5f008754b41e5e180f76669e0aad1a4666dbcb7fa9a40`.

Independent exact-run artifact audit by `/root/head_artifact_audit` verified each run/attempt/event/source/image binding and the embedded candidate Stage 5 summary. Both candidate finalizers report `PASS`, `candidateOnly=true`, and `freshClusterTlsDefaultsVerified=true`, with exact observed fresh-cluster values `ssl=off`, `ssl_cert_file=server.crt`, and `ssl_key_file=server.key`. The push artifact is bound to head `fc489d7`; the PR merge checkout is `b4f5904…`, while its provenance and embedded Stage 5 record the PR head `fc489d7…` and the same source tree `1bbc312…`. Each candidate's image ID equals its embedded Stage 5 database image ID. Each embedded Stage 5 run passed 17 migrations; the candidates also passed logical restore checks from Trixie and Bookworm, including fixture integrity, reindex validity, and collation checks.

The separate `container-verification` jobs later completed successfully on both events. Their scan and restore results are recorded below. This hosted probe closes only the fresh-cluster configuration evidence gap; no TLS handshake or existing PGDATA behavior was exercised. Scanner/CVE clearance, image selection, cross-run reproducibility, and production clearance remain open.

### Exact-head container scan and restore audit — `fc489d7`

Both run [41030717308](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41030717308) and PR run [41030723476](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/41030723476) completed all 8 jobs successfully. Independent `/root/head_artifact_audit` verified same-run artifact IDs, digests, image IDs, Stage 5 binding, and the uploaded/embedded restore matrices. Both matrices pass 8/8 routes; their SHA-256 values are `f9c48b40fe745555d0bb5c401c269da968125ec1bb46d581281de4a416604429` (push) and `22125b1c2384f4a5bad06b93131bb8a32e1cfbc2c02dc95c1691fd178fe8aa84` (PR).

Raw Trivy counts are identical across those runs: Bookworm 2 Critical/66 High, operational Trixie 1 Critical/61 High, and GnuPG-pruned Trixie 1 Critical/54 High. Critical IDs are CVE-2026-6653 in libxml2 on Bookworm and Trixie, plus CVE-2023-45853 in Bookworm zlib1g. The Forky raw Trivy report lists no findings, but this is not clearance: the candidate disposition retains the documented Trivy 0.76.1 Debian 14 vulnerable-positive-control gap and leaves scanner/CVE/production clearance false.

The independent OCI comparison for the exact-head PR and push candidates confirmed identical RootFS layer DiffIDs for layers 1 and 5, with layers 2, 3, 4, 6, and 7 different. Both share the pinned base and source tree, but the PR labels its image with merge revision `b4f5904…` while push uses `fc489d7…`; created timestamps also differ. Per-file differences for this pair were not collected, so the full cause remains unresolved and the images are not treated as bit-identical.

### Later hosted retry — `f6e7e86`

The docs-only exact-head run [42743288803](https://github.com/ramajittilearn-ctrl/ERP-TakyApartment/actions/runs/42743288803) was rerun as a full workflow so candidate artifacts remained bound to the same run. On attempt 4, quality, Stage 5, Agent UAT, libxml2 provenance/candidate, and Forky provenance/candidate passed. Container verification failed before discovery because two validator unit fixtures retained a fixed `Valid-Until: 06 Nov 2026`, which had expired against the 10 Nov runner clock. The failure was in synthetic fixture data, not the production freshness guard; the guard correctly rejected expired metadata.

The fixture now creates its signed `Date`, seven-day `Valid-Until`, and generated-at clock relative to current UTC. Focused local validator/discovery suites passed 82 tests with one skip because local `gpg`/`gpgv` is unavailable. Independent patch review and exact-head hosted CI are still pending. This does not change the reviewed production policy or relax the signed metadata expiry check.
