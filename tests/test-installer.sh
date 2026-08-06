#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# shellcheck source=../tailscale/scripts/install.lib.sh
. "$ROOT/tailscale/scripts/install.lib.sh"

runtime="$TMP/runtime"
backup="$runtime/backups/02030100"
stage="$TMP/stage"
mkdir -p "$runtime/bin" "$runtime/scripts" "$runtime/state" "$runtime/run" "$runtime/ssh" "$runtime/certs" "$stage/bin" "$stage/scripts"
printf old >"$runtime/bin/tailscaled"
printf old >"$runtime/scripts/tailscaled.config"
printf old >"$runtime/settings.sh"
cp "$ROOT/tests/fixtures/config-v2.3.1.env" "$runtime/config.env"
printf state >"$runtime/tailscaled.state"
printf runtime >"$runtime/run/runs.log"
printf key >"$runtime/ssh/key"
printf cert >"$runtime/certs/cert"
printf new >"$stage/bin/tailscaled"
printf new >"$stage/bin/jq"
printf new >"$stage/scripts/tailscaled.config"
printf new >"$stage/settings.sh"

backup_runtime_data "$runtime" "$backup"
[ ! -e "$runtime/bin" ]
[ ! -e "$runtime/scripts" ]
grep -F "TS_UP_ARGS='--accept-dns=false --accept-routes=true --advertise-exit-node=false --shields-up=false --exit-node= --ssh=false'" "$runtime/config.env" >/dev/null
cmp "$runtime/config.env" "$backup/config.env"
for path in tailscaled.state state run ssh certs; do [ -e "$runtime/$path" ]; done

install_staged_runtime "$stage" "$runtime"
grep -F new "$runtime/bin/tailscaled" >/dev/null
grep -F new "$runtime/scripts/tailscaled.config" >/dev/null
printf "TS_HOSTNAME='changed'\n" >"$runtime/config.env"
restore_runtime_data "$runtime" "$backup"
grep -F old "$runtime/bin/tailscaled" >/dev/null
grep -F old "$runtime/scripts/tailscaled.config" >/dev/null
grep -F "TS_UP_ARGS='--accept-dns=false --accept-routes=true --advertise-exit-node=false --shields-up=false --exit-node= --ssh=false'" "$runtime/config.env" >/dev/null
for path in tailscaled.state state run ssh certs; do [ -e "$runtime/$path" ]; done

! grep -q 'releases/latest' "$ROOT/customize.sh"
grep -F 'Missing pinned URL or SHA256' "$ROOT/customize.sh" >/dev/null
grep -F 'restore_runtime_data "$TS_DIR" "$BACKUP_DIR"' "$ROOT/customize.sh" >/dev/null
grep -F 'Config validation:' "$ROOT/customize.sh" >/dev/null

malicious_config="$TMP/malicious-config.env"
executed_marker="$TMP/config-was-executed"
printf 'TS_HOSTNAME=$(touch %s)\n' "$executed_marker" >"$malicious_config"
if TS_CONFIG_FILE="$malicious_config" TS_DIR="$runtime" \
  sh "$ROOT/tailscale/scripts/tailscaled.config" validate >/dev/null 2>&1; then
  echo "malicious config unexpectedly passed validation" >&2
  exit 1
fi
[ ! -e "$executed_marker" ] || {
  echo "config validation executed config.env content" >&2
  exit 1
}
