#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export TS_DIR="$TMP"
export TS_MOD_DIR="$TMP/mod"
export TS_CONFIG_FILE="$TMP/config.env"
export TS_RUN_DIR="$TMP/run"
export TS_STATE_DIR="$TMP/state"
HELPER="$ROOT/tailscale/scripts/tailscaled.config"
mkdir -p "$TMP/bin"
cat >"$TMP/bin/busybox" <<'SH'
#!/bin/sh
if [ "$1" = pgrep ]; then
  [ "${FAKE_DAEMON:-1}" = 1 ]
  exit
fi
exec /usr/bin/busybox "$@"
SH
cat >"$TMP/bin/tailscale" <<'SH'
#!/bin/sh
echo "$1" >>"${TS_DIR}/tailscale.calls"
case "$1" in
  status) echo '{"BackendState":"NeedsLogin","Self":{"TailscaleIPs":["100.64.0.1"]}}' ;;
  ip) echo '100.64.0.1' ;;
  login) echo 'https://login.example.test/device' ;;
  ping) echo 'pong from peer (100.64.0.9) via DERP(hkg) in 21ms' ;;
  netcheck) printf '\nReport:\n\t* UDP: true\n\t* Nearest DERP: Hong Kong\n' ;;
  *) exit 0 ;;
esac
SH
chmod +x "$TMP/bin/busybox" "$TMP/bin/tailscale"

sh "$HELPER" set-many TS_START_ON_BOOT 0 TS_ENABLE_SSH 1 TS_HOSTNAME phone TS_LOGIN_SERVER 'https://headscale.example.test:8443' TS_UP_ARGS '--accept-dns=false --advertise-routes=10.0.0.0/24'
sh "$HELPER" get | jq -e '.startOnBoot == "0" and .enableSsh == "1" and .hostname == "phone" and .loginServer == "https://headscale.example.test:8443" and (.upArgs | contains("--advertise-routes"))' >/dev/null
set +u
. "$TMP/config.env"
set -u
[ "$TS_LOGIN_SERVER" = 'https://headscale.example.test:8443' ]
sh "$HELPER" webui | jq -e '.status.BackendState == "NeedsLogin" and .ip == "100.64.0.1" and .config and (.log != null)' >/dev/null
printf 'test log\n' >>"$TMP/run/runs.log"
sh "$HELPER" webui-log | jq -e '.log | contains("test log")' >/dev/null
before=$(wc -l <"$TMP/tailscale.calls")
FAKE_DAEMON=0 sh "$HELPER" webui | jq -e '.daemon == "stopped" and .status == {} and .ip == ""' >/dev/null
after=$(wc -l <"$TMP/tailscale.calls")
[ "$before" -eq "$after" ] || { echo 'stopped snapshot called tailscale CLI' >&2; exit 1; }
operation=$(sh "$HELPER" login-bg)
operation_id=$(printf '%s\n' "$operation" | sed -n 's/^OPERATION_ID=//p')
[ -n "$operation_id" ] || { echo 'missing operation id' >&2; exit 1; }
sleep 1
grep -F "=== OPERATION $operation_id login ===" "$TMP/run/runs.log" >/dev/null
grep -F 'https://login.example.test/device' "$TMP/run/runs.log" >/dev/null
grep -F "=== OPERATION $operation_id END exit=0 ===" "$TMP/run/runs.log" >/dev/null
sh "$HELPER" peer-test 100.64.0.9 | grep -F 'via DERP(hkg) in 21ms' >/dev/null
sh "$HELPER" netcheck | grep -F 'UDP: true' >/dev/null
if sh "$HELPER" peer-test '100.64.0.9;id' >/dev/null 2>&1; then
  echo 'unsafe peer target was accepted' >&2
  exit 1
fi
if sh "$HELPER" set TS_EXTRA_UP_ARGS 'x;id' >/dev/null 2>&1; then
  echo 'unsafe argument was accepted' >&2
  exit 1
fi
if sh "$HELPER" set TS_HOSTNAME 'bad host' >/dev/null 2>&1; then
  echo 'invalid hostname was accepted' >&2
  exit 1
fi
if sh "$HELPER" set TS_EXTRA_UP_ARGS $'bad\targ' >/dev/null 2>&1; then
  echo 'control character was accepted' >&2
  exit 1
fi
if sh "$HELPER" set TS_EXTRA_UP_ARGS '*' >/dev/null 2>&1; then
  echo 'shell glob was accepted' >&2
  exit 1
fi
if sh "$HELPER" set TS_LOGIN_SERVER "https://example.test/';touch $TMP/injected;#" >/dev/null 2>&1; then
  echo 'unsafe login server was accepted' >&2
  exit 1
fi
[ ! -e "$TMP/injected" ]
