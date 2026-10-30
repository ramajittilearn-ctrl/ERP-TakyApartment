# Prepare the Phase 4 production deployment

Deploy from the reviewed `release/phase4` branch and immutable `phase4-2026-10-26-rc1` tag, after the gates below pass. Do not deploy the repository's older default `main` branch. This package prepares a release candidate; it does not certify or change a production host.

The accepted feature baseline is `32355958081088e1c849aff39177c86e718139d6`. The preparation commit adds release configuration and documentation only. `manifest.json` records the frozen Git objects. The verifier rejects changes to accepted source inputs. Existing application, finance, schema and operations implementation files stay unchanged.

## Stop before touching the target

The last operational inventory recorded 22 application tables and three migrations. That is not proof of the current host state. The accepted synthetic rehearsals do not establish that this exact target can upgrade to 44 models and 17 migrations.

Before any stop, migration, image replacement or volume mutation on that host, record all of these facts privately:

- Exact host, Docker context, Compose project, current image digests, database identity, migration names/checksums, and database/attachment/backup/CA volume identities.
- A fresh backup made by the CURRENT schema-matching tool, with a successful isolated restore. Do not point the new V5 inventory worker at an old schema to obtain this backup.
- A separate clone of the actual target backup, its schema/history reconciliation, and a successful no-seed upgrade rehearsal to all 17 migrations. Never fix history with a blind `migrate resolve` or a reset.
- Verified release image digests and real isolated-runtime PDF, authentication, money and evidence checks. Local Webpack tests are not proof that newly built container images work.
- Existing attachment-root ownership UID1000, canonical directory identity and mode0700. A new image's `mkdir/chmod` does not repair an existing named volume. Rehearse any necessary permission migration on the clone, then schedule it explicitly; release startup does not change old volume permissions.
- Canonical private HTTPS origin, reserved interface/DNS and certificate trust, backup encryption/remote storage access, legal issuer/account facts and disposition of remaining security/commissioning findings.
- A writer-fenced cutover window and a tested schema-matched rollback plan that retains any post-cutover evidence.

These gates remain OPEN until actual target evidence exists. Preparation did not connect to or modify that database. Do not run the commands in the cutover section until the gates pass.

## Prepare immutable images and private environment

Check out the release tag in a clean checkout. Build the app with the frozen root `Dockerfile`, operations with `operations/Dockerfile`, and validator with `operations/evidence-validator/Dockerfile`. Record the exact checkout commit and each resulting image's registry digest. Validate the actual resulting images in an isolated rehearsal before use. Do not substitute a floating `latest` or `local` image.

The accepted application verification used `next build --webpack`. The frozen root Dockerfile uses `npm run build`; that container build and its runtime must be verified separately. This package does not claim that unbuilt images or a registry digest placeholder were tested.

Use existing private core and operations environment files as the starting facts for an existing installation. Do not run environment initialization or seed as an upgrade shortcut. Copy `deploy/phase4/environment.example` to a private file outside Git, fill the five image references as `registry/repository@sha256:<64 lowercase hex characters>`, and set the verified project name. Add a private 64-hex validator token shared by app and validator. Preserve existing database and session credentials unless rotation is separately planned. Keep each environment file owned by the operator and mode0600.

The repository is public at preparation time. Never upload private environment files, actual rendered Compose config, database dumps, uploaded tenant evidence, backup keys, tokens or cookies as release assets. The source archive is generated with `git archive`, not by copying a working directory or uploading the local all-ref recovery bundle.

Use the five files in this exact order:

1. `docker-compose.yml`
2. `docker-compose.operations.yml`
3. `docker-compose.https.yml`
4. `docker-compose.evidence-validator.yml`
5. `docker-compose.phase4-release.yml`

The old `scripts/ops.mjs up` wrapper omits the validator overlay and is not this release's startup entry point. Compose must support the existing `!reset` directive, at least version2.24.4. The last overlay disables builds and app startup migration/seed, and requires explicit image references.

```sh
node deploy/phase4/verify.mjs \
  --env-file /absolute/private/core.env \
  --env-file /absolute/private/operations.env \
  --env-file /absolute/private/phase4.env
```

This is a read-only configuration/source check. It renders Compose with a sanitized child environment so exported host variables cannot override the selected files. It prints no credentials or raw config. A passing result verifies source identity, digest syntax and composed safety settings. It does not verify image availability, the target, backup/restore, migration compatibility, device trust or deployment approval.

## Cut over only after every target gate passes

Run on the verified deployment host/context. Set the following to the exact private files already checked. Use the same sanitized environment for all Compose commands, because ordinary exported variables override env files.

```sh
PHASE4_CORE_ENV_FILE=/absolute/private/core.env
PHASE4_OPS_ENV_FILE=/absolute/private/operations.env
PHASE4_RELEASE_ENV_FILE=/absolute/private/phase4.env
dc() {
  env -i PATH="$PATH" HOME="$HOME" docker compose \
    --env-file "$PHASE4_CORE_ENV_FILE" \
    --env-file "$PHASE4_OPS_ENV_FILE" \
    --env-file "$PHASE4_RELEASE_ENV_FILE" \
    -f docker-compose.yml -f docker-compose.operations.yml \
    -f docker-compose.https.yml -f docker-compose.evidence-validator.yml \
    -f docker-compose.phase4-release.yml "$@"
}
```

Keep the old schema-matching restore path available. After the verified backup, writer fencing and clone rehearsal, start only the verified database service if necessary. Run migration as a deliberate one-off with `--no-deps`; this must not start the new app or scheduler before the database is ready.

```sh
dc run --rm --no-deps app node node_modules/prisma/build/index.js migrate deploy
```

On an existing target, do not run `db:seed`. A fresh empty installation is a different procedure and needs its own identity, account setup and seed decision. Verify applied migration names/checksums, integrity guards and expected schema against the rehearsal before starting the app.

```sh
dc up -d --no-build --pull never evidence-validator app caddy
```

Verify HTTPS with the trusted installed Caddy root CA certificate, current-role access, real Thai invoice/receipt PDF downloads and a controlled authorized financial/evidence smoke test. Do not bypass certificate errors. Start the Phase4 operations scheduler only after the database and retained evidence satisfy V5 checks:

```sh
dc up -d --no-build --pull never operations
```

Use the same five-file `dc` function for later inspection and operations. A base-only `up` can restore the old HTTP port or automatic migration/seed command.

## Roll back as a matched data and application operation

Fence all writers and retain a forensic copy of the current database and all retained evidence, including post-cutover files, orphans and partials. Follow the rehearsed recovery procedure with the matching application image, database backup, attachment state, configuration and key material. Verify identities and restoration before reopening writes.

Do not start an old image against a migrated database as a rollback. Do not delete post-cutover evidence, overwrite the old backup, or run a destructive restore during preparation. The repository's production restore command is not an unattended rollback shortcut.

## Evidence and limitations

The Phase4 closeout and immutable test evidence remain in `docs/project-execution/phase4-closeout.md` and `evidence/phase4/`. Application UAT passed35/35 and unit tests409/409. This release preparation adds synthetic Compose validation and source-identity checks only. Actual production migration, image runtime verification and Go-Live are not claimed.
