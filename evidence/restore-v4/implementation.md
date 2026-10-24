# Restore inventory v4 implementation evidence

The worktree starts at expense baseline `83d681906f2e2615d428faf41463ca7bd53ebebe`.
Main independently accepted `docs/project-execution/restore-v4-contract.md` before
implementation. The isolated worktree contains no dependency tree or private
database configuration.

`baseline-unit.log` records the original registry check failing because the
expense schema has 39 models while inventory v3 covers 38. Nine other focused
tests passed.

`inventory-unit.log` records 14 focused tests passing after implementation.
These cover current model coverage, exact historical registry order, accepted
legacy/v2/v3 SQL byte hashes, canonical fingerprints for versions 2, 3 and 4,
and rejection before database access. Node syntax checks and `git diff --check`
also passed. Formatting used the installed Prettier executable from the expense
worktree and changed only the owned files.

`all-ops-unit.log` records a broader attempt with 42 passing and 2 failing tests.
The browser proxy test cannot bind loopback in the sandbox. The remediation
preflight test cannot resolve `dotenv` because this isolated worktree has no
dependency tree. These failures are preserved and do not count as passes.
Main must run the complete operations suite in the integration environment.

No PostgreSQL or Docker execution occurred in this implementation task. Main
must execute `operations/verify-inventory-isolated.mjs` in the reviewed private
operations container and preserve its actual output. Its planned checks are not
reported here as completed. Independent code and real-evidence review remain
required before integration.
