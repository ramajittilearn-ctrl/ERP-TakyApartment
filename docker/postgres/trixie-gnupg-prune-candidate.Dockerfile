ARG TRIXIE_OPERATIONAL_IMAGE
FROM ${TRIXIE_OPERATIONAL_IMAGE}

ARG TRIXIE_OPERATIONAL_IMAGE
ARG TRIXIE_OPERATIONAL_IMAGE_ID
ARG TRIXIE_SOURCE_REVISION
ARG TRIXIE_SOURCE_TREE
ARG TRIXIE_GOSU_COMMIT
ARG TRIXIE_GOSU_USER_MODULE_VERSION
ARG TRIXIE_GOSU_X_SYS_MODULE_VERSION
ARG TRIXIE_CANDIDATE_LOCK_SHA256

COPY release-evidence/trixie-gnupg-purge-lock.tsv /tmp/taky-trixie-candidate-lock/purge.tsv
COPY release-evidence/trixie-gnupg-release-lock.tsv /tmp/taky-trixie-candidate-lock/releases.tsv
COPY release-evidence/trixie-gnupg-trust-lock.tsv /tmp/taky-trixie-candidate-lock/trust.tsv
COPY release-evidence/trixie-gnupg-candidate-lock.json /tmp/taky-trixie-candidate-lock/provenance.json

