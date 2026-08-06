#!/system/bin/sh
DIR=$(dirname "$(realpath "$0")")
# shellcheck source=tailscale/settings.sh
. "$DIR"/../settings.sh
case "$1" in
    postinstall)
      mkdir -p "$TS_RUN_DIR"
      log Info "Applying updated Magisk Tailscaled runtime."
      tailscaled.service restart >> "/dev/null" 2>&1 &
      tailscaled.config watchdog-sync >/dev/null 2>&1 || true
      exit 0
    ;;
esac
start_service() {
  case "${TS_START_ON_BOOT:-1}" in 0|false) log Info "Autostart disabled by ${TS_CONFIG_FILE}."; return 0;; esac
  if [ ! -f "${TS_MOD_DIR}/disable" ]; then
    tailscaled.service start >> "/dev/null" 2>&1
  fi
}
start_inotifyd() {
  for PID in $(busybox pidof inotifyd); do
    if grep -q "tailscaled.inotify" "/proc/$PID/cmdline"; then
      kill -9 "$PID"
    fi
  done
  log Info "Starting tailscaled inotify service."
  inotifyd "tailscaled.inotify" "${TS_MOD_DIR}" >> "/dev/null" 2>&1 &
}

module_version=$(busybox awk -F'=' '!/^ *#/ && /version=/ { print $2 }' "$TS_MOD_PROP" 2>/dev/null)
log Info "Magisk Tailscaled version : ${module_version}."
start_service
tailscaled.config watchdog-sync >/dev/null 2>&1 || true
start_inotifyd
