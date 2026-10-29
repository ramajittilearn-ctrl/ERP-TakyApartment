ARG DEBIAN_FORKY_BASE=debian:forky-slim@sha256:98af9d99779532814d4b51c34d50df8d8886286a2a1ab9625a62db59b9cf1b2d
ARG POSTGRES_ENTRYPOINT_SOURCE=postgres:17.11-trixie@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe

FROM ${POSTGRES_ENTRYPOINT_SOURCE} AS postgres-entrypoint-source

FROM ${DEBIAN_FORKY_BASE}
ARG DEBIAN_FORKY_BASE
ARG POSTGRES_ENTRYPOINT_SOURCE
ARG CANDIDATE_REVISION
ARG CANDIDATE_TREE
COPY --from=postgres-entrypoint-source /usr/local/bin/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=postgres-entrypoint-source /usr/local/bin/gosu /usr/local/bin/gosu
COPY --from=forky-packages /packages/ /tmp/forky-packages/

RUN --network=none set -eux; \
    test -x /usr/local/bin/docker-entrypoint.sh; \
    test -x /usr/local/bin/gosu; \
    printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d; \
    chmod 0755 /usr/sbin/policy-rc.d; \
    mkdir -p /etc/postgresql-common; \
    printf 'create_main_cluster = false\nstart_conf = disabled\n' > /etc/postgresql-common/createcluster.conf; \
    DEBIAN_FRONTEND=noninteractive apt-get --no-download --yes --no-install-recommends install /tmp/forky-packages/*.deb; \
    rm -f /usr/sbin/policy-rc.d; \
    test "$(dpkg-query --show --showformat='${Version}' postgresql-17)" = '17.11-1.pgdg14+2'; \
    test "$(dpkg-query --show --showformat='${Architecture}' postgresql-17)" = 'amd64'; \
    libxml_version="$(dpkg-query --show --showformat='${Version}' libxml2-16)"; \
    dpkg --compare-versions "$libxml_version" ge '2.15.4+dfsg-1'; \
    install -d -o postgres -g postgres /var/lib/postgresql/data; \
    rm -rf /tmp/forky-packages /var/lib/apt/lists/* /var/cache/apt/archives/*.deb

ENV PATH="/usr/lib/postgresql/17/bin:${PATH}" \
    PGDATA="/var/lib/postgresql/data"
VOLUME ["/var/lib/postgresql/data"]
EXPOSE 5432
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=12 CMD pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["postgres"]

LABEL org.opencontainers.image.base.name="${DEBIAN_FORKY_BASE}" \
      org.opencontainers.image.revision="${CANDIDATE_REVISION}" \
      io.taky.candidate.tree="${CANDIDATE_TREE}" \
      io.taky.postgresql.package="17.11-1.pgdg14+2" \
      io.taky.libxml2.minimum="2.15.4+dfsg-1" \
      io.taky.candidate.only="true" \
      io.taky.postgres.entrypoint.source="${POSTGRES_ENTRYPOINT_SOURCE}"