RUN set -eux; \
    evidence=/usr/share/taky-trixie-gnupg-candidate; \
    lock=/tmp/taky-trixie-candidate-lock; \
    mkdir -p "$evidence"; \
    test -n "$TRIXIE_OPERATIONAL_IMAGE"; \
    printf '%s' "$TRIXIE_OPERATIONAL_IMAGE_ID" | grep -Eq '^sha256:[a-f0-9]{64}$'; \
    printf '%s' "$TRIXIE_SOURCE_REVISION" | grep -Eq '^[a-f0-9]{40}$'; \
    printf '%s' "$TRIXIE_SOURCE_TREE" | grep -Eq '^[a-f0-9]{40}$'; \
    printf '%s' "$TRIXIE_CANDIDATE_LOCK_SHA256" | grep -Eq '^[a-f0-9]{64}$'; \
    printf '%s' "$TRIXIE_GOSU_COMMIT" | grep -Eq '^[a-f0-9]{40}$'; \
    test -n "$TRIXIE_GOSU_USER_MODULE_VERSION"; \
    test -n "$TRIXIE_GOSU_X_SYS_MODULE_VERSION"; \
    . /etc/os-release; \
    test "$VERSION_CODENAME" = trixie; \
    tab="$(printf '\t')"; \
    verify_release_set() { \
      stage="$1"; \
      output="$evidence/inrelease-$stage.tsv"; \
      : > "$output"; \
      while IFS="$tab" read -r codename suite expected; do \
        release_glob="*_dists_${codename}_InRelease"; \
        count="$(find /var/lib/apt/lists -maxdepth 1 -type f -name "$release_glob" -print | wc -l | tr -d '[:space:]')"; \
        test "$count" = 1 || { echo "Expected exactly one APT InRelease for $codename/$suite; found $count" >&2; exit 1; }; \
        release_file="$(find /var/lib/apt/lists -maxdepth 1 -type f -name "$release_glob" -print -quit)"; \
        actual="$(sha256sum "$release_file" | awk '{print $1}')"; \
        test "$actual" = "$expected" || { echo "Authenticated InRelease changed for $codename/$suite" >&2; exit 1; }; \
        printf '%s\t%s\t%s\n' "$codename" "$suite" "$actual" >> "$output"; \
      done < "$lock/releases.tsv"; \
      LC_ALL=C sort -o "$output" "$output"; \
      cut -f1,2,3 "$lock/releases.tsv" | LC_ALL=C sort > "$evidence/expected-release-set.tsv"; \
      cmp "$evidence/expected-release-set.tsv" "$output"; \
    }; \
    verify_trust_set() { \
      stage="$1"; \
      output="$evidence/trust-$stage.tsv"; \
      : > "$output"; \
      while IFS="$tab" read -r kind path expected; do \
        test -n "$kind" && test -n "$path" && printf '%s' "$expected" | grep -Eq '^[a-f0-9]{64}$'; \
        case "$kind" in \
          source) \
            case "$path" in sources.list.d/debian.sources|sources.list.d/pgdg.list) ;; *) echo "Unexpected source config path in trust lock: $path" >&2; exit 1 ;; esac; \
            image_path="/etc/apt/$path"; \
            test -f "$image_path"; \
            actual="$(sha256sum "$image_path" | awk '{print $1}')" ;; \
          keyring) test -f "$path"; actual="$(sha256sum "$path" | awk '{print $1}')" ;; \
          apt-signature-config) \
            test "$path" = apt-signature-config.txt; \
            apt-config dump | grep -Ei '^(APT::Key::|Dir[[:space:]]|Dir::Etc([[:space:]]|::Trusted))' > "$evidence/apt-signature-config.txt" || true; \
            actual="$(sha256sum "$evidence/apt-signature-config.txt" | awk '{print $1}')" ;; \
          apt-trusted-paths) \
            test "$path" = apt-trusted-paths.tsv; \
            apt-config shell TRUSTED Dir::Etc::Trusted/f TRUSTED_PARTS Dir::Etc::TrustedParts/d > "$evidence/apt-trusted-paths.shell"; \
            ! grep -q '^TRUSTED=' "$evidence/apt-trusted-paths.shell"; \
            trusted_parts="$(sed -n "s/^TRUSTED_PARTS='\\([^']*\\)';*$/\\1/p" "$evidence/apt-trusted-paths.shell" | sed 's#/*$##')"; \
            test "$trusted_parts" = /etc/apt/trusted.gpg.d; \
            printf 'trusted\t<unset>\ntrustedParts\t%s\n' "$trusted_parts" > "$evidence/apt-trusted-paths.tsv"; \
            actual="$(sha256sum "$evidence/apt-trusted-paths.tsv" | awk '{print $1}')" ;; \
          *) echo "Unsupported trust lock kind: $kind" >&2; exit 1 ;; \
        esac; \
        test "$actual" = "$expected" || { echo "Trust lock mismatch for $kind $path" >&2; exit 1; }; \
        printf '%s\t%s\t%s\n' "$kind" "$path" "$actual" >> "$output"; \
      done < "$lock/trust.tsv"; \
      LC_ALL=C sort -o "$output" "$output"; \
    }; \
    postgres --version > "$evidence/postgres-before.txt"; \
    pg_config --version > "$evidence/pg-config-before.txt"; \
    case "$(cat "$evidence/postgres-before.txt")" in 'postgres (PostgreSQL) 17.11'*) ;; *) echo 'Unexpected PostgreSQL version in candidate parent' >&2; exit 1 ;; esac; \
    case "$(cat "$evidence/pg-config-before.txt")" in 'PostgreSQL 17.11'*) ;; *) echo 'Unexpected pg_config version in candidate parent' >&2; exit 1 ;; esac; \
    gosu --version > "$evidence/gosu-before.txt"; \
    grep -Eq '^1\.19([[:space:]]|$)' "$evidence/gosu-before.txt"; \
    test -x /usr/bin/sqv; \
    sqv --version > "$evidence/sqv-before.txt" 2>&1; \
    grep -F 'sqv 1.3.0' "$evidence/sqv-before.txt" >/dev/null; \
    command -v apt-get > "$evidence/apt-get-path.txt"; \
    command -v apt-cache > "$evidence/apt-cache-path.txt"; \
    sha256sum "$(cat "$evidence/apt-get-path.txt")" "$(cat "$evidence/apt-cache-path.txt")" /usr/bin/sqv /usr/local/bin/gosu > "$evidence/verification-tools-before.sha256"; \
    test -s /usr/share/keyrings/debian-archive-keyring.pgp; \
    test -s /usr/local/share/keyrings/postgres.gpg.asc; \
    test "$(sha256sum "$lock/provenance.json" | awk '{print $1}')" = "$TRIXIE_CANDIDATE_LOCK_SHA256"; \
    apt-get --version > "$evidence/apt-before.txt"; \
    dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n' | awk -F '\t' '$4 == "installed" { print $1 "\t" $2 "\t" $3 }' | LC_ALL=C sort > "$evidence/dpkg-before.tsv"; \
    awk -F '\t' '$1 ~ /^libapt-pkg/ { print }' "$evidence/dpkg-before.tsv" > "$evidence/libapt-pkg-family-before.tsv"; \
    test -s "$evidence/libapt-pkg-family-before.tsv"; \
    awk -F '\t' 'NF != 3 || $1 == "" || $2 == "" || $3 == "" { bad=1 } END { exit bad }' "$lock/purge.tsv"; \
    LC_ALL=C sort -c "$lock/purge.tsv"; \
    test "$(wc -l < "$lock/purge.tsv" | tr -d '[:space:]')" = 14; \
    LC_ALL=C sort -u "$lock/purge.tsv" > "$evidence/unique-purge-lock.tsv"; \
    cmp "$lock/purge.tsv" "$evidence/unique-purge-lock.tsv"; \
    awk -F '\t' '$1 == "gnupg" && NF == 3 { found=1 } END { exit !found }' "$lock/purge.tsv"; \
    LC_ALL=C comm -23 "$lock/purge.tsv" "$evidence/dpkg-before.tsv" > "$evidence/missing-locked-packages-before.tsv"; \
    test ! -s "$evidence/missing-locked-packages-before.tsv"; \
    awk -F '\t' 'NF != 3 || !($1 ~ /^(trixie|trixie-updates|trixie-security|trixie-pgdg)$/) || $2 == "" || length($3) != 64 || $3 ~ /[^a-f0-9]/ { bad=1 } { print $1 "\t" $2 } END { if (NR != 4 || bad) exit 1 }' "$lock/releases.tsv" | LC_ALL=C sort > "$evidence/expected-release-hashes.tsv"; \
    printf '%s\n' 'trixie\tstable' 'trixie-pgdg\ttrixie-pgdg' 'trixie-security\tstable-security' 'trixie-updates\tstable-updates' | LC_ALL=C sort > "$evidence/required-releases.tsv"; \
    cut -f1,2 "$lock/releases.tsv" | LC_ALL=C sort > "$evidence/observed-locked-releases.tsv"; \
    cmp "$evidence/required-releases.tsv" "$evidence/observed-locked-releases.tsv"; \
    verify_trust_set before-purge; \
    sha256sum "$lock/purge.tsv" "$lock/releases.tsv" "$lock/trust.tsv" "$lock/provenance.json" > "$evidence/lock-inputs.sha256"; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /var/lib/apt/lists/partial; \
    apt-get -o Acquire::AllowInsecureRepositories=false -o Acquire::AllowDowngradeToInsecureRepositories=false -o Acquire::Check-Valid-Until=true -o APT::Get::AllowUnauthenticated=false --error-on=any update > "$evidence/apt-update-before-purge.log" 2>&1; \
    verify_release_set before-purge; \
    LC_ALL=C apt-get --simulate purge --auto-remove gnupg > "$evidence/purge-simulation.txt" 2>&1; \
    awk '$1 == "Remv" || $1 == "Purg" { name=$2; sub(/:.*/, "", name); print name }' "$evidence/purge-simulation.txt" | LC_ALL=C sort > "$evidence/simulated-removals.txt"; \
    cut -f1 "$lock/purge.tsv" | LC_ALL=C sort > "$evidence/expected-removal-names.txt"; \
    cmp "$evidence/expected-removal-names.txt" "$evidence/simulated-removals.txt"; \
    awk '$1 == "Remv" || $1 == "Purg" { name=$2; sub(/:.*/, "", name); if (name == "apt" || name ~ /^apt-/ || name == "sqv" || name == "gpgv" || name ~ /^debian-archive-keyring/ || name ~ /^debian-keyring/ || name ~ /^libapt-pkg/ || name ~ /^libpq/ || name == "libxml2" || name ~ /^postgresql/ || name == "gosu" || name == "ca-certificates") { print "Protected package in purge plan: " name > "/dev/stderr"; bad=1 } } END { exit bad }' "$evidence/purge-simulation.txt"; \
    apt-get purge --auto-remove --yes gnupg > "$evidence/purge-execution.log" 2>&1; \
    dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n' | awk -F '\t' '$4 == "installed" { print $1 "\t" $2 "\t" $3 }' | LC_ALL=C sort > "$evidence/dpkg-after.tsv"; \
    LC_ALL=C comm -23 "$evidence/dpkg-before.tsv" "$evidence/dpkg-after.tsv" > "$evidence/removed-packages.tsv"; \
    LC_ALL=C comm -13 "$evidence/dpkg-before.tsv" "$evidence/dpkg-after.tsv" > "$evidence/added-packages.tsv"; \
    test ! -s "$evidence/added-packages.tsv"; \
    cmp "$lock/purge.tsv" "$evidence/removed-packages.tsv"; \
    for required_package in apt sqv debian-archive-keyring libpq5 libxml2 postgresql-17; do \
      dpkg-query -W -f='${Status}\n' "$required_package" | grep -Fx 'install ok installed' >/dev/null; \
    done; \
    awk -F '\t' '$1 ~ /^libapt-pkg/ { print }' "$evidence/dpkg-after.tsv" > "$evidence/libapt-pkg-family-after.tsv"; \
    cmp "$evidence/libapt-pkg-family-before.tsv" "$evidence/libapt-pkg-family-after.tsv"; \
    ! dpkg-query -W -f='${Status}\n' gpgv >/dev/null 2>&1; \
    test -s /usr/share/keyrings/debian-archive-keyring.pgp; \
    test -s /usr/local/share/keyrings/postgres.gpg.asc; \
    sha256sum "$(cat "$evidence/apt-get-path.txt")" "$(cat "$evidence/apt-cache-path.txt")" /usr/bin/sqv /usr/local/bin/gosu > "$evidence/verification-tools-after.sha256"; \
    cmp "$evidence/verification-tools-before.sha256" "$evidence/verification-tools-after.sha256"; \
    apt-get --version > "$evidence/apt-after.txt"; \
    cmp "$evidence/apt-before.txt" "$evidence/apt-after.txt"; \
    sqv --version > "$evidence/sqv-after.txt" 2>&1; \
    cmp "$evidence/sqv-before.txt" "$evidence/sqv-after.txt"; \
    postgres --version > "$evidence/postgres-after.txt"; \
    pg_config --version > "$evidence/pg-config-after.txt"; \
    cmp "$evidence/postgres-before.txt" "$evidence/postgres-after.txt"; \
    cmp "$evidence/pg-config-before.txt" "$evidence/pg-config-after.txt"; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /var/lib/apt/lists/partial; \
    apt-get -o Acquire::AllowInsecureRepositories=false -o Acquire::AllowDowngradeToInsecureRepositories=false -o Acquire::Check-Valid-Until=true -o APT::Get::AllowUnauthenticated=false --error-on=any update > "$evidence/apt-update-after-purge.log" 2>&1; \
    verify_release_set after-purge; \
    verify_trust_set after-purge; \
    ldd /usr/lib/postgresql/17/bin/postgres /usr/lib/postgresql/17/bin/psql /usr/lib/postgresql/17/bin/pg_dump /usr/lib/postgresql/17/bin/pg_restore > "$evidence/postgres-link-check.txt"; \
    if grep -F 'not found' "$evidence/postgres-link-check.txt"; then echo 'PostgreSQL runtime has an unresolved shared library' >&2; exit 1; fi; \
    gosu --version > "$evidence/gosu-after.txt"; \
    gosu nobody true; \
    runtime_dir=/tmp/taky-trixie-postgres-smoke; \
    mkdir -p "$runtime_dir/data" "$runtime_dir/socket"; \
    chown -R postgres:postgres "$runtime_dir"; \
    gosu postgres /usr/lib/postgresql/17/bin/initdb -D "$runtime_dir/data" --no-locale --encoding=UTF8 --auth-local=trust --auth-host=trust > "$evidence/postgres-initdb.log" 2>&1; \
    gosu postgres /usr/lib/postgresql/17/bin/pg_ctl -D "$runtime_dir/data" -o "-k $runtime_dir/socket -h 127.0.0.1 -p 55432" -w start > "$evidence/postgres-start.log" 2>&1; \
    gosu postgres /usr/lib/postgresql/17/bin/psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -Atqc "SELECT current_setting('server_version_num'), xmlserialize(document xmlparse(document '<root/>') AS text)" > "$evidence/postgres-runtime-query.txt"; \
    grep -Fx '170011|<root/>' "$evidence/postgres-runtime-query.txt"; \
    gosu postgres /usr/lib/postgresql/17/bin/pg_dump -h 127.0.0.1 -p 55432 -U postgres -d postgres --format=custom -f "$runtime_dir/smoke.dump"; \
    gosu postgres /usr/lib/postgresql/17/bin/createdb -h 127.0.0.1 -p 55432 -U postgres smoke_restore; \
    gosu postgres /usr/lib/postgresql/17/bin/pg_restore -h 127.0.0.1 -p 55432 -U postgres -d smoke_restore "$runtime_dir/smoke.dump"; \
    gosu postgres /usr/lib/postgresql/17/bin/pg_ctl -D "$runtime_dir/data" -m fast -w stop > "$evidence/postgres-stop.log" 2>&1; \
    rm -rf "$runtime_dir"; \
    printf 'image=%s\nimage_id=%s\nplatform=linux/amd64\nsource_revision=%s\nsource_tree=%s\ncandidate_lock_sha256=%s\ngosu_commit=%s\ngosu_user_module=%s\ngosu_x_sys_module=%s\nsqv_version=%s\n' \
      "$TRIXIE_OPERATIONAL_IMAGE" "$TRIXIE_OPERATIONAL_IMAGE_ID" "$TRIXIE_SOURCE_REVISION" "$TRIXIE_SOURCE_TREE" \
      "$TRIXIE_CANDIDATE_LOCK_SHA256" "$TRIXIE_GOSU_COMMIT" "$TRIXIE_GOSU_USER_MODULE_VERSION" "$TRIXIE_GOSU_X_SYS_MODULE_VERSION" \
      "$(head -n 1 "$evidence/sqv-after.txt")" > "$evidence/candidate-build-inputs.txt"; \
    cp "$lock/provenance.json" "$evidence/candidate-lock-provenance.json"; \
    rm -rf "$lock" /var/lib/apt/lists/*

LABEL org.opencontainers.image.revision="${TRIXIE_SOURCE_REVISION}" \
      org.opencontainers.image.tree="${TRIXIE_SOURCE_TREE}" \
      io.taky.postgres.trixie-gnupg-candidate.platform="linux/amd64" \
      io.taky.postgres.trixie-gnupg-candidate.kind="trixie-gnupg-prune-candidate" \
      io.taky.postgres.trixie-gnupg-candidate.parent-image-id="${TRIXIE_OPERATIONAL_IMAGE_ID}" \
      io.taky.postgres.trixie-gnupg-candidate.source-revision="${TRIXIE_SOURCE_REVISION}" \
      io.taky.postgres.trixie-gnupg-candidate.source-tree="${TRIXIE_SOURCE_TREE}" \
      io.taky.postgres.trixie-gnupg-candidate.lock-sha256="${TRIXIE_CANDIDATE_LOCK_SHA256}" \
      io.taky.postgres.gosu.commit="${TRIXIE_GOSU_COMMIT}" \
      io.taky.postgres.gosu.user-module="${TRIXIE_GOSU_USER_MODULE_VERSION}" \
      io.taky.postgres.gosu.x-sys-module="${TRIXIE_GOSU_X_SYS_MODULE_VERSION}"
