# Phase 4 GitHub CI

The workflow in `.github/workflows/phase4-ci.yml` runs on pull requests targeting `release/phase4` and pushes to `release/phase4` or `codex/phase4-production-prep`. Its stable check is **`Phase 4 CI / required-quality`**.

It checks out the source without persisting Git credentials, installs the lockfile with `npm ci`, generates Prisma, then runs typecheck, unit tests, operations tests, lint, and the production build. It uses the Node 22 line required by the project and its release image. GitHub token access is limited to `contents: read`; the workflow has no production secrets, database service, seed, image publication, or deployment step.

Database integration and browser E2E tests are not part of this check. They require separate synthetic database and browser-service jobs. The workflow is not a substitute for the Agent UAT report or target-specific production checks.

Pstack design review compared two single-job candidates. The independent cross-judge selected Candidate A for its explicit stable check, fixed runner, full-SHA action pins, and disabled checkout credential persistence. The final workflow updates setup-node to the current verified v7.1.0 SHA, uses the supported Node 22 line, and includes explicit CI and telemetry environment settings. `prettier --check` passed locally; GitHub's first workflow run is required before this check is treated as proven. `actionlint` was not installed in the local environment.

The release branch currently has no protection rule. This workflow does not change GitHub branch policy; the required-check context to select if a branch rule is configured is `Phase 4 CI / required-quality`.

Action references are pinned to the verified official releases: [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) and [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0). GitHub documents `contents: read` as sufficient for checkout and setup-node actions: [workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
