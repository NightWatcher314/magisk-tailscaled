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

Use `tailscaled.config set KEY VALUE` or the WebUI instead of editing scripts.
The helper only accepts known keys and writes shell-quoted values. Use
`set-many` for one transactional write; advanced argument values reject shell
metacharacters because they are eventually expanded as Android command args.

## Commands

```sh
tailscaled.config get
tailscaled.config webui
tailscaled.config webui-log
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

Managed WebUI switches write explicit boolean values, and clearing the exit
node writes `--exit-node=`. This makes turning an option off deterministic while
preserving unrelated advanced `tailscale up` arguments.

## Binary downloads

Release builds use fixed Tailscale/jq release tags and generate
`tailscale/binary-manifest.sh` with exact asset URLs and
SHA256 hashes for the Tailscale Android CLI and jq binaries. Lightweight installs
use that manifest and verify the downloaded files before extracting or installing
them. Full release zips include the binaries directly.
