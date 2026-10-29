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
COPY release-evidence/trixie-gnupg-package-index-lock.tsv /tmp/taky-trixie-candidate-lock/package-index.tsv
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
    parse_utc_release_time() { \
      value="$1"; \
      printf '%s\n' "$value" | grep -Eq '^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-3][0-9] (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9] UTC$' || return 1; \
      parsed="$(date -u -d "$value" '+%a, %d %b %Y %H:%M:%S UTC' 2>/dev/null)" || return 1; \
      test "$parsed" = "$value" || return 1; \
      date -u -d "$value" +%s; \
    }; \
    verify_release_set() { \
      stage="$1"; \
      output="$evidence/inrelease-freshness-$stage.tsv"; \
      : > "$output"; \
      now="$(date -u +%s)"; \
      total_release_count="$(find /var/lib/apt/lists -maxdepth 1 -type f -name '*_InRelease' -print | wc -l | tr -d '[:space:]')"; \
      test "$total_release_count" = 4 || { echo "Expected exactly four APT InRelease files; found $total_release_count" >&2; exit 1; }; \
      while IFS="$tab" read -r codename suite expected_origin base_uri max_age warn_age; do \
        release_glob="*_dists_${codename}_InRelease"; \
        count="$(find /var/lib/apt/lists -maxdepth 1 -type f -name "$release_glob" -print | wc -l | tr -d '[:space:]')"; \
        test "$count" = 1 || { echo "Expected exactly one APT InRelease for $codename/$suite; found $count" >&2; exit 1; }; \
        release_file="$(find /var/lib/apt/lists -maxdepth 1 -type f -name "$release_glob" -print -quit)"; \
        metadata="$(awk 'BEGIN { FS=": " } /^(Codename|Suite|Origin|Date|Valid-Until):/ { key=$1; sub(/^[^:]*: /, ""); value=$0; if (key in seen) exit 2; seen[key]=value } END { if (!("Codename" in seen) || !("Suite" in seen) || !("Origin" in seen) || !("Date" in seen)) exit 3; printf "%s\t%s\t%s\t%s\t%s\n", seen["Codename"], seen["Suite"], seen["Origin"], seen["Date"], seen["Valid-Until"] }' "$release_file")"; \
        actual_codename="$(printf '%s\n' "$metadata" | cut -f1)"; \
        actual_suite="$(printf '%s\n' "$metadata" | cut -f2)"; \
        actual_origin="$(printf '%s\n' "$metadata" | cut -f3)"; \
        release_date="$(printf '%s\n' "$metadata" | cut -f4)"; \
        valid_until="$(printf '%s\n' "$metadata" | cut -f5)"; \
        test "$actual_codename" = "$codename" && test "$actual_suite" = "$suite" && test "$actual_origin" = "$expected_origin" || { echo "Authenticated Release identity mismatch for $codename/$suite" >&2; exit 1; }; \
        release_epoch="$(parse_utc_release_time "$release_date")"; \
        test -n "$release_epoch" || { echo "Malformed Release Date for $codename/$suite" >&2; exit 1; }; \
        age="$((now - release_epoch))"; \
        test "$age" -ge -300 || { echo "Release Date is more than 300 seconds in the future for $codename/$suite" >&2; exit 1; }; \
        test "$age" -le "$max_age" || { echo "Release Date exceeds freshness cap for $codename/$suite" >&2; exit 1; }; \
        if test -n "$valid_until"; then \
          valid_until_epoch="$(parse_utc_release_time "$valid_until")"; \
          test -n "$valid_until_epoch" && test "$valid_until_epoch" -gt "$now" && test "$valid_until_epoch" -ge "$release_epoch" || { echo "Invalid or expired Valid-Until for $codename/$suite" >&2; exit 1; }; \
        else valid_until_epoch=; fi; \
        freshness_warning=no; test "$age" -lt "$warn_age" || freshness_warning=yes; \
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$codename" "$suite" "$actual_origin" "$base_uri" "$release_date" "$release_epoch" "$age" "$max_age" "$warn_age" "$freshness_warning" "$valid_until_epoch" >> "$output"; \
      done < "$lock/releases.tsv"; \
      LC_ALL=C sort -o "$output" "$output"; \
      cp "$output" "$evidence/release-freshness-$stage.tsv"; \
      awk -F '\t' '$10 == "yes" { print "Release freshness warning: " $1 "/" $2 " is " $7 " seconds old (warning threshold " $9 ")" > "/dev/stderr" }' "$output"; \
      apt-get indextargets > "$evidence/apt-index-targets-$stage.control"; \
      awk 'BEGIN { RS=""; FS="\n" } { id=code=suite=arch=file=uri=base=meta=component=""; for (i=1;i<=NF;i++) { line=$i; sub(/\r$/, "", line); if (line ~ /^Identifier: /) id=substr(line,13); else if (line ~ /^Codename: /) code=substr(line,11); else if (line ~ /^Suite: /) suite=substr(line,8); else if (line ~ /^Architecture: /) arch=substr(line,15); else if (line ~ /^Filename: /) file=substr(line,11); else if (line ~ /^URI: /) uri=substr(line,6); else if (line ~ /^Base-URI: /) base=substr(line,11); else if (line ~ /^MetaKey: /) meta=substr(line,10); else if (line ~ /^Component: /) component=substr(line,12) } if (id=="Packages") { if (code==""||suite==""||arch==""||file==""||uri==""||base==""||meta==""||component=="") exit 2; print code "\t" suite "\t" arch "\t" file "\t" uri "\t" base "\t" meta "\t" component } }' "$evidence/apt-index-targets-$stage.control" | LC_ALL=C sort > "$evidence/apt-index-targets-$stage.tsv"; \
      awk -F '\t' 'FNR==NR { if (NF!=6) bad=1; release[$1]=$2 SUBSEP $3 SUBSEP $4; next } { if (NF!=10) { bad=1; next } n=split(release[$1], r, SUBSEP); if (n!=3 || r[1]!=$2 || r[2]!=$3 || r[3]!=$4) bad=1; key=$1 SUBSEP $2 SUBSEP $6 SUBSEP $4 SUBSEP $7 SUBSEP $5; targets[key]=$1 "\t" $2 "\t" $6 "\t" $4 "\t" $7 "\t" $5; if ($7==$8) canonical[key]=1 } END { count=0; for (key in targets) { count++; if (!canonical[key]) bad=1; print targets[key] } if (bad || count!=5) exit 1 }' "$lock/releases.tsv" "$lock/package-index.tsv" > "$evidence/expected-apt-index-targets-$stage.unsorted.tsv"; \
      LC_ALL=C sort "$evidence/expected-apt-index-targets-$stage.unsorted.tsv" > "$evidence/expected-apt-index-targets-$stage.tsv"; \
      test "$(wc -l < "$evidence/apt-index-targets-$stage.tsv" | tr -d '[:space:]')" = 5; \
      : > "$evidence/observed-apt-index-targets-$stage.tsv"; \
      while IFS="$tab" read -r target_codename target_suite target_arch target_file target_uri target_base target_meta target_component; do \
        test "$target_uri" = "$target_base$target_meta" || { echo "APT target URI does not bind to locked Base-URI plus canonical MetaKey" >&2; exit 1; }; \
        test -f "$target_file"; \
        printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$target_codename" "$target_suite" "$target_arch" "$target_base" "$target_meta" "$target_component" >> "$evidence/observed-apt-index-targets-$stage.tsv"; \
      done < "$evidence/apt-index-targets-$stage.tsv"; \
      LC_ALL=C sort -o "$evidence/observed-apt-index-targets-$stage.tsv" "$evidence/observed-apt-index-targets-$stage.tsv"; \
      cmp "$evidence/expected-apt-index-targets-$stage.tsv" "$evidence/observed-apt-index-targets-$stage.tsv"; \
      awk -F '\t' 'NF!=10 { bad=1; next } { print $1 "\t" $2 "\t" $3 "\t" $4 "\t" $5 "\t" $6 "\t" $7 "\t" $8 "\t" $9 "\t" $10 }' "$lock/package-index.tsv" | LC_ALL=C sort -u > "$evidence/expected-package-index-$stage.tsv"; \
      : > "$evidence/observed-package-index-$stage.tsv"; \
      while IFS="$tab" read -r ci cs co cb component arch canonical variant expected_sha expected_size; do \
        release_glob="*_dists_${ci}_InRelease"; release_file="$(find /var/lib/apt/lists -maxdepth 1 -type f -name "$release_glob" -print -quit)"; \
        awk -v c="$canonical" 'BEGIN { insha=0 } /^SHA256:/ { insha=1; next } insha && /^[A-Za-z0-9-]+:/ { insha=0 } insha && NF==3 { p=$3; keep=(p==c); if (index(p,c ".")==1) { suffix=substr(p,length(c)+2); keep=(suffix=="gz" || suffix=="xz" || suffix=="bz2" || suffix=="lz4" || suffix=="zst") } if (keep) print p "\t" $1 "\t" $2 }' "$release_file" | awk -F '\t' -v codename="$ci" -v suite="$cs" -v origin="$co" -v base="$cb" -v comp="$component" -v arch="$arch" -v canon="$canonical" '{ print codename "\t" suite "\t" origin "\t" base "\t" comp "\t" arch "\t" canon "\t" $1 "\t" $2 "\t" $3 }' >> "$evidence/observed-package-index-$stage.tsv"; \
      done < "$lock/package-index.tsv"; \
      LC_ALL=C sort -u -o "$evidence/observed-package-index-$stage.tsv" "$evidence/observed-package-index-$stage.tsv"; \
      cmp "$evidence/expected-package-index-$stage.tsv" "$evidence/observed-package-index-$stage.tsv"; \
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
    package_index_sha="$(sha256sum "$lock/package-index.tsv" | awk '{print $1}')"; \
    release_lock_sha="$(sha256sum "$lock/releases.tsv" | awk '{print $1}')"; \
    package_lock_sha="$(sha256sum "$lock/purge.tsv" | awk '{print $1}')"; \
    trust_lock_sha="$(sha256sum "$lock/trust.tsv" | awk '{print $1}')"; \
    grep -F '"packageIndexLockPath": "release-evidence/trixie-gnupg-package-index-lock.tsv"' "$lock/provenance.json" >/dev/null; \
    grep -F '"packageIndex": "'"$package_index_sha"'"' "$lock/provenance.json" >/dev/null; \
    grep -F '"release": "'"$release_lock_sha"'"' "$lock/provenance.json" >/dev/null; \
    grep -F '"package": "'"$package_lock_sha"'"' "$lock/provenance.json" >/dev/null; \
    grep -F '"trust": "'"$trust_lock_sha"'"' "$lock/provenance.json" >/dev/null; \
    grep -F '"maxFutureSkewSeconds": 300' "$lock/provenance.json" >/dev/null; \
    apt-get --version > "$evidence/apt-before.txt"; \
    dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n' | awk -F '\t' '$4 == "installed" { print $1 "\t" $2 "\t" $3 }' | LC_ALL=C sort > "$evidence/dpkg-before.tsv"; \
    awk -F '\t' '$1 ~ /^libapt-pkg/ { print }' "$evidence/dpkg-before.tsv" > "$evidence/libapt-pkg-family-before.tsv"; \
    test -s "$evidence/libapt-pkg-family-before.tsv"; \
    awk -F '\t' 'NF != 3 || $1 == "" || $2 == "" || $3 == "" { bad=1 } END { exit bad }' "$lock/purge.tsv"; \
    LC_ALL=C sort -c "$lock/purge.tsv"; \
    test "$(wc -l < "$lock/purge.tsv" | tr -d '[:space:]')" = 14; \
    LC_ALL=C sort -u "$lock/purge.tsv" > "$evidence/unique-purge-lock.tsv"; \
    cmp "$lock/purge.tsv" "$evidence/unique-purge-lock.tsv"; \
    awk -F '\t' 'NF != 10 || $1 == "" || $2 == "" || $3 == "" || $4 == "" || $5 == "" || $6 == "" || $7 == "" || $8 == "" || length($9) != 64 || $9 ~ /[^a-f0-9]/ || $10 !~ /^[0-9]+$/ { bad=1 } END { exit bad }' "$lock/package-index.tsv"; \
    LC_ALL=C sort -c "$lock/package-index.tsv"; \
    LC_ALL=C sort -u "$lock/package-index.tsv" > "$evidence/unique-package-index-lock.tsv"; \
    cmp "$lock/package-index.tsv" "$evidence/unique-package-index-lock.tsv"; \
    awk -F '\t' '$1 == "gnupg" && NF == 3 { found=1 } END { exit !found }' "$lock/purge.tsv"; \
    LC_ALL=C comm -23 "$lock/purge.tsv" "$evidence/dpkg-before.tsv" > "$evidence/missing-locked-packages-before.tsv"; \
    test ! -s "$evidence/missing-locked-packages-before.tsv"; \
    awk -F '\t' 'NF != 6 || $1 == "" || $2 == "" || $3 == "" || $4 == "" || $5 !~ /^[0-9]+$/ || $6 !~ /^[0-9]+$/ || $6 > $5 || ($1 == "trixie" && !($2 == "stable" && $3 == "Debian" && $4 == "http://deb.debian.org/debian/dists/trixie/" && $5 == 7776000 && $6 == 5184000)) || ($1 == "trixie-updates" && !($2 == "stable-updates" && $3 == "Debian" && $4 == "http://deb.debian.org/debian/dists/trixie-updates/" && $5 == 604800 && $6 == 518400)) || ($1 == "trixie-security" && !($2 == "stable-security" && $3 == "Debian" && $4 == "http://deb.debian.org/debian-security/dists/trixie-security/" && $5 == 604800 && $6 == 518400)) || ($1 == "trixie-pgdg" && !($2 == "trixie-pgdg" && $3 == "apt.postgresql.org" && $4 == "http://apt.postgresql.org/pub/repos/apt/dists/trixie-pgdg/" && $5 == 604800 && $6 == 518400)) { bad=1 } { print $1 "\t" $2 } END { if (NR != 4 || bad) exit 1 }' "$lock/releases.tsv" > "$evidence/expected-release-identities.unsorted.tsv"; \
    LC_ALL=C sort "$evidence/expected-release-identities.unsorted.tsv" > "$evidence/expected-release-identities.tsv"; \
    printf 'trixie\tstable\ntrixie-pgdg\ttrixie-pgdg\ntrixie-security\tstable-security\ntrixie-updates\tstable-updates\n' | LC_ALL=C sort > "$evidence/required-releases.tsv"; \
    cmp "$evidence/required-releases.tsv" "$evidence/expected-release-identities.tsv"; \
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
