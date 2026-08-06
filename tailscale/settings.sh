#!/system/bin/sh
set -e

# Runtime paths. Keep defaults Android-root friendly, but allow overrides for tests.
TS_MODULE_ID="${TS_MODULE_ID:-magisk-tailscaled}"
if [ -z "${TS_MOD_DIR:-}" ]; then
  if [ -d "/data/adb/modules/${TS_MODULE_ID}" ]; then
    TS_MOD_DIR="/data/adb/modules/${TS_MODULE_ID}"
  elif [ -d "/data/adb/modules_update/${TS_MODULE_ID}" ]; then
    TS_MOD_DIR="/data/adb/modules_update/${TS_MODULE_ID}"
  else
    TS_MOD_DIR="/data/adb/modules/${TS_MODULE_ID}"
  fi
fi
export TS_MOD_DIR
export TS_MOD_PROP="${TS_MOD_DIR}/module.prop"

TS_DIR="${TS_DIR:-/data/adb/tailscale}"
TS_BIN_DIR="${TS_BIN_DIR:-${TS_DIR}/bin}"
TS_SCRIPTS_DIR="${TS_SCRIPTS_DIR:-${TS_DIR}/scripts}"
TS_RUN_DIR="${TS_RUN_DIR:-${TS_DIR}/run}"
TS_STATE_DIR="${TS_STATE_DIR:-${TS_DIR}/state}"
TS_CONFIG_FILE="${TS_CONFIG_FILE:-${TS_DIR}/config.env}"
TS_LOG_FILE="${TS_LOG_FILE:-${TS_RUN_DIR}/tailscaled.log}"
TS_RUN_LOG_FILE="${TS_RUN_LOG_FILE:-${TS_RUN_DIR}/runs.log}"
export TS_DIR TS_BIN_DIR TS_SCRIPTS_DIR TS_RUN_DIR TS_STATE_DIR TS_CONFIG_FILE TS_LOG_FILE TS_RUN_LOG_FILE

mkdir -p "${TS_RUN_DIR}" "${TS_STATE_DIR}" 2>/dev/null || true

# Defaults are intentionally conservative and editable through tailscaled.config/WebUI.
TS_START_ON_BOOT="${TS_START_ON_BOOT:-1}"
TS_DAEMON_ARGS="${TS_DAEMON_ARGS:--no-logs-no-support}"
TS_UP_ARGS="${TS_UP_ARGS:---accept-dns=false}"
TS_LOGIN_SERVER="${TS_LOGIN_SERVER:-}"
TS_HOSTNAME="${TS_HOSTNAME:-}"
TS_ENABLE_SSH="${TS_ENABLE_SSH:-0}"
TS_EXTRA_UP_ARGS="${TS_EXTRA_UP_ARGS:-}"
TS_WATCHDOG_ENABLED="${TS_WATCHDOG_ENABLED:-0}"
TS_LOG_MAX_KB="${TS_LOG_MAX_KB:-1024}"

