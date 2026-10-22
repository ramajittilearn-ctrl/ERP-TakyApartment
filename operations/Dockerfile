FROM node:22-bookworm-slim AS node
FROM rclone/rclone:1.75.2 AS rclone
FROM postgres:17-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends util-linux libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
WORKDIR /opt/taky
COPY operations ./operations
ENV BACKUP_DIR=/backups BACKUP_KEY_FILE=/run/secrets/backup.key ATTACHMENT_DIR=/attachments RCLONE_CONFIG=/run/rclone/rclone.conf PGOPTIONS="-c timezone=UTC"
ENTRYPOINT []
CMD ["node", "operations/cli.mjs", "schedule"]
