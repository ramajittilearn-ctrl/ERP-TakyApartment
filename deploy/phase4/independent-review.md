# Independent release preparation review

Verdict: PASS+NOTES for the Phase4 release preparation package. This verdict does not approve a production deployment.

Reviewed on 2026-10-26 by an independent Codex reviewer who did not author the release overlay or verifier. The application baseline is `32355958081088e1c849aff39177c86e718139d6`. Scope covers the new release overlay, verifier, manifest, environment template, README and release notes. The Pstack 0.15.32 Codex adapter and shipping playbook guided this review within the authorized preparation scope.

## Evidence

- Node syntax checking passed for `verify.mjs`.
- The verifier passed with synthetic private IPv4 and `erp.local` environment fixtures. Each run rendered all five Compose files without starting containers.
- Synthetic negative cases rejected a floating app image, a public `0.0.0.0` ingress bind, an empty validator token and an environment file with mode0644. Exported unsafe image, bind and token overrides did not override the explicit private files.
- Rendered checks require five digest references, disabled builds, app command `node server.js`, secure cookies and private HTTPS ingress. App, database, operations and validator publish no host ports. The validator remains on its internal network with read-only filesystem, resource limits, dropped capabilities and no retained-file mounts.
- The verifier captures configuration and child errors privately and emits fixed assertions or a small result object. Review commands did not print environment file contents or raw Compose configuration.
- The frozen-input manifest now covers additional build/configuration inputs. The verifier also rejects tracked and nonignored untracked changes outside `deploy/phase4/` and `docker-compose.phase4-release.yml`. Comparison with the accepted baseline found no changes to the pre-existing tracked application inputs.

## Findings and corrections

The initial frozen-input list omitted several build/configuration inputs, including `prisma.config.ts`, `tsconfig.json`, PostCSS configuration, `.npmrc` and `.dockerignore`. The author added these hashes and the whole-checkout allowlist. Review confirmed the correction.

An initial concern about the `.local` regular expression was withdrawn after the actual `erp.local` fixture passed. No expression change is required.

The runbook should identify the trusted Caddy root CA certificate because the frozen Caddy configuration uses `tls internal`. Never distribute the CA private key. This is a wording note, not evidence of a configuration failure.

## Deployment remains unverified

The last production inventory of 22 application tables and three migrations does not establish the present target state. Synthetic checks do not prove an upgrade to 17 migrations or V5 retained-file compatibility.

Before deployment, the runbook requires exact host/context/project/database/volume identities, a fresh schema-matched backup with verified restore, an actual-target clone upgrade without seed, immutable image runtime verification, manual existing-volume UID1000/mode0700 verification, client CA trust and operational/security commissioning. Rollback must restore matched application/data/configuration and preserve post-cutover evidence.

This review performed no service startup, database connection, migration, seed, build, deployment, merge or production mutation. It did not verify image availability or actual container runtime behavior. Existing feature/UAT results are historical evidence, not tests rerun by this reviewer.

## Final correction review

Final verdict: PASS for release preparation only. The README now says "trusted installed Caddy root CA certificate", resolving the remaining wording note. The recorded `preparation-verification.json` contains seven passing synthetic cases consistent with this review's independent checks. All three production-verification flags remain false.

The final working-tree comparison with the accepted baseline contains only new `deploy/phase4/` artifacts and `docker-compose.phase4-release.yml`. Pre-existing tracked files remain unchanged. This final review added no tests and performed no production action. Publishing the release branch, annotated candidate tag and draft prerelease does not certify deployment readiness; the documented target gates remain open.
