#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
TAG="${1:-$(grep '^version=' module.prop | cut -d= -f2)}"
VERSION=$(grep '^version=' module.prop | cut -d= -f2)
CODE=$(grep '^versionCode=' module.prop | cut -d= -f2)
[ "$TAG" = "$VERSION" ] || { echo "tag $TAG != module.prop $VERSION" >&2; exit 1; }
[[ "$TAG" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || { echo "invalid version: $TAG" >&2; exit 1; }
EXPECTED=$(printf '%02d%02d%02d%02d' "$((10#${BASH_REMATCH[1]}))" "$((10#${BASH_REMATCH[2]}))" "$((10#${BASH_REMATCH[3]}))" "$((10#${BASH_REMATCH[4]}))")
[ "$CODE" = "$EXPECTED" ] || { echo "versionCode $CODE != $EXPECTED" >&2; exit 1; }
grep -Fx "## $TAG" CHANGELOG.md >/dev/null
for file in update.json update-arm.json update-arm64.json; do
  jq -e --arg tag "$TAG" --arg code "$CODE" '
    .version == $tag and .versionCode == $code and
    .zipUrl == ("https://github.com/NightWatcher314/magisk-tailscaled/releases/download/" + $tag + "/Magisk-Tailscaled-" + $tag + ".zip") and
    .changelog == "https://raw.githubusercontent.com/NightWatcher314/magisk-tailscaled/main/CHANGELOG.md"
  ' "$file" >/dev/null
done
