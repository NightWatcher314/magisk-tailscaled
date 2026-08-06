#!/system/bin/sh

# DEBUG=1
if [ -n "${DEBUG:-}" ]; then
	PS4="+ \${0##*/}:\${LINENO}: "
	set -e
	set -u
	set -x
	set
fi

# Github download helper
verify_sha256() {
	FILE=$1
	EXPECTED=$2
	[ -n "$EXPECTED" ] || { ui_print "! Missing required SHA256 for $(basename "$FILE")"; return 1; }
	if command -v sha256sum >/dev/null 2>&1; then
		ACTUAL=$(sha256sum "$FILE" | awk '{print $1}')
	elif command -v busybox >/dev/null 2>&1 && busybox sha256sum "$FILE" >/dev/null 2>&1; then
		ACTUAL=$(busybox sha256sum "$FILE" | awk '{print $1}')
	else
		ui_print "! sha256sum not available; refusing unverified binary download"
		return 1
	fi
	[ "$ACTUAL" = "$EXPECTED" ] || { ui_print "! SHA256 mismatch for $(basename "$FILE")"; ui_print "! expected: $EXPECTED"; ui_print "! actual:   $ACTUAL"; return 1; }
}

manifest_lookup() {
	KEY=$1
	[ -f "$MODPATH/tailscale/binary-manifest.sh" ] || return 1
	# shellcheck source=/dev/null
	. "$MODPATH/tailscale/binary-manifest.sh"
	eval "printf %s \"\${$KEY:-}\""
}

print_config_validation_error() {
	ERROR_FILE=$1
	VALIDATION_REASON=$(sed -n '1p' "$ERROR_FILE" 2>/dev/null | tr -d '\r\n')
	case "$VALIDATION_REASON" in
		"Config helper "*|"Invalid config line "*|TS_START_ON_BOOT*|TS_ENABLE_SSH*|TS_WATCHDOG_ENABLED*|TS_LOG_MAX_KB*|TS_LOGIN_SERVER*|TS_HOSTNAME*|"Unsafe shell characters in argument value"|"Newlines are not allowed in argument values"|"Control characters are not allowed in argument values"|"Shell glob characters are not allowed in argument values")
			ui_print "! Config validation: $VALIDATION_REASON"
		;;
		*)
			ui_print "! Config validation: parser failed before migration; configuration values were not changed"
		;;
	esac
}

# Github download helper; requires pinned manifest URLs and SHA256.
gh_download() {
	MANIFEST_PREFIX=${1:-}
	DOWNLOAD_URL=""
	EXPECTED_SHA=""
	if [ -n "$MANIFEST_PREFIX" ]; then
		DOWNLOAD_URL=$(manifest_lookup "${MANIFEST_PREFIX}_URL" || true)
		EXPECTED_SHA=$(manifest_lookup "${MANIFEST_PREFIX}_SHA256" || true)
	fi
	if [ -z "$DOWNLOAD_URL" ] || [ -z "$EXPECTED_SHA" ]; then
		ui_print "! Missing pinned URL or SHA256 for $MANIFEST_PREFIX"
		return 1
	fi
	FILENAME=$(basename "$DOWNLOAD_URL")
	ui_print "- Downloading $FILENAME..."
	wget --timeout=100 -qO "$TMPDIR/$FILENAME" "$DOWNLOAD_URL" || {
		ui_print "! Download timeout or failed"
		return 1
	}
	verify_sha256 "$TMPDIR/$FILENAME" "$EXPECTED_SHA" || return 1
}

# shellcheck disable=SC2034
SKIPUNZIP=1
# shellcheck disable=SC2034
SKIPMOUNT=false

if [ "$BOOTMODE" != true ]; then
	ui_print "! Please install in Magisk Manager or KernelSU Manager"
	ui_print "! Install from recovery is NOT supported"
	abort "-----------------------------------------------------------"
elif [ "${KSU:-false}" = true ] && [ "${KSU_VER_CODE:-0}" -lt 10670 ]; then
	abort "error: Please update your KernelSU and KernelSU Manager"
fi

