# Required late migration003 rollback probe

The real private16-migration harness now records complete V4 inventory and public guard definitions before applying deposit003. It reads the exact candidate003 file and injects one fixed P0001 raise immediately before the outer DO block’s final END. No existing migration source file is edited. That single statement must fail with the exact synthetic error and SQLSTATE, then complete original inventory/guard equality and absence of all five new tables/deposit functions must hold. Only after those assertions does the harness apply the unchanged candidate003 normally.

The probe uses the same populated old fixture baseline and native psql execution. It does not reset a database, disable guards, repair data, or wrap the failed candidate in a rollback that could hide partial DDL. The failed DO statement itself must provide atomicity. Actual execution is Main-owned and pending; this commit authors the proof only.
