# Standing orders

1. Follow installed Pstack through CODEX_ADAPTER.md. Available collaboration agents inherit the session model; Cursor agent types/cloud and model routing are unavailable.
2. Preserve original checkout, all concurrent worktrees, UAT ports 3700/3701, existing databases and volumes.
3. Owner later authorized proceeding toward Go-Live and delegated UAT to agents. Production mutation still requires an identified target, verified implementation, preserved backup and a rehearsed non-destructive migration. Owner also explicitly authorized pushing completed work to GitHub. Push reviewed commits to the dedicated development branch; no protected/main merge. No database reset/deletion or unrelated push. Preserve protected UAT environments.
4. Use synthetic test data and temporary files only. Never read secrets or tenant data into evidence.
5. One implementer per assigned file set. Material changes require an independent reviewer and correction retest.
6. Record actual commands and exit codes. Distinguish development, integration, automated verification, Owner UAT and production readiness.
7. Current shared Git object reads stalled during worktree creation. Development snapshot /private/tmp/taky-development copies F10 checkout e13b005, excluding env/runtime/build/dependency contents. Original ancestry integration is pending until Git recovers.
8. Main coordinates, writes execution records and integrates reviewed files; implementation agents own code changes.

9. Main serializes heavy builds and browser execution on this 8 GiB host. Specialists freeze source and report local checks; coordinate before another full build while a browser suite runs. Keep observed infrastructure failures distinct from application defects and preserve failed evidence.

Owner stop boundary: complete pending Stage3E deposits and Phase4 with independent review, actual verification, integration, local commits and reviewed GitHub publication, then stop. No subsequent Dashboard/Reporting or Go-Live. Canonical source and evidence now stay under persistent project.local after temporary-workspace loss.
