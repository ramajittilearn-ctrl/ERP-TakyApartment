ARG GOSU_BUILDER_IMAGE=golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4
ARG POSTGRES_BASE_IMAGE
ARG GOSU_COMMIT=6456aaa0f3c854d199d0f037f068eb97515b7513
ARG GOSU_USER_MODULE_VERSION=v0.4.1
ARG GOSU_X_SYS_MODULE_VERSION=v0.44.0

FROM ${GOSU_BUILDER_IMAGE} AS gosu-builder

ARG TARGETOS
ARG TARGETARCH
ARG GOSU_COMMIT
ARG GOSU_USER_MODULE_VERSION
ARG GOSU_X_SYS_MODULE_VERSION

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends git ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    git init /src; \
    git -C /src fetch --depth 1 https://github.com/tianon/gosu.git "$GOSU_COMMIT"; \
    git -C /src checkout --detach FETCH_HEAD

WORKDIR /src
RUN set -eux; \
    go mod edit -require="github.com/moby/sys/user@${GOSU_USER_MODULE_VERSION}"; \
    go mod edit -require="golang.org/x/sys@${GOSU_X_SYS_MODULE_VERSION}"; \
    go mod tidy; \
    go mod verify; \
    test "$(go list -m github.com/moby/sys/user)" = "github.com/moby/sys/user ${GOSU_USER_MODULE_VERSION}"; \
    test "$(go list -m golang.org/x/sys)" = "golang.org/x/sys ${GOSU_X_SYS_MODULE_VERSION}"; \
    mkdir -p /out; \
    CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" \
      go build -trimpath -buildvcs=false -ldflags='-w' -o /out/gosu .; \
    chmod 0755 /out/gosu; \
    /out/gosu --version

ARG GOSU_BUILDER_IMAGE
ARG POSTGRES_BASE_IMAGE
FROM ${POSTGRES_BASE_IMAGE}

ARG DEBIAN_MAIN_SNAPSHOT
ARG DEBIAN_SECURITY_SNAPSHOT
ARG BOOKWORM_MAIN_INRELEASE_SHA256
ARG BOOKWORM_UPDATES_INRELEASE_SHA256
ARG BOOKWORM_SECURITY_INRELEASE_SHA256
ARG OPENSSL_PACKAGE_VERSION
ARG LIBSSL3_PACKAGE_VERSION
ARG TZDATA_PACKAGE_VERSION
ARG POSTGRES_BASE_IMAGE
ARG GOSU_BUILDER_IMAGE
ARG GOSU_COMMIT
ARG GOSU_USER_MODULE_VERSION
ARG GOSU_X_SYS_MODULE_VERSION

