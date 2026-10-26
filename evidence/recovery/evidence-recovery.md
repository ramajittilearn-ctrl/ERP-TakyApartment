# Deposit evidence source recovery

Recovered into the durable project-local worktree after temporary directories were cleared. The base is `dd7d2dc`; the original checkout and production/UAT databases were not changed. Only this task's earlier subagent history was read. Historical commands were parsed as data and were not executed. Private environments, credentials, raw transcripts and unrelated source were excluded.

The historical implementation reached exactly three modules: strict metadata/limit contracts, stream staging and retained-file helpers, and actor-specific session-lock admission with durable audit counting. The interface sketch was also recovered. Exact heredoc bytes, source call identifiers and SHA-256 hashes are recorded in `evidence-source-manifest.json`. This preserves incomplete implementation, rather than representing it as a finished upload subsystem.

The earlier transcript contains no implemented acceptance service, evidence index, structural format validator, routes or evidence-specific tests. Those must still be developed, independently reviewed and tested against the recovered deposit schema and actual retained bytes. The structural PDF dependency was unresolved at the interruption. There is no permissive format or metadata-only posting stub in this recovery. The separate login admission candidate remains parked outside the requested completion scope.

A separate `expense-paging-2614fb6.patch` restores the historical sequential 105-row fixture correction against exact `2f41e2c` source. Its literal replacement came from historical source call `call_bd8a4ac91e5b4b7ba17d50972a5ebae8` and was formatted with the installed Prettier. The patch has not been applied to this branch or Main. It retains the real service calls, 105 rows, assertions, timeout and retry limits. It does not resolve or erase the later browser failures.

Recovery verification checked extracted file hashes and historical result-record presence, and source whitespace is checked separately. No TypeScript, lint, unit, database, Docker, build or browser result is claimed by this recovery. Fresh verification remains required after integration.
