## v2.1.2.0

- Keep unsaved WebUI checkbox/text changes from being overwritten by the 10-second status refresh.
- Add an explicit unsaved/saved hint below Save config so it is clear when Save config or Apply / Up is still needed.

## v2.1.1.0

- Fix WebUI action buttons by invoking `/data/adb/tailscale/scripts/tailscaled.config` through an absolute path.
- Render login output URLs as clickable links.
- Add common `tailscale up` checkboxes and an exit-node selector populated from peers advertising `ExitNodeOption`.
- Save common options before Apply / Up so exit-node and checkbox settings are applied in one tap.

## v2.1.0.0

- Add KernelSU/APatch WebUI for status, login/up/down, daemon restart, runtime configuration, and recent logs.
- Add `/data/adb/tailscale/config.env` plus `tailscaled.config` for auditable configuration management.
- Generate pinned binary download manifests during build and verify SHA256 for lightweight installs.
- Remove insecure `--no-check-certificate` downloads and improve service path/log robustness.
- Align README with the current v2 daemon behavior and document known limitations.
- Make release builds independent of the host `zip` binary by using Python zipfile.

## v2.0.0.1

- 429e1b0 build: fix version bump and add pre-release for build version
- 75834b4 fix: path order

## v2.0.0.0

### ⚠️ Important Notice
This build may be unstable. Please test thoroughly and report any issues you encounter.

**Exit Node Warning**: Using exit nodes may cause battery drain. Not recommended for 24/7 use.

**Testing Your Connection**:
- Check IP: https://browserleaks.com/ip
- Check DNS leaks: https://browserleaks.com/dns

### Major Rewrite
This is a complete rewrite of the module with significant improvements.

### What's New
- **Better DNS handling** - Improved DNS configuration and compatibility
- **SSH support** - Enhanced SSH functionality
- **Exit node support** - Better exit node handling
- **Hotspot client support** - Works with Android hotspot clients
- **VPN compatibility** - Can now run alongside other VPN apps
- **Root & Non-root mode** - Works in both root and non-root environments

### Technical Changes
- Removed all wrapper scripts for better performance
- Now uses tailscaled binaries from [tailscale-android-cli](https://github.com/anasfanani/tailscale-android-cli)
- Simplified module structure
- Improved stability and reliability

### Breaking Changes
This is a major version update. Please backup your configuration before upgrading.
