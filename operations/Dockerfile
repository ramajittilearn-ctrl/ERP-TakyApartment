FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS node
FROM --platform=$BUILDPLATFORM golang:1.27.3-alpine3.24@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c AS rclone-build
ARG TARGETOS
ARG TARGETARCH
ADD --checksum=sha256:fa64537e7276196310dbb0bcea6330f03b40e5790197b88f14cce6a19f40eb67 https://github.com/rclone/rclone/releases/download/v1.75.2/rclone-v1.75.2.tar.gz /tmp/rclone-source.tar.gz
ADD --checksum=sha256:69b356c0b1800052c33ce0e0e11f18df8717a721aab346b553dc1ab44c8caae8 https://github.com/rclone/rclone/releases/download/v1.75.2/rclone-v1.75.2-vendor.tar.gz /tmp/rclone-vendor.tar.gz
RUN mkdir -p /src /out && \
    tar -xzf /tmp/rclone-source.tar.gz --strip-components=1 -C /src && \
    tar -xzf /tmp/rclone-vendor.tar.gz -C /src
WORKDIR /src
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -mod=vendor -trimpath \
    -ldflags="-s -w -X github.com/rclone/rclone/fs.Version=v1.75.2" \
    -o /out/rclone .

FROM postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe
RUN apt-get update && apt-get install -y --no-install-recommends util-linux libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=rclone-build /out/rclone /usr/local/bin/rclone
RUN rm -f /usr/local/bin/gosu
WORKDIR /opt/taky
COPY operations ./operations
ENV BACKUP_DIR=/backups BACKUP_KEY_FILE=/run/secrets/backup.key ATTACHMENT_DIR=/attachments RCLONE_CONFIG=/run/rclone/rclone.conf PGOPTIONS="-c timezone=UTC"
ENTRYPOINT []
CMD ["node", "operations/cli.mjs", "schedule"]
