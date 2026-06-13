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
TS_HOSTNAME="${TS_HOSTNAME:-}"
TS_ENABLE_SSH="${TS_ENABLE_SSH:-0}"
TS_EXTRA_UP_ARGS="${TS_EXTRA_UP_ARGS:-}"

# shellcheck source=/dev/null
[ -f "${TS_CONFIG_FILE}" ] && . "${TS_CONFIG_FILE}"

export PATH="${TS_BIN_DIR}:${TS_SCRIPTS_DIR}:/data/adb/magisk:/data/adb/ksu/bin:$PATH:/system/bin:${TS_MOD_DIR}/system/bin"
export HOME="${TS_DIR}"
export TS_START_ON_BOOT TS_DAEMON_ARGS TS_UP_ARGS TS_HOSTNAME TS_ENABLE_SSH TS_EXTRA_UP_ARGS
export TS_DAEMON_CMD="tailscaled ${TS_DAEMON_ARGS}"

CURRENT_TIME=$(date +"%I:%M %P")
normal="\033[0m"; orange="\033[1;38;5;208m"; red="\033[1;31m"; green="\033[1;32m"; yellow="\033[1;33m"; blue="\033[1;34m"

log() {
  case ${1:-} in
    Info) color="${blue}" ;; Success) color="${green}" ;; Error) color="${red}" ;;
    Warning) color="${yellow}" ;; Debug) color="${orange}" ;; *) color="${normal}" ;;
  esac
  message="${CURRENT_TIME} [${1:-Debug}]: ${2:-}"
  if [ -t 1 ]; then
    echo "${color}${message}${normal}"
  fi
  mkdir -p "${TS_RUN_DIR}" 2>/dev/null || true
  echo "${message}" >>"${TS_RUN_LOG_FILE}" 2>/dev/null || true
}

[ -n "${DEBUG:-}" ] && set -u && set -x && PS4='+ ${0##*/}:${LINENO}: ' || true