load_runtime_config() {
  config_file="$1"
  [ -f "$config_file" ] || return 0
  seen_keys=" "
  line_number=0
  while IFS= read -r config_line || [ -n "$config_line" ]; do
    line_number=$((line_number + 1))
    if printf '%s\n' "$config_line" | grep -q '^[[:space:]]*\(#.*\)\?$'; then
      continue
    fi
    case "$config_line" in
      *=*) ;;
      *) echo "Invalid config line ${line_number}: expected KEY='VALUE'" >&2; return 1 ;;
    esac
    config_key=${config_line%%=*}
    config_raw=${config_line#*=}
    case "$config_key" in
      TS_START_ON_BOOT|TS_DAEMON_ARGS|TS_UP_ARGS|TS_LOGIN_SERVER|TS_HOSTNAME|TS_ENABLE_SSH|TS_EXTRA_UP_ARGS|TS_WATCHDOG_ENABLED|TS_LOG_MAX_KB) ;;
      *) echo "Invalid config line ${line_number}: unsupported key ${config_key}" >&2; return 1 ;;
    esac
    case "$seen_keys" in
      *" ${config_key} "*) echo "Invalid config line ${line_number}: duplicate key ${config_key}" >&2; return 1 ;;
    esac
    seen_keys="${seen_keys}${config_key} "
    case "$config_raw" in
      \'*\')
        config_value=${config_raw#\'}
        config_value=${config_value%\'}
      ;;
      *) echo "Invalid config line ${line_number}: ${config_key} must use single quotes" >&2; return 1 ;;
    esac
    case "$config_value" in
      *"'"*) echo "Invalid config line ${line_number}: quotes inside ${config_key} are not supported" >&2; return 1 ;;
    esac
    if printf '%s' "$config_value" | LC_ALL=C grep -q '[[:cntrl:]]'; then
      echo "Invalid config line ${line_number}: control characters are not allowed" >&2
      return 1
    fi
    case "$config_key" in
      TS_START_ON_BOOT) TS_START_ON_BOOT="$config_value" ;;
      TS_DAEMON_ARGS) TS_DAEMON_ARGS="$config_value" ;;
      TS_UP_ARGS) TS_UP_ARGS="$config_value" ;;
      TS_LOGIN_SERVER) TS_LOGIN_SERVER="$config_value" ;;
      TS_HOSTNAME) TS_HOSTNAME="$config_value" ;;
      TS_ENABLE_SSH) TS_ENABLE_SSH="$config_value" ;;
      TS_EXTRA_UP_ARGS) TS_EXTRA_UP_ARGS="$config_value" ;;
      TS_WATCHDOG_ENABLED) TS_WATCHDOG_ENABLED="$config_value" ;;
      TS_LOG_MAX_KB) TS_LOG_MAX_KB="$config_value" ;;
    esac
  done <"$config_file"
}

# Parse only the generated KEY='VALUE' format. Never execute config.env.
load_runtime_config "${TS_CONFIG_FILE}"

export PATH="${TS_BIN_DIR}:${TS_SCRIPTS_DIR}:/data/adb/magisk:/data/adb/ksu/bin:$PATH:/system/bin:${TS_MOD_DIR}/system/bin"
export HOME="${TS_DIR}"
export TS_START_ON_BOOT TS_DAEMON_ARGS TS_UP_ARGS TS_LOGIN_SERVER TS_HOSTNAME TS_ENABLE_SSH TS_EXTRA_UP_ARGS TS_WATCHDOG_ENABLED TS_LOG_MAX_KB
export TS_DAEMON_CMD="tailscaled ${TS_DAEMON_ARGS}"

normal="\033[0m"; orange="\033[1;38;5;208m"; red="\033[1;31m"; green="\033[1;32m"; yellow="\033[1;33m"; blue="\033[1;34m"

log() {
  case ${1:-} in
    Info) color="${blue}" ;; Success) color="${green}" ;; Error) color="${red}" ;;
    Warning) color="${yellow}" ;; Debug) color="${orange}" ;; *) color="${normal}" ;;
  esac
  message="$(date +"%I:%M %P") [${1:-Debug}]: ${2:-}"
  if [ -t 1 ]; then
    echo "${color}${message}${normal}"
  fi
  mkdir -p "${TS_RUN_DIR}" 2>/dev/null || true
  rotate_log "${TS_RUN_LOG_FILE}"
  echo "${message}" >>"${TS_RUN_LOG_FILE}" 2>/dev/null || true
}

rotate_log() {
  file="$1"
  mode="${2:-rename}"
  [ -f "$file" ] || return 0
  max_kb="${TS_LOG_MAX_KB:-1024}"
  case "$max_kb" in ''|*[!0-9]*) max_kb=1024;; esac
  bytes=$(wc -c <"$file" 2>/dev/null || echo 0)
  [ "$bytes" -ge "$((max_kb * 1024))" ] || return 0
  (
    lock="${file}.rotate.lock"
    mkdir "$lock" 2>/dev/null || exit 0
    trap 'rmdir "$lock" 2>/dev/null || true' EXIT HUP INT TERM
    rm -f "${file}.3" || exit 0
    [ ! -f "${file}.2" ] || mv -f "${file}.2" "${file}.3" || exit 0
    [ ! -f "${file}.1" ] || mv -f "${file}.1" "${file}.2" || exit 0
    if [ "$mode" = copytruncate ]; then
      cp -pf "$file" "${file}.1" && : >"$file"
    else
      mv -f "$file" "${file}.1"
    fi
  ) || true
}

[ -n "${DEBUG:-}" ] && set -u && set -x && PS4='+ ${0##*/}:${LINENO}: ' || true
