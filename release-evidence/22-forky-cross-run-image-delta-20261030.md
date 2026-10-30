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
