# Validator implementation handoff

Source baseline is `da74f28`, isolated branch `codex/evidence-validator`. Main accepted `contract.md` before implementation. Ownership is limited to this directory and the new Compose overlay. Application schema, ledger, evidence API, package manifest and production systems were not changed.

Implemented the raw authenticated validation endpoint, two-permit zero-queue admission, streamed byte bound, private exclusive input staging, one deadline, process-group cancellation and cleanup, fixed qpdf invocation and encryption/JSON graph policy, full Sharp raster decode and strict terminal-envelope checks. The overlay declares the reviewed isolation limits and private app/validator network. The worker receives a small explicit environment with no service token, application credentials or database configuration.

The mini lock contains explicit Sharp `0.35.5` and its known locked dependency closure. Main supplied and installed that closure offline after an attempted public metadata approval was interrupted. No further network request or dependency installation was performed by this agent after resuming.

Executed after implementation:

- Node syntax checks for the four implementation modules passed.
- The format and real raster test file passed 21/21 cases locally. Its log is `evidence/local-validation-tests.log`.
- A first combined test attempt had 21 passes and seven failures: six HTTP cases could not bind loopback because the sandbox returned `listen EPERM`, and one corrupt-PNG fixture accidentally modified a chunk length. The fixture now modifies IDAT payload bytes and the corrected format suite passes. No service guard was weakened.
- Prettier formatted implementation, tests, JSON and YAML. An initial formatting command included Dockerfile, which Prettier cannot infer; the supported-file check is recorded separately. This was a tool-scope failure, not a claimed successful Dockerfile check.

Main must run the complete test command with loopback permission:

```
node --test operations/evidence-validator/tests/*.test.mjs
```

Independent source review, real qpdf/Linux image acceptance, actual cgroup/isolation inspection and application evidence integration are still pending. No Docker build, running service, PDF parser pass, container resource proof or production deployment is claimed here.
