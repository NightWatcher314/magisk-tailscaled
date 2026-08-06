# WebUI and Runtime Configuration

This fork adds a KernelSU/APatch style WebUI under `webroot/` and a small
runtime helper at `/data/adb/tailscale/scripts/tailscaled.config`.

## Configuration file

Runtime settings live in:

```text
/data/adb/tailscale/config.env
```

Supported keys:

- `TS_START_ON_BOOT` - `1` or `0`; controls service autostart.
- `TS_DAEMON_ARGS` - arguments for the `tailscaled` daemon.
- `TS_UP_ARGS` - default arguments for `tailscale up`.
- `TS_LOGIN_SERVER` - optional control/login server URL, for example a
  Headscale server. Blank uses the official Tailscale control plane.
- `TS_HOSTNAME` - optional `--hostname` value.
- `TS_ENABLE_SSH` - `1` adds `--ssh` to `tailscale up`.
- `TS_EXTRA_UP_ARGS` - extra advanced `tailscale up` arguments.
- `TS_WATCHDOG_ENABLED` - optional daemon crash recovery; default `0`.
- `TS_LOG_MAX_KB` - per-log rotation threshold, `128` to `10240` KB. Daemon
  and background-operation output passes through the same lightweight writer,
  so rotation continues while either command is running.

Use `tailscaled.config set KEY VALUE` or the WebUI instead of editing scripts.
The helper only accepts known keys and writes shell-quoted values. Use
`set-many` for one transactional write; advanced argument values reject shell
metacharacters because they are eventually expanded as Android command args.

## Commands

```sh
tailscaled.config get
tailscaled.config webui
tailscaled.config webui-log
tailscaled.config health
tailscaled.config peer-test 100.64.0.9
tailscaled.config netcheck
tailscaled.config set-many TS_START_ON_BOOT 1 TS_ENABLE_SSH 0 TS_HOSTNAME phone
tailscaled.config set TS_LOGIN_SERVER 'https://headscale.example.com'
tailscaled.config set TS_UP_ARGS '--accept-dns=false'
tailscaled.config up
tailscaled.config down
tailscaled.config restart
```

`webui` returns one structured JSON snapshot containing daemon/backend status,
runtime configuration, IP information, and recent logs. Background login/up
commands emit an operation ID so the WebUI can associate login URLs with the
current action instead of stale log entries. `webui-log` is a fast log-only
endpoint used by manual log refresh and login URL polling; it does not wait for
daemon status. When the daemon is stopped, `webui` skips the bounded status
command instead of blocking the Android bridge.

On managers that expose KernelSU's `spawn` API, shell work runs through that
non-blocking bridge so a slow bounded status query does not freeze WebUI taps or
animations. Older Android/KernelSU bridges remain supported as fallbacks.
The bridge, shell markers, timeouts, stderr handling, login polling, and command
quoting are isolated in the WebUI `RuntimeClient`.

Managed WebUI switches write explicit boolean values, and clearing the exit
node writes `--exit-node=`. This makes turning an option off deterministic while
preserving unrelated advanced `tailscale up` arguments.

The Peer list reuses fields already returned by `tailscale status --json`, so
showing names, IPs, online state, and the recently observed direct/DERP/Peer
Relay path adds no extra network probe. Latency is intentionally on demand:
`peer-test` sends five Tailscale-layer probes and displays path evolution, the
last path seen in that probe, average latency, timestamp, and stale state.
`netcheck` is also manual and uses `tailscale netcheck --format=json`; stderr
warnings remain separate from JSON output.

Automatic refresh uses one adaptive timer. Hidden pages and active diagnostics
do not refresh. Stable running state drops to a 30-second interval, and keyed
Peer cards remain the same DOM nodes when their displayed data does not change.

`health` reports only structured operational fields: module/CLI version,
daemon/backend/TUN, Tailscale health messages, SELinux mode, config validity,
watchdog state/count, and log sizes. The copied diagnostic report uses an
allowlist and excludes Peer names, IPs, endpoints, control-server values, raw
logs, state, keys, and certificates.

## Upgrade and watchdog behavior

Install stages downloads, SHA256 verification, extraction, and shell syntax
checks before moving live managed paths. Only `bin/`, `scripts/`, and
`settings.sh` are switched. Configuration and runtime state stay in place;
failure during the switch restores the prior managed paths and config copy.

Watchdog is default-off. When enabled it runs only while boot autostart is also
enabled, the module is active, and no manual-stop marker exists. Restart delays
increase through 5, 15, 30, 60, 120, and 300 seconds. After six consecutive
recovery attempts it stops instead of looping forever; a later manual start,
configuration save, module enable, or reboot evaluates watchdog startup again.
Successful restarts are counted in the runtime health report.

## Binary downloads

Release builds use fixed Tailscale/jq release tags and generate
`tailscale/binary-manifest.sh` with exact asset URLs and
SHA256 hashes for the Tailscale Android CLI and jq binaries. Lightweight installs
use that manifest and verify the downloaded files before extracting or installing
them. Full release zips include the binaries directly.
