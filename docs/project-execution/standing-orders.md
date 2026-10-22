# Standing orders

1. Follow installed Pstack through CODEX_ADAPTER.md. Available collaboration agents inherit the session model; Cursor agent types/cloud and model routing are unavailable.
2. Preserve original checkout, all concurrent worktrees, UAT ports 3700/3701, existing databases and volumes.
3. No production changes, push, deployment, database reset or deletion. Owner policy gates remain explicit.
4. Use synthetic test data and temporary files only. Never read secrets or tenant data into evidence.
5. One implementer per assigned file set. Material changes require an independent reviewer and correction retest.
6. Record actual commands and exit codes. Distinguish development, integration, automated verification, Owner UAT and production readiness.
7. Current shared Git object reads stalled during worktree creation. Development snapshot /private/tmp/taky-development copies F10 checkout e13b005, excluding env/runtime/build/dependency contents. Original ancestry integration is pending until Git recovers.
8. Main coordinates, writes execution records and integrates reviewed files; implementation agents own code changes.
