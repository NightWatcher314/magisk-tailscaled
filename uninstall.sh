#!/system/bin/sh
watchdog_pid=$(cat /data/adb/tailscale/run/watchdog.pid 2>/dev/null || true)
if [ -n "$watchdog_pid" ] && [ -r "/proc/$watchdog_pid/cmdline" ] && tr '\000' ' ' <"/proc/$watchdog_pid/cmdline" | grep -q tailscaled.watchdog; then
    kill "$watchdog_pid" 2>/dev/null || true
fi
if [ -x /data/adb/tailscale/scripts/tailscaled.service ]; then
    /data/adb/tailscale/scripts/tailscaled.service stop >/dev/null 2>&1 || true
fi
for PID in $(busybox pidof inotifyd 2>/dev/null); do
    if grep -q "tailscaled.inotify" "/proc/$PID/cmdline" 2>/dev/null; then
        kill "$PID" 2>/dev/null || true
    fi
done
rm -rf /data/adb/tailscale
SERVICE_DIR="/data/adb/service.d"
if [ -f "$SERVICE_DIR/tailscaled_service.sh" ]; then
    rm -f "$SERVICE_DIR/tailscaled_service.sh"
fi
