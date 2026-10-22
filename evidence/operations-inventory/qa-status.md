# OPS-03 real PostgreSQL QA attempt

Final status at 2026-10-22 18:26 UTC: DB NOT VERIFIED. The acceptance script did not run.

QA inspected the acceptance script, database helpers, inventory SQL, archive command wrapper and operations Dockerfile before executing. The script uses synthetic rows and private Unix sockets under fresh temporary directories. It does not access the application database or UAT services.

The fresh Compose project is `taky-inventory-qa-20261023`. The proposed image is `taky-inventory-qa-20261023:local`. No image ID or digest is claimed because the build has not completed. Runtime network mode is `none`. There are no published ports, credentials, environment files, host mounts or named volumes. A disposable tmpfs overrides the inherited PostgreSQL data volume path.

The original operations image build was interrupted with exit 130 while downloading an unused rclone image layer. The acceptance script needs only Node and PostgreSQL. A bounded recovery uses the captured `qa-Dockerfile`, omits rclone and leaves application source unchanged.

The recovery initially appeared stalled after local bake definitions. At the bounded interrupt after about three minutes, buffered output showed cached dependency stages, completed application copy and an unfinished image export. It exited 130. Both build command logs retain the actual output and exit codes. No container-run command was issued, no SQL executed and no project cleanup command was necessary because no runtime was started. No existing service, database or volume was altered.

`qa-config.log` captures the original Compose validation before the temporary Dockerfile pivot. `qa-compose.yaml` captures the recovery configuration. `qa-ps.log` records an empty fresh project before runtime. These checks establish proposed isolation only. They do not prove SQL behavior or dump/restore correctness.
