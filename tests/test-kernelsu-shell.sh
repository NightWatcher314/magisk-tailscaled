#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

KSU_BUSYBOX_URL='https://raw.githubusercontent.com/KernelSU-Next/KernelSU-Next/551ad80473f60e052917aec08abf5323b6ab2f7c/userspace/ksud/bin/x86_64/busybox'
KSU_BUSYBOX_SHA256='060844b0769f7a50262854af027c4d6076a212d160a51309b53057cfb7122900'
KSU_BUSYBOX_FILE="$TMP/busybox-bin"

if [ -n "${KSU_BUSYBOX:-}" ]; then
  cp "$KSU_BUSYBOX" "$KSU_BUSYBOX_FILE"
else
  curl --fail --silent --show-error --location --retry 3 --retry-all-errors \
    --connect-timeout 15 --max-time 120 "$KSU_BUSYBOX_URL" -o "$KSU_BUSYBOX_FILE"
fi
printf '%s  %s\n' "$KSU_BUSYBOX_SHA256" "$KSU_BUSYBOX_FILE" | sha256sum -c - >/dev/null
chmod +x "$KSU_BUSYBOX_FILE"

mkdir -p "$TMP/bin"
ln -s "$KSU_BUSYBOX_FILE" "$TMP/bin/sh"
ln -s "$KSU_BUSYBOX_FILE" "$TMP/bin/busybox"

for test_script in test-config.sh test-installer.sh test-watchdog.sh test-logs.sh; do
  ASH_STANDALONE=1 PATH="$TMP/bin:$PATH" "$ROOT/tests/$test_script"
done