RUN set -eux; \
    test -s /usr/share/keyrings/debian-archive-keyring.gpg; \
    . /etc/os-release; \
    test "$VERSION_CODENAME" = bookworm; \
    for inrelease_sha256 in "$BOOKWORM_MAIN_INRELEASE_SHA256" "$BOOKWORM_UPDATES_INRELEASE_SHA256" "$BOOKWORM_SECURITY_INRELEASE_SHA256"; do \
      test "${#inrelease_sha256}" -eq 64; \
      case "$inrelease_sha256" in *[!0-9a-f]*) echo 'Invalid InRelease SHA-256 pin' >&2; exit 1 ;; esac; \
    done; \
    mkdir -p /usr/share/taky-bookworm-candidate-refresh; \
    postgres --version > /usr/share/taky-bookworm-candidate-refresh/postgres-before.txt; \
    pg_config --version > /usr/share/taky-bookworm-candidate-refresh/pg-config-before.txt; \
    case "$(cat /usr/share/taky-bookworm-candidate-refresh/postgres-before.txt)" in 'postgres (PostgreSQL) 17.11'*) ;; *) echo 'Unexpected PostgreSQL version before package refresh' >&2; exit 1 ;; esac; \
    case "$(cat /usr/share/taky-bookworm-candidate-refresh/pg-config-before.txt)" in 'PostgreSQL 17.11'*) ;; *) echo 'Unexpected pg_config version before package refresh' >&2; cat /usr/share/taky-bookworm-candidate-refresh/pg-config-before.txt >&2; exit 1 ;; esac; \
    dpkg-query -W -f='${binary:Package}\t${Version}\t${Architecture}\n' | LC_ALL=C sort > /usr/share/taky-bookworm-candidate-refresh/dpkg-before.tsv; \
    printf 'openssl=%s\nlibssl3=%s\ntzdata=%s\n' "$OPENSSL_PACKAGE_VERSION" "$LIBSSL3_PACKAGE_VERSION" "$TZDATA_PACKAGE_VERSION" > /usr/share/taky-bookworm-candidate-refresh/requested-packages.txt; \
    rm -f /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; \
    printf '%s\n' 'Types: deb' "URIs: http://snapshot.debian.org/archive/debian/${DEBIAN_MAIN_SNAPSHOT}/" 'Suites: bookworm bookworm-updates' 'Components: main' 'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' 'Check-Valid-Until: no' '' 'Types: deb' "URIs: http://snapshot.debian.org/archive/debian-security/${DEBIAN_SECURITY_SNAPSHOT}/" 'Suites: bookworm-security' 'Components: main' 'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' 'Check-Valid-Until: no' > /etc/apt/sources.list.d/taky-bookworm-candidate.sources; \
    cp /etc/apt/sources.list.d/taky-bookworm-candidate.sources /usr/share/taky-bookworm-candidate-refresh/apt-sources.sources; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /var/lib/apt/lists/partial; \
    apt-get --error-on=any update; \
    main_inrelease="/var/lib/apt/lists/snapshot.debian.org_archive_debian_${DEBIAN_MAIN_SNAPSHOT}_dists_bookworm_InRelease"; \
    updates_inrelease="/var/lib/apt/lists/snapshot.debian.org_archive_debian_${DEBIAN_MAIN_SNAPSHOT}_dists_bookworm-updates_InRelease"; \
    security_inrelease="/var/lib/apt/lists/snapshot.debian.org_archive_debian-security_${DEBIAN_SECURITY_SNAPSHOT}_dists_bookworm-security_InRelease"; \
    test -s "$main_inrelease"; \
    test -s "$updates_inrelease"; \
    test -s "$security_inrelease"; \
    printf '%s  %s\n' "$BOOKWORM_MAIN_INRELEASE_SHA256" "$main_inrelease" | sha256sum --check --status; \
    printf '%s  %s\n' "$BOOKWORM_UPDATES_INRELEASE_SHA256" "$updates_inrelease" | sha256sum --check --status; \
    printf '%s  %s\n' "$BOOKWORM_SECURITY_INRELEASE_SHA256" "$security_inrelease" | sha256sum --check --status; \
    printf 'suite\tsha256\nbookworm\t%s\nbookworm-updates\t%s\nbookworm-security\t%s\n' \
      "$BOOKWORM_MAIN_INRELEASE_SHA256" "$BOOKWORM_UPDATES_INRELEASE_SHA256" "$BOOKWORM_SECURITY_INRELEASE_SHA256" \
      > /usr/share/taky-bookworm-candidate-refresh/inrelease-sha256.tsv; \
    apt-cache policy openssl libssl3 tzdata > /usr/share/taky-bookworm-candidate-refresh/apt-policy.txt; \
    test "$(apt-cache policy openssl | sed -n 's/^  Candidate: //p')" = "$OPENSSL_PACKAGE_VERSION"; \
    test "$(apt-cache policy libssl3 | sed -n 's/^  Candidate: //p')" = "$LIBSSL3_PACKAGE_VERSION"; \
    test "$(apt-cache policy tzdata | sed -n 's/^  Candidate: //p')" = "$TZDATA_PACKAGE_VERSION"; \
    verify_candidate_origin() { package="$1"; expected="$2"; uri="$3"; suite="$4"; apt-cache policy "$package" | awk -v expected="$expected" -v source="$uri $suite/main" '/^  Candidate:/ { candidate = $2 } ($1 == expected || ($1 == "***" && $2 == expected)) { matching = 1 } matching && index($0, source) > 0 { found = 1 } END { exit !(candidate == expected && found) }'; }; \
    verify_candidate_origin openssl "$OPENSSL_PACKAGE_VERSION" "http://snapshot.debian.org/archive/debian-security/${DEBIAN_SECURITY_SNAPSHOT}" bookworm-security; \
    verify_candidate_origin libssl3 "$LIBSSL3_PACKAGE_VERSION" "http://snapshot.debian.org/archive/debian-security/${DEBIAN_SECURITY_SNAPSHOT}" bookworm-security; \
    verify_candidate_origin tzdata "$TZDATA_PACKAGE_VERSION" "http://snapshot.debian.org/archive/debian-security/${DEBIAN_SECURITY_SNAPSHOT}" bookworm-security; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      "openssl=${OPENSSL_PACKAGE_VERSION}" \
      "libssl3=${LIBSSL3_PACKAGE_VERSION}" \
      "tzdata=${TZDATA_PACKAGE_VERSION}"; \
    test "$(dpkg-query -W -f='${Version}' openssl)" = "$OPENSSL_PACKAGE_VERSION"; \
    test "$(dpkg-query -W -f='${Version}' libssl3)" = "$LIBSSL3_PACKAGE_VERSION"; \
    test "$(dpkg-query -W -f='${Version}' tzdata)" = "$TZDATA_PACKAGE_VERSION"; \
    test -s /usr/share/keyrings/debian-archive-keyring.gpg; \
    gpgv --version > /usr/share/taky-bookworm-candidate-refresh/gpgv-before-prune.txt; \
    LC_ALL=C apt-get --simulate purge --auto-remove gnupg > /usr/share/taky-bookworm-candidate-refresh/gnupg-purge-simulation.txt 2>&1; \
    awk '$1 == "Remv" || $1 == "Purg" { print $2 }' \
      /usr/share/taky-bookworm-candidate-refresh/gnupg-purge-simulation.txt | LC_ALL=C sort -u \
      > /usr/share/taky-bookworm-candidate-refresh/gnupg-purge-planned-packages.txt; \
    awk '$1 == "Remv" || $1 == "Purg" { package = $2; sub(/:.*/, "", package); if (package == "gnupg") found = 1 } END { exit !found }' \
      /usr/share/taky-bookworm-candidate-refresh/gnupg-purge-simulation.txt; \
    if grep -E '^(Remv|Purg) (apt|gpgv|debian-archive-keyring|libapt-pkg[^[:space:]]*|libpq[^[:space:]]*|libxml2|postgresql(-|:|[[:space:]]))' \
      /usr/share/taky-bookworm-candidate-refresh/gnupg-purge-simulation.txt; then \
      echo 'GnuPG purge simulation would remove a protected runtime or verification package' >&2; exit 1; \
    else \
      grep_status=$?; \
      if [ "$grep_status" -ne 1 ]; then echo 'Could not validate GnuPG purge simulation output' >&2; exit "$grep_status"; fi; \
    fi; \
    postgres --version > /usr/share/taky-bookworm-candidate-refresh/postgres-after.txt; \
    pg_config --version > /usr/share/taky-bookworm-candidate-refresh/pg-config-after.txt; \
    cmp /usr/share/taky-bookworm-candidate-refresh/postgres-before.txt /usr/share/taky-bookworm-candidate-refresh/postgres-after.txt; \
    cmp /usr/share/taky-bookworm-candidate-refresh/pg-config-before.txt /usr/share/taky-bookworm-candidate-refresh/pg-config-after.txt; \
    dpkg-query -W -f='${binary:Package}\t${Version}\t${Architecture}\n' | LC_ALL=C sort > /usr/share/taky-bookworm-candidate-refresh/dpkg-after.tsv; \
    awk -F '\t' '$1 ~ /^postgresql(-|$)/ { print }' /usr/share/taky-bookworm-candidate-refresh/dpkg-before.tsv > /usr/share/taky-bookworm-candidate-refresh/postgresql-packages-before.tsv; \
    awk -F '\t' '$1 ~ /^postgresql(-|$)/ { print }' /usr/share/taky-bookworm-candidate-refresh/dpkg-after.tsv > /usr/share/taky-bookworm-candidate-refresh/postgresql-packages-after.tsv; \
    cmp /usr/share/taky-bookworm-candidate-refresh/postgresql-packages-before.tsv /usr/share/taky-bookworm-candidate-refresh/postgresql-packages-after.tsv; \
    awk -F '\t' '\
      function allowed(name) { sub(/:.*/, "", name); return name == "openssl" || name == "libssl3" || name == "tzdata" } \
      FNR == NR { before[$1] = $2 "\t" $3; next } \
      { after[$1] = $2 "\t" $3 } \
      END { \
        for (name in before) { \
          if (!(name in after)) { print "removed\t" name "\t" before[name]; if (!allowed(name)) bad = 1 } \
          else if (before[name] != after[name]) { print "changed\t" name "\t" before[name] "\t" after[name]; if (!allowed(name)) bad = 1 } \
        } \
        for (name in after) if (!(name in before)) { print "added\t" name "\t" after[name]; if (!allowed(name)) bad = 1 } \
        exit bad \
      }' /usr/share/taky-bookworm-candidate-refresh/dpkg-before.tsv /usr/share/taky-bookworm-candidate-refresh/dpkg-after.tsv \
      > /usr/share/taky-bookworm-candidate-refresh/dpkg-allowed-delta.tsv || { cat /usr/share/taky-bookworm-candidate-refresh/dpkg-allowed-delta.tsv >&2; exit 1; }; \
    LC_ALL=C sort -o /usr/share/taky-bookworm-candidate-refresh/dpkg-allowed-delta.tsv /usr/share/taky-bookworm-candidate-refresh/dpkg-allowed-delta.tsv; \
    rm -rf /var/lib/apt/lists/*

COPY --from=gosu-builder /out/gosu /usr/local/bin/gosu
RUN set -eux; gosu --version; gosu nobody true

LABEL org.opencontainers.image.base.name="${POSTGRES_BASE_IMAGE}" \
      io.taky.postgres.gosu.commit="${GOSU_COMMIT}" \
      io.taky.postgres.gosu.user-module="${GOSU_USER_MODULE_VERSION}" \
      io.taky.postgres.gosu.x-sys-module="${GOSU_X_SYS_MODULE_VERSION}" \
      io.taky.postgres.gosu.builder="${GOSU_BUILDER_IMAGE}" \
      io.taky.postgres.security-refresh.kind="bookworm-openssl-tzdata" \
      io.taky.postgres.security-refresh.main-snapshot="${DEBIAN_MAIN_SNAPSHOT}" \
      io.taky.postgres.security-refresh.security-snapshot="${DEBIAN_SECURITY_SNAPSHOT}" \
      io.taky.postgres.security-refresh.bookworm-inrelease-sha256="${BOOKWORM_MAIN_INRELEASE_SHA256}" \
      io.taky.postgres.security-refresh.bookworm-updates-inrelease-sha256="${BOOKWORM_UPDATES_INRELEASE_SHA256}" \
      io.taky.postgres.security-refresh.security-inrelease-sha256="${BOOKWORM_SECURITY_INRELEASE_SHA256}" \
      io.taky.postgres.security-refresh.openssl="${OPENSSL_PACKAGE_VERSION}" \
      io.taky.postgres.security-refresh.libssl3="${LIBSSL3_PACKAGE_VERSION}" \
      io.taky.postgres.security-refresh.tzdata="${TZDATA_PACKAGE_VERSION}"
