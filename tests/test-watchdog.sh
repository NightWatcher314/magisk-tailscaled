#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
cleanup() {
  [ -n "${WATCHDOG_PID:-}" ] && kill "$WATCHDOG_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

export TS_DIR="$TMP/runtime"
export TS_BIN_DIR="$TS_DIR/bin"
export TS_SCRIPTS_DIR="$TS_DIR/scripts"
export TS_RUN_DIR="$TS_DIR/run"
export TS_STATE_DIR="$TS_DIR/state"
export TS_CONFIG_FILE="$TS_DIR/config.env"
export TS_MOD_DIR="$TMP/module"
mkdir -p "$TS_BIN_DIR" "$TS_SCRIPTS_DIR" "$TS_RUN_DIR" "$TS_STATE_DIR" "$TS_MOD_DIR"
cp "$ROOT/tailscale/settings.sh" "$TS_DIR/settings.sh"
cp "$ROOT/tailscale/scripts/tailscaled.watchdog" "$TS_SCRIPTS_DIR/tailscaled.watchdog"

cat >"$TS_BIN_DIR/busybox" <<'SH'
#!/bin/sh
if [ "$1" = pgrep ] && [ "$2" = -x ] && [ "$3" = tailscaled ]; then
  [ -f "$TS_DIR/daemon.alive" ]
  exit
fi
exit 1
SH
cat >"$TS_SCRIPTS_DIR/tailscaled.service" <<'SH'
#!/bin/sh
echo "$1" >>"$TS_DIR/service.calls"
[ -f "$TS_DIR/start.fail" ] && exit 1
[ "$1" = start ] && : >"$TS_DIR/daemon.alive"
SH
chmod +x "$TS_BIN_DIR/busybox" "$TS_SCRIPTS_DIR/tailscaled.service" "$TS_SCRIPTS_DIR/tailscaled.watchdog"

write_config() {
  cat >"$TS_CONFIG_FILE" <<EOF
TS_START_ON_BOOT='$1'
TS_WATCHDOG_ENABLED='$2'
TS_LOG_MAX_KB='128'
EOF
}

write_config 1 1
TS_WATCHDOG_TEST_DELAY=0 TS_WATCHDOG_INTERVAL=0 TS_WATCHDOG_MAX_LOOPS=1 sh "$TS_SCRIPTS_DIR/tailscaled.watchdog"
grep -Fx start "$TS_DIR/service.calls" >/dev/null
[ "$(cat "$TS_RUN_DIR/watchdog-restarts")" = 1 ]
[ ! -e "$TS_RUN_DIR/watchdog.pid" ]

rm -f "$TS_DIR/daemon.alive" "$TS_DIR/service.calls"
: >"$TS_RUN_DIR/manual-stop"
TS_WATCHDOG_TEST_DELAY=0 TS_WATCHDOG_MAX_LOOPS=1 sh "$TS_SCRIPTS_DIR/tailscaled.watchdog"
[ ! -e "$TS_DIR/service.calls" ]
rm -f "$TS_RUN_DIR/manual-stop"

write_config 0 1
TS_WATCHDOG_TEST_DELAY=0 TS_WATCHDOG_MAX_LOOPS=1 sh "$TS_SCRIPTS_DIR/tailscaled.watchdog"
[ ! -e "$TS_DIR/service.calls" ]

write_config 1 0
TS_WATCHDOG_TEST_DELAY=0 TS_WATCHDOG_MAX_LOOPS=1 sh "$TS_SCRIPTS_DIR/tailscaled.watchdog"
[ ! -e "$TS_DIR/service.calls" ]

write_config 1 1
rm -f "$TS_DIR/service.calls"
: >"$TS_DIR/start.fail"
if TS_WATCHDOG_TEST_DELAY=0 TS_WATCHDOG_INTERVAL=0 sh "$TS_SCRIPTS_DIR/tailscaled.watchdog"; then
  echo 'watchdog did not stop after bounded recovery attempts' >&2
  exit 1
fi
[ "$(grep -c '^start$' "$TS_DIR/service.calls")" -eq 6 ]
rm -f "$TS_DIR/start.fail" "$TS_DIR/service.calls"

: >"$TS_DIR/daemon.alive"
TS_WATCHDOG_INTERVAL=1 sh "$TS_SCRIPTS_DIR/tailscaled.watchdog" &
WATCHDOG_PID=$!
for _ in $(seq 1 50); do [ -f "$TS_RUN_DIR/watchdog.pid" ] && break; sleep 0.02; done
kill "$WATCHDOG_PID"
wait "$WATCHDOG_PID"
WATCHDOG_PID=
[ ! -e "$TS_RUN_DIR/watchdog.pid" ]
