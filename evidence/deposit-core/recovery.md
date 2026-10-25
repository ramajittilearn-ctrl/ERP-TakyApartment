# Deposit core recovery

Recovered the prior deposit core source from its own project subagent tool-write records. The original temporary worktree was absent. The recovery does not imply that its prior runtime artifacts survived. The manifest identifies source call IDs and current source hashes.

The five-model schema, contracts, pure arithmetic, service, payment bank gate and authored tests are recovered. The initial migration DDL prefix was generated again from the baseline39 to recovered44 model schemas using Prisma schema-only diff; the remaining SQL guard text was recovered from the prior writes. Existing fifteen migration files were not edited. Candidate finite migration002 belongs to a separate reviewed change and must precede this003 migration on integration.

This commit freezes recovery before addressing review finding DCR-01. Fresh independent review and actual PostgreSQL acceptance remain required. No database, Docker, browser or build command ran in this recovery agent.
