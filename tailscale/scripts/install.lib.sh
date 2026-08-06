#!/system/bin/sh

# Runtime state is intentionally not moved. Only module-managed executable
# files participate in the upgrade transaction.
backup_runtime_data() {
  runtime_dir="$1"
  backup_dir="$2"
  mkdir -p "$backup_dir"
  for name in bin scripts settings.sh; do
    [ -e "$runtime_dir/$name" ] && mv -f "$runtime_dir/$name" "$backup_dir/$name"
  done
  [ -f "$runtime_dir/config.env" ] && cp -pf "$runtime_dir/config.env" "$backup_dir/config.env"
}

install_staged_runtime() {
  stage_dir="$1"
  runtime_dir="$2"
  mkdir -p "$runtime_dir/bin" "$runtime_dir/scripts"
  cp -pf "$stage_dir/bin/"* "$runtime_dir/bin/"
  cp -pf "$stage_dir/scripts/"* "$runtime_dir/scripts/"
  cp -pf "$stage_dir/settings.sh" "$runtime_dir/settings.sh"
}

restore_runtime_data() {
  runtime_dir="$1"
  backup_dir="$2"
  [ -n "$runtime_dir" ] || return 1
  rm -rf "${runtime_dir:?}/bin" "$runtime_dir/scripts" "$runtime_dir/settings.sh"
  for name in bin scripts settings.sh; do
    [ -e "$backup_dir/$name" ] && mv -f "$backup_dir/$name" "$runtime_dir/$name"
  done
  if [ -f "$backup_dir/config.env" ]; then
    cp -pf "$backup_dir/config.env" "$runtime_dir/config.env"
  else
    rm -f "$runtime_dir/config.env"
  fi
}

is_watchdog_pid() {
  pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  [ -r "/proc/$pid/cmdline" ] || return 1
  tr '\000' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -q 'tailscaled.watchdog'
}

stop_watchdog() {
  runtime_dir="$1"
  pid_file="$runtime_dir/run/watchdog.pid"
  pid=$(cat "$pid_file" 2>/dev/null || true)
  if is_watchdog_pid "$pid"; then
    kill "$pid" 2>/dev/null || true
    wait_count=0
    while is_watchdog_pid "$pid" && [ "$wait_count" -lt 20 ]; do
      sleep 0.1
      wait_count=$((wait_count + 1))
    done
  fi
  rm -f "$pid_file"
}
