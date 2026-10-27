#!/bin/sh
set -eu

usage() {
  echo "Usage: $0 prepare <rclone-source-root> | advisory-db <empty-output-directory>" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
mode=$1
target=$2

fail() { echo "rclone x/net remediation: $*" >&2; exit 1; }

case "$mode" in
  prepare)
    [ -d "$target" ] && [ -f "$target/go.mod" ] || fail "source root has no go.mod: $target"
    go_version=$(go version)
    [ "$(printf '%s\n' "$go_version" | awk '{print $3}')" = go1.27.3 ] || fail "expected Go 1.27.3, got: $go_version"
    export GOTOOLCHAIN=local GOWORK=off GOENV=off GOSUMDB=sum.golang.org
    export GOPROXY=https://proxy.golang.org,direct
    export GOPRIVATE= GONOSUMDB= GOINSECURE=
    export GOFLAGS=-mod=mod
    cd "$target"

    module_version() {
      go list -m "$1" | awk 'NR == 1 { print $2 }'
    }
    expected_baseline() {
      [ "$(module_version golang.org/x/crypto)" = v0.57.0 ] || fail "unexpected baseline x/crypto version"
      [ "$(module_version golang.org/x/net)" = v0.60.0 ] || fail "unexpected baseline x/net version"
      [ "$(module_version golang.org/x/sync)" = v0.23.0 ] || fail "unexpected baseline x/sync version"
      [ "$(module_version golang.org/x/sys)" = v0.48.0 ] || fail "unexpected baseline x/sys version"
      [ "$(module_version golang.org/x/term)" = v0.46.0 ] || fail "unexpected baseline x/term version"
      [ "$(module_version golang.org/x/text)" = v0.42.0 ] || fail "unexpected baseline x/text version"
      [ "$(module_version golang.org/x/tools)" = v0.49.0 ] || fail "unexpected baseline x/tools version"
      [ "$(module_version golang.org/x/mod)" = v0.41.0 ] || fail "unexpected baseline x/mod version"
      [ "$(module_version golang.org/x/telemetry)" = v0.0.0-20260811182544-a038080d80e5 ] || fail "unexpected baseline x/telemetry version"
    }
    expected_fixed() {
      [ "$(module_version golang.org/x/crypto)" = v0.58.0 ] || fail "unexpected fixed x/crypto version"
      [ "$(module_version golang.org/x/net)" = v0.62.0 ] || fail "unexpected fixed x/net version"
      [ "$(module_version golang.org/x/sync)" = v0.24.0 ] || fail "unexpected fixed x/sync version"
      [ "$(module_version golang.org/x/sys)" = v0.49.0 ] || fail "unexpected fixed x/sys version"
      [ "$(module_version golang.org/x/term)" = v0.47.0 ] || fail "unexpected fixed x/term version"
      [ "$(module_version golang.org/x/text)" = v0.43.0 ] || fail "unexpected fixed x/text version"
      [ "$(module_version golang.org/x/tools)" = v0.51.0 ] || fail "unexpected fixed x/tools version"
      [ "$(module_version golang.org/x/mod)" = v0.41.0 ] || fail "x/mod must remain at v0.41.0"
      [ "$(module_version golang.org/x/telemetry)" = v0.0.0-20260924152758-ed294f943157 ] || fail "unexpected fixed x/telemetry version"
    }

    chi=$(module_version github.com/go-chi/chi/v5)
    [ "$chi" = v5.4.0 ] || fail "expected the reviewed chi v5.4.0 patch, got $chi"
    current_net=$(module_version golang.org/x/net)
    case "$current_net" in
      v0.60.0) expected_baseline ;;
      v0.62.0) expected_fixed ;;
      *) fail "unexpected x/net version: $current_net" ;;
    esac
    before=$(mktemp)
    after=$(mktemp)
    filtered_before=$(mktemp)
    filtered_after=$(mktemp)
    filtered_x_before=$(mktemp)
    filtered_x_after=$(mktemp)
    trap 'rm -f "$before" "$after" "$filtered_before" "$filtered_after" "$filtered_x_before" "$filtered_x_after"' EXIT HUP INT TERM
    go list -m all | sort > "$before"
    if [ "$current_net" = v0.60.0 ]; then
      go mod edit -require=golang.org/x/net@v0.62.0
      go mod tidy
      go mod vendor
    fi
    go mod verify
    GOFLAGS=-mod=mod go list -m all | sort > "$after"
    expected_fixed
    # Only the reviewed x/* MVS closure may change. Every other module must
    # resolve to the same version, and no module may be added or removed.
    awk '$1 !~ /^golang.org\/x\// { print }' "$before" > "$filtered_before"
    awk '$1 !~ /^golang.org\/x\// { print }' "$after" > "$filtered_after"
    cmp -s "$filtered_before" "$filtered_after" || fail "non-x module graph changed during x/net upgrade"
    awk '$1 ~ /^golang.org\/x\// && $1 !~ /^golang.org\/x\/(crypto|net|sync|sys|term|text|tools|mod|telemetry)$/ { print }' "$before" > "$filtered_x_before"
    awk '$1 ~ /^golang.org\/x\// && $1 !~ /^golang.org\/x\/(crypto|net|sync|sys|term|text|tools|mod|telemetry)$/ { print }' "$after" > "$filtered_x_after"
    cmp -s "$filtered_x_before" "$filtered_x_after" || fail "unexpected x/* module changed outside the reviewed MVS closure"
    for module in golang.org/x/crypto golang.org/x/net golang.org/x/sync golang.org/x/sys golang.org/x/term golang.org/x/text golang.org/x/tools golang.org/x/mod golang.org/x/telemetry; do
      grep -F "${module} " "$after" >/dev/null || fail "module missing from resolved MVS graph: $module"
    done
    awk '$2 == "golang.org/x/crypto" && $3 == "v0.58.0" { crypto=1 }
         $2 == "golang.org/x/net" && $3 == "v0.62.0" { net=1 }
         $2 == "golang.org/x/sync" && $3 == "v0.24.0" { sync=1 }
         $2 == "golang.org/x/sys" && $3 == "v0.49.0" { sys=1 }
         $2 == "golang.org/x/term" && $3 == "v0.47.0" { term=1 }
         $2 == "golang.org/x/text" && $3 == "v0.43.0" { text=1 }
         $2 == "golang.org/x/tools" && $3 == "v0.51.0" { tools=1 }
         END { exit !(crypto && net && sync && sys && term && text && tools) }' "$target/vendor/modules.txt" || fail "vendor/modules.txt does not match the reviewed vendored MVS closure"
    echo "Resolved and verified the reviewed x/* MVS closure using authenticated Go module and checksum-database resolution."
    echo "Resolved golang.org/x modules:"
    awk '$1 ~ /^golang.org\/x\// { print }' "$after"
    ;;
  advisory-db)
    command -v curl >/dev/null 2>&1 || fail "curl is required"
    command -v jq >/dev/null 2>&1 || fail "jq is required"
    command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
    [ ! -e "$target" ] || [ -z "$(find "$target" -mindepth 1 -print -quit)" ] || fail "advisory output directory must be empty"
    mkdir -p "$target/ID" "$target/index"
    db_time=2026-10-27T21:16:18Z
    : > "$target/retrieval-metadata.txt"
    index_vulns='[]'
    index_module_vulns='[]'
    for id in GO-2026-6860 GO-2026-6866; do
      case "$id" in
        GO-2026-6860) url=https://vuln.go.dev/ID/GO-2026-6860.json; expected=443304c129b9540dc46d28392b973a136db90644019dc20c3e25941833d49df3; symbol=Parse ;;
        GO-2026-6866) url=https://vuln.go.dev/ID/GO-2026-6866.json; expected=c0d687be9779f000941b6c847646075598b659cdd51476951559208956bd0f82; symbol=Render ;;
      esac
      record="$target/ID/$id.json"
      headers="$target/ID/$id.headers"
      curl --fail --silent --show-error --location -H 'Cache-Control: no-cache' --dump-header "$headers" "$url" --output "$record"
      actual=$(sha256sum "$record" | awk '{print $1}')
      [ "$actual" = "$expected" ] || fail "$id bytes do not match pinned official OSV SHA-256 (got $actual)"
      jq -e --arg id "$id" --arg fixed 0.62.0 --arg date "$db_time" --arg symbol "$symbol" \
        '.id == $id and .modified == $date and
         any(.affected[]; .package.name == "golang.org/x/net" and
           any(.ranges[]?.events[]?; .fixed == $fixed) and
           any(.ecosystem_specific.imports[]?.symbols[]?; . == $symbol))' "$record" >/dev/null || fail "$id official record identity, date, module, symbol, or fixed version mismatch"
      retrieved_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
      etag=$(awk 'BEGIN { IGNORECASE=1 } /^ETag:/ { sub(/^[^:]*:[[:space:]]*/, ""); gsub(/\r/, ""); value=$0 } END { print value }' "$headers")
      last_modified=$(awk 'BEGIN { IGNORECASE=1 } /^Last-Modified:/ { sub(/^[^:]*:[[:space:]]*/, ""); gsub(/\r/, ""); value=$0 } END { print value }' "$headers")
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$url" "$retrieved_at" "$db_time" "$actual" "${etag:-missing}" "${last_modified:-missing}" >> "$target/retrieval-metadata.txt"
      aliases=$(jq -c '.aliases // []' "$record")
      index_vulns=$(printf '%s' "$index_vulns" | jq -c --arg id "$id" --arg date "$db_time" --argjson aliases "$aliases" '. + [{id:$id, modified:$date, aliases:$aliases}]')
      index_module_vulns=$(printf '%s' "$index_module_vulns" | jq -c --arg id "$id" --arg date "$db_time" '. + [{id:$id, modified:$date, fixed:"0.62.0"}]')
    done
    jq -n --arg date "$db_time" '{modified:$date}' > "$target/index/db.json"
    printf '%s\n' "$index_vulns" > "$target/index/vulns.json"
    jq -n --argjson vulns "$index_module_vulns" '[{path:"golang.org/x/net", vulns:$vulns}]' > "$target/index/modules.json"
    printf 'SUPPLEMENTAL ONLY: this local overlay contains exactly GO-2026-6860 and GO-2026-6866. It is not the canonical or complete Go vulnerability database. Records were fetched over HTTPS with Cache-Control: no-cache and their exact bytes were verified against pinned SHA-256 values.\n' > "$target/SUPPLEMENTAL-ONLY.txt"
    echo "Supplemental two-advisory overlay only; not canonical/full Go vulnerability database."
    cat "$target/retrieval-metadata.txt"
    ;;
  *) usage ;;
esac
