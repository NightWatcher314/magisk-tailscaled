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
printf '%s\n' "$*" >>"${TS_DIR}/tailscale.calls"
case "$1" in
  status) echo '{"Version":"1.98.8","TUN":true,"BackendState":"NeedsLogin","Health":["login required"],"Self":{"TailscaleIPs":["100.64.0.1"]}}' ;;
  version) echo '1.98.8' ;;
  ip) echo '100.64.0.1' ;;
  login) echo 'https://login.example.test/device' ;;
  ping)
    echo 'pong from peer (100.64.0.9) via DERP(hkg) in 21ms'
    echo 'pong from peer (100.64.0.9) via peer-relay(100.64.0.8:40000:1) in 12ms'
    echo 'pong from peer (100.64.0.9) via 1.2.3.4:41641 in 8ms'
    echo 'pong from peer (100.64.0.9) via 1.2.3.4:41641 in 7ms'
    echo 'pong from peer (100.64.0.9) via 1.2.3.4:41641 in 6ms'
  ;;
  netcheck)
    echo 'warning: JSON format is unstable' >&2
    printf '%s\n' '{"UDP":true,"IPv4":true,"IPv6":false,"MappingVariesByDestIP":false,"UPnP":true,"PreferredDERP":8,"RegionLatency":{"8":0.021}}'
  ;;
  *) exit 0 ;;
esac
SH
chmod +x "$TMP/bin/busybox" "$TMP/bin/tailscale"

sh "$HELPER" set-many TS_START_ON_BOOT 0 TS_ENABLE_SSH 1 TS_HOSTNAME phone TS_LOGIN_SERVER 'https://headscale.example.test:8443' TS_UP_ARGS '--accept-dns=false --advertise-routes=10.0.0.0/24' TS_WATCHDOG_ENABLED 0 TS_LOG_MAX_KB 2048
sh "$HELPER" get | jq -e '.startOnBoot == "0" and .enableSsh == "1" and .hostname == "phone" and .loginServer == "https://headscale.example.test:8443" and (.upArgs | contains("--advertise-routes")) and .watchdogEnabled == "0" and .logMaxKb == "2048"' >/dev/null
set +u
. "$TMP/config.env"
set -u
[ "$TS_LOGIN_SERVER" = 'https://headscale.example.test:8443' ]
sh "$HELPER" validate
printf '\n' >>"$TMP/config.env"
sh "$HELPER" validate
grep -v '^TS_WATCHDOG_ENABLED\|^TS_LOG_MAX_KB' "$TMP/config.env" >"$TMP/config.old"
mv "$TMP/config.old" "$TMP/config.env"
sh "$HELPER" migrate
grep -F "TS_WATCHDOG_ENABLED='0'" "$TMP/config.env" >/dev/null
grep -F "TS_LOG_MAX_KB='1024'" "$TMP/config.env" >/dev/null
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
grep -F 'ping -c 5 --until-direct=false --timeout 2s 100.64.0.9' "$TMP/tailscale.calls" >/dev/null
sh "$HELPER" netcheck | jq -e '.report.UDP == true and .report.PreferredDERP == 8 and (.warnings | contains("unstable"))' >/dev/null
sh "$HELPER" health | jq -e '.daemonRunning == true and .backend == "NeedsLogin" and .tun == true and .config.valid == true and .watchdog.enabled == false and .logs.runBytes >= 0' >/dev/null
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
