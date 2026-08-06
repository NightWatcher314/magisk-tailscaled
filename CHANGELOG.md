## v2.4.0.1

- Restore upgrades from the canonical v2.3.1 seven-key `config.env` by replacing the non-portable comment regex with shell parsing and filling new defaults during migration.
- Show a safe line-numbered validation reason in the module installer without echoing configuration values; retain rollback behavior for genuinely invalid files.

## v2.4.0.0

- Preserve and migrate existing runtime configuration during staged upgrades; pinned lightweight downloads now require both URL and SHA256 before live files change.
- Add optional watchdog crash recovery with manual-stop protection, six-attempt exponential backoff, restart counters, boot/disable lifecycle sync, and default-off behavior.
- Add continuously bounded daemon/operation log rotation, merged recent operation history, structured health checks, JSON Netcheck output, and safe configuration copy/import.
- Replace single-packet Peer tests with five-sample path evolution, last-probe path, average latency, timestamps, and stale-result detection.
- Split the WebUI runtime bridge into a tested `RuntimeClient`, add adaptive hidden-aware refresh, preserve keyed Peer DOM nodes, and keep stale data visible after refresh failures.
- Rework CI and Release into version-gated immutable Tag builds with exact lightweight/full assets, `SHA256SUMS`, and remote asset readback.

## v2.3.1.0

- Add a zero-extra-probe Peer list using the existing status snapshot: name, Tailscale IPs, OS, online/idle state, exit-node role, and the currently known direct/DERP/peer-relay path.
- Add an on-demand one-packet test per online Peer to report current latency and route without continuously pinging the tailnet.
- Add an on-demand Netcheck panel for UDP, IPv4/IPv6, port-mapping, captive-portal, and DERP latency diagnostics.
- Keep automatic status refresh paused while a diagnostic is running and safely validate Peer IP targets.

## v2.3.0.0

- Replace brittle marker parsing with a single structured `webui` runtime JSON endpoint.
- Fix the missing DOM element crash that prevented status, logs, and configuration from loading.
- Prefer KernelSU's non-blocking `spawn` API, keep legacy Android/exec compatibility, and disable actions until the first valid snapshot.
- Preserve unknown `tailscale up` arguments, legacy login-server values, SSH settings, and unavailable/unsaved exit-node selections.
- Canonicalize managed flags with explicit off/clear values so UI switches cannot be overridden by stale arguments.
- Add a fast log-only endpoint, skip status timeouts while stopped, remove the redundant IP command, and show the current login URL without blocking the action area.
- Track background operations by ID and exit marker so stale login URLs and silent background failures are distinguishable.
- Force a fresh snapshot after mutations to prevent old periodic refreshes from restoring stale configuration.
- Harden config validation and JSON encoding; remove dynamic `eval` assignment and shell-glob expansion.
- Upgrade the KernelSU WebUI library to 3.0.2 and clear current npm audit findings.
- Add DOM, config round-trip, asset, and ZIP-content release gates; pin binary release tags.

## v2.2.0.2

- Fix slow/empty initial status and log refresh by reducing the synchronous Android bridge to one bounded snapshot command.
- Show the login URL directly in the Quick actions output box when it appears.

## v2.2.0.1

- Fix release packaging so the KernelSU/APatch `webroot/` is included in the module ZIP and the WebUI button is visible again.

## v2.2.0.0

- Refresh WebUI less often, prevent overlapping refreshes, pause while hidden, and add explicit loading/success/error feedback for actions.
- Replace the form layout with a mobile-first status dashboard, sticky save bar, accessible switches, safe-area support, focus states, and reduced-motion support.
- Batch configuration writes, report save failures, separate daemon/backend status, and reject shell metacharacters in advanced arguments.
- Upgrade the bundled Android CLI assets to v1.98.8-android.

## v2.1.4.0

- e9370e4 Fix WebUI Headscale login hangs

## v2.1.3.0

- Add a WebUI/runtime control server URL setting backed by `TS_LOGIN_SERVER`,
  so login and apply/up can target Headscale-compatible servers with
  `--login-server`.

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
