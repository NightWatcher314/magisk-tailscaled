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
- `TS_HOSTNAME` - optional `--hostname` value.
- `TS_ENABLE_SSH` - `1` adds `--ssh` to `tailscale up`.
- `TS_EXTRA_UP_ARGS` - extra advanced `tailscale up` arguments.

Use `tailscaled.config set KEY VALUE` or the WebUI instead of editing scripts.
The helper only accepts known keys and writes shell-quoted values.

## Commands

```sh
tailscaled.config get
tailscaled.config set TS_UP_ARGS '--accept-dns=false'
tailscaled.config up
tailscaled.config down
tailscaled.config restart
```

## Binary downloads

Release builds generate `tailscale/binary-manifest.sh` with exact asset URLs and
SHA256 hashes for the Tailscale Android CLI and jq binaries. Lightweight installs
use that manifest and verify the downloaded files before extracting or installing
them. Full release zips include the binaries directly.
