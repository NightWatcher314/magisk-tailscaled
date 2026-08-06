#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export TS_DIR="$TMP"
export TS_RUN_DIR="$TMP/run"
export TS_STATE_DIR="$TMP/state"
export TS_CONFIG_FILE="$TMP/config.env"
export TS_LOG_MAX_KB=128
mkdir -p "$TS_RUN_DIR"
# shellcheck source=../tailscale/settings.sh
. "$ROOT/tailscale/settings.sh"

for round in 1 2 3 4; do
  dd if=/dev/zero bs=1024 count=129 status=none | tr '\0' "$round" >"$TS_RUN_LOG_FILE"
  log Info "round-$round"
  grep -F "round-$round" "$TS_RUN_LOG_FILE" >/dev/null
done
for suffix in 1 2 3; do [ -s "$TS_RUN_LOG_FILE.$suffix" ]; done

dd if=/dev/zero bs=1024 count=129 status=none >"$TS_LOG_FILE"
rotate_log "$TS_LOG_FILE" rename
[ ! -e "$TS_LOG_FILE" ]
[ -s "$TS_LOG_FILE.1" ]

writer_log="$TS_RUN_DIR/writer.log"
for _ in $(seq 1 200); do printf '%1024s\n' x; done |
  sh "$ROOT/tailscale/scripts/tailscaled.logwriter" "$writer_log"
[ -s "$writer_log.1" ]
[ "$(wc -c <"$writer_log")" -lt $((128 * 1024)) ]
[ "$(wc -c <"$writer_log.1")" -le $((129 * 1024)) ]

invalid_limit_log="$TS_RUN_DIR/invalid-limit.log"
printf 'fallback limit\n' | TS_LOG_MAX_KB=invalid sh "$ROOT/tailscale/scripts/tailscaled.logwriter" "$invalid_limit_log"
grep -Fx 'fallback limit' "$invalid_limit_log" >/dev/null
[ ! -e "$invalid_limit_log.1" ]
