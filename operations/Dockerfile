FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS node
FROM rclone/rclone:1.75.2@sha256:2687085f718d3c628f7fdfb77c52a1d344332aed543110bb88088f2c70d43eb5 AS rclone
FROM postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe
RUN apt-get update && apt-get install -y --no-install-recommends util-linux libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
RUN rm -f /usr/local/bin/gosu
WORKDIR /opt/taky
COPY operations ./operations
ENV BACKUP_DIR=/backups BACKUP_KEY_FILE=/run/secrets/backup.key ATTACHMENT_DIR=/attachments RCLONE_CONFIG=/run/rclone/rclone.conf PGOPTIONS="-c timezone=UTC"
ENTRYPOINT []
CMD ["node", "operations/cli.mjs", "schedule"]