SERVICE_DIR="/data/adb/service.d"

TS_DIR="/data/adb/tailscale"
TS_BIN_DIR="$TS_DIR/bin"
TS_SCRIPTS_DIR="$TS_DIR/scripts"

case $ARCH in
arm|arm64) ;;
*)
	ui_print "Unsupported architecture: $ARCH"
	abort
	;;
esac
ui_print "- Detected architecture: $ARCH"

STAGE_TS_DIR="$TMPDIR/tailscale-stage"
STAGE_BIN_DIR="$STAGE_TS_DIR/bin"
STAGE_SCRIPTS_DIR="$STAGE_TS_DIR/scripts"
mkdir -p "$STAGE_BIN_DIR" "$STAGE_SCRIPTS_DIR" "$MODPATH/tailscale"
unzip -qqo "$ZIPFILE" 'tailscale/binary-manifest.sh' -d "$MODPATH" 2>/dev/null || true
unzip -qqjo "$ZIPFILE" "tailscale/bin/*-$ARCH" -d "$STAGE_BIN_DIR" 2>/dev/null || true
for f in "$STAGE_BIN_DIR"/*-"$ARCH"; do
	[ -f "$f" ] && mv "$f" "${f%-"$ARCH"}"
done

[ -f "$STAGE_BIN_DIR/tailscaled" ] || {
	gh_download "TAILSCALE_${ARCH}" || abort "error: Unable to download."
	tar -xzf "$TMPDIR/$FILENAME" -C "$STAGE_BIN_DIR" tailscaled || abort "error: Unable extract archive."
}

[ -f "$STAGE_BIN_DIR/jq" ] || {
	gh_download "JQ_${ARCH}" || abort "error: Unable to download."
	mv -f "$TMPDIR/$FILENAME" "$STAGE_BIN_DIR/jq" || abort "error: Unable to move file."
}

for binary in "$STAGE_BIN_DIR/tailscaled" "$STAGE_BIN_DIR/jq"; do
	[ -s "$binary" ] || abort "error: Missing staged binary $(basename "$binary")"
done
unzip -qqjo "$ZIPFILE" 'tailscale/scripts/*' -d "$STAGE_SCRIPTS_DIR" || abort "error: Unable to stage runtime scripts"
unzip -qqjo "$ZIPFILE" 'tailscale/settings.sh' -d "$STAGE_TS_DIR" || abort "error: Unable to stage settings"
for script in "$STAGE_SCRIPTS_DIR"/* "$STAGE_TS_DIR/settings.sh"; do
	sh -n "$script" || abort "error: Invalid packaged shell script $(basename "$script")"
done

versionCode=none
BACKUP_DIR="$TMPDIR/tailscale-empty-backup"
mkdir -p "$BACKUP_DIR"
had_existing_runtime=0
daemon_was_running=0
manual_stop_was_set=0
if [ -d "$TS_DIR" ]; then
	[ -e "$TS_DIR/settings.sh" ] && had_existing_runtime=1
	busybox pgrep -x tailscaled >/dev/null 2>&1 && daemon_was_running=1
	[ -f "$TS_DIR/run/manual-stop" ] && manual_stop_was_set=1
	[ -f "$TS_DIR/tmp/tailscaled.state" ] && mv -f "$TS_DIR/tmp/tailscaled.state" "$TS_DIR/tailscaled.state"
	PROP_FILE="$(echo "$MODPATH" | sed 's/_update//')/module.prop"
	[ ! -f "$PROP_FILE" ] && PROP_FILE="$MODPATH/module.prop"
	versionCode=$(grep '^versionCode=' "$PROP_FILE" | cut -d= -f2)
	[ -n "$versionCode" ] || versionCode=unknown
	if [ -f "$TS_DIR/config.env" ]; then
		LIVE_CONFIG_FILE="$TS_DIR/config.env"
		CONFIG_VALIDATION_ERROR="$TMPDIR/config-validation.error"
		if ! TS_DIR="$TS_DIR" TS_BIN_DIR="$STAGE_BIN_DIR" TS_CONFIG_FILE="$LIVE_CONFIG_FILE" TS_MOD_DIR="$MODPATH" TS_SCRIPTS_DIR="$STAGE_SCRIPTS_DIR" \
			sh "$STAGE_SCRIPTS_DIR/tailscaled.config" validate >/dev/null 2>"$CONFIG_VALIDATION_ERROR"; then
			print_config_validation_error "$CONFIG_VALIDATION_ERROR"
			abort "error: Existing config.env is invalid; live installation was not changed"
		fi
	fi
	ui_print "- Backup old files"
	# shellcheck source=tailscale/scripts/install.lib.sh
	. "$STAGE_SCRIPTS_DIR/install.lib.sh"
	BACKUP_DIR="$TS_DIR/backups/$versionCode"
	rm -rf "$BACKUP_DIR"
fi

ui_print "- Extracting files..."
unzip -qqo "$ZIPFILE" -x 'META-INF/*' 'tailscale/*' -d "$MODPATH" || abort "error: Unable to extract module files"

if [ ! -f "$STAGE_SCRIPTS_DIR/install.lib.sh" ]; then
	abort "error: Missing installer transaction helper"
fi
# shellcheck source=tailscale/scripts/install.lib.sh
. "$STAGE_SCRIPTS_DIR/install.lib.sh"
install_committed=0
runtime_switch_started=0
rollback_install() {
	code=$?
	trap - EXIT HUP INT TERM
	if [ "$install_committed" -ne 1 ] && [ "$runtime_switch_started" -eq 1 ]; then
		ui_print "! Runtime switch failed; restoring previous files"
		restore_runtime_data "$TS_DIR" "$BACKUP_DIR" || true
		if [ "$manual_stop_was_set" -eq 1 ]; then
			mkdir -p "$TS_DIR/run"
			: >"$TS_DIR/run/manual-stop"
		elif [ "$daemon_was_running" -eq 1 ] && [ -x "$TS_DIR/scripts/tailscaled.service" ]; then
			"$TS_DIR/scripts/tailscaled.service" start >/dev/null 2>&1 || true
		fi
		if [ -x "$TS_DIR/scripts/tailscaled.config" ]; then
			"$TS_DIR/scripts/tailscaled.config" watchdog-sync >/dev/null 2>&1 || true
		fi
	fi
	exit "$code"
}
trap rollback_install EXIT HUP INT TERM

mkdir -p "$TS_DIR" "$SERVICE_DIR" "$MODPATH/system/bin/"
stop_watchdog "$TS_DIR"
runtime_switch_started=1
backup_runtime_data "$TS_DIR" "$BACKUP_DIR"
install_staged_runtime "$STAGE_TS_DIR" "$TS_DIR" || abort "error: Unable to install staged runtime"
if [ -f "$TS_DIR/config.env" ]; then
	CONFIG_VALIDATION_ERROR="$TMPDIR/config-validation.error"
	if ! sh "$TS_SCRIPTS_DIR/tailscaled.config" migrate >/dev/null 2>"$CONFIG_VALIDATION_ERROR"; then
		print_config_validation_error "$CONFIG_VALIDATION_ERROR"
		abort "error: Existing config.env is invalid; previous runtime restored"
	fi
else
	sh "$TS_SCRIPTS_DIR/tailscaled.config" init 2>/dev/null || abort "error: Unable to initialize config.env"
fi
ln -sf "$TS_BIN_DIR/tailscaled" "$TS_BIN_DIR/tailscale"
ln -sf "$TS_BIN_DIR/"* "$MODPATH/system/bin/"

ln -sf "$TS_SCRIPTS_DIR/tailscaled.service" "$MODPATH/system/bin/"

ui_print "- Setting permissions"
set_perm_recursive "$TS_BIN_DIR/" 0 0 0755 0755 "u:object_r:system_file:s0"
set_perm_recursive "$TS_SCRIPTS_DIR/" 0 0 0755 0755 "u:object_r:system_file:s0"
set_perm_recursive "$MODPATH/system/bin/" 0 0 0755 0755 "u:object_r:system_file:s0"
set_perm "$MODPATH/service.sh" 0 0 0755 "u:object_r:system_file:s0"
install_committed=1
trap - EXIT HUP INT TERM

if [ ! -f "$SERVICE_DIR/tailscaled_service.sh" ]; then
	# offer to move module scripts to general scripts
	ui_print "-----------------------------------------------------------"
	ui_print "- Do you want to move Module Scripts to General Scripts ?"
	ui_print "- This option allows you to toggle the 'tailscaled' service"
	ui_print "  on or off by enabling or disabling modules."
	ui_print "- Your service directory is :"
	ui_print "  '$SERVICE_DIR'."
	ui_print "- Because the Developer Guides mentioned :"
	ui_print "  Modules should NOT add general scripts during installation."
	ui_print "- I offer this option to you."
	ui_print "- You have 10 seconds to make a selection. Default is [Yes]."
	ui_print "- [ Vol UP(+): Yes ]"
	ui_print "- [ Vol DOWN(-): No ]"
	timeout 10 sh -c '
  while true; do
    if getevent -lc 1 2>&1 | grep -q KEY_VOLUMEUP; then
      echo "up"
      break
    elif getevent -lc 1 2>&1 | grep -q KEY_VOLUMEDOWN; then
      echo "down"
      break
    fi
  done
' >"$TMPDIR/choice" || true

	choice=$(cat "$TMPDIR/choice" 2>/dev/null)
	if [ "$choice" = "up" ] || [ -z "$choice" ]; then
		ui_print "- [Yes] Move Module Scripts to General Scripts."
		mv -f "$MODPATH/service.sh" "$SERVICE_DIR/tailscaled_service.sh"
	else
		ui_print "- [No] Skip and keep using Module Scripts."
	fi
else
	ui_print "- Move General Scripts."
	mv -f "$MODPATH/service.sh" "$SERVICE_DIR/tailscaled_service.sh"
fi
if [ "$had_existing_runtime" -eq 0 ] || [ "$daemon_was_running" -eq 1 ]; then
	ui_print "- Starting service in background."
	${TS_SCRIPTS_DIR}/start.sh postinstall 2>&1 &
else
	[ "$manual_stop_was_set" -eq 1 ] && : >"$TS_DIR/run/manual-stop"
	${TS_SCRIPTS_DIR}/tailscaled.config watchdog-sync >/dev/null 2>&1 || true
fi
if [ ! -f "/system/bin/tailscale" ] || ! cmp --silent "/system/bin/tailscale" "$MODPATH/system/bin/tailscale"; then
	ui_print "- Link file to /dev/."
	ln -sf "$TS_SCRIPTS_DIR/tailscaled.service" /dev/tailscaled.service
	ln -sf "$TS_BIN_DIR/tailscaled" /dev/tailscaled
	ln -sf "$TS_BIN_DIR/tailscaled" /dev/tailscale
	ui_print "-----------------------------------------------------------"
	ui_print " Instructions       "
	ui_print "-----------------------------------------------------------"
	ui_print "- If you not reboot, execute with /dev/tailscale or /dev/tailscaled.service."
	ui_print "- After reboot, you can use tailscale and tailscaled.service directly."
	if [ ! -f "$TS_DIR/tailscaled.state" ]; then
		ui_print "- Quickstart to new user :"
		ui_print "  su -c '/dev/tailscale login'"
		ui_print "  su -c '/dev/tailscaled.service status'"
		ui_print "- Read the README.md"
	else
		ui_print "- Tailscaled service manager :"
		ui_print "  su -c '/dev/tailscaled.service'"
	fi
else
	if [ ! -f "$TS_DIR/tailscaled.state" ]; then
		ui_print "- Quickstart to login :"
		ui_print "  su -c 'tailscale login'"
		ui_print "  su -c 'tailscaled.service status'"
		ui_print "- Read the README.md"
	else
		ui_print "- Tailscaled service manager :"
		ui_print "  su -c 'tailscaled.service'"
	fi
fi
if [ -n "${DEBUG:-}" ]; then
	set +u
	set +e
fi
