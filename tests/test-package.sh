#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
TAG="${1:-$(grep '^version=' module.prop | cut -d= -f2)}"
LIGHT="dist/Magisk-Tailscaled-${TAG}.zip"
FULL="dist/Magisk-Tailscaled-${TAG}-full.zip"
for file in "$LIGHT" "$FULL" dist/SHA256SUMS; do [ -s "$file" ] || { echo "missing $file" >&2; exit 1; }; done
(cd dist && sha256sum -c SHA256SUMS)
for archive in "$LIGHT" "$FULL"; do
  unzip -tq "$archive" >/dev/null
  [ "$(unzip -p "$archive" module.prop | sed -n 's/^version=//p')" = "$TAG" ]
  for path in customize.sh tailscale/settings.sh tailscale/scripts/install.lib.sh tailscale/scripts/tailscaled.watchdog tailscale/scripts/tailscaled.logwriter webroot/index.html; do
    unzip -Z1 "$archive" | grep -Fx "$path" >/dev/null
  done
  if unzip -Z1 "$archive" | grep -Eq '^(browser-qa|tests|webui|\.github)/'; then
    echo "$archive contains development files" >&2
    exit 1
  fi
done
if unzip -Z1 "$LIGHT" | grep -q '^tailscale/bin/'; then
  echo "light package contains binaries" >&2
  exit 1
fi
for path in tailscale/bin/tailscaled-arm tailscale/bin/tailscaled-arm64 tailscale/bin/jq-arm tailscale/bin/jq-arm64; do
  unzip -Z1 "$FULL" | grep -Fx "$path" >/dev/null
done
for key in TAILSCALE_arm_URL TAILSCALE_arm_SHA256 TAILSCALE_arm64_URL TAILSCALE_arm64_SHA256 JQ_arm_URL JQ_arm_SHA256 JQ_arm64_URL JQ_arm64_SHA256; do
  unzip -p "$LIGHT" tailscale/binary-manifest.sh | grep -q "^${key}='[^']\+'$"
done
