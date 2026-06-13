# Magisk Tailscaled

Magisk/KernelSU module for running the Tailscale daemon on rooted Android. This
fork keeps the original module shape, adds a WebUI for configuration, and hardens
release/install behavior for root devices.

## Why use this instead of the Play Store app?

The official Android app uses Android's VPN slot. Running `tailscaled` as a root
module can be useful when you need Tailscale while another Android VPN is active.
This is still an advanced/root setup, not a drop-in replacement for the official
app.

## Install

1. Download either release asset:
   - `Magisk-Tailscaled-<version>.zip` - lightweight, downloads pinned binaries on install and verifies SHA256.
   - `Magisk-Tailscaled-<version>-full.zip` - includes binaries, useful offline.
2. Install from Magisk/KernelSU/APatch manager and reboot.
3. Login:

```sh
su -c tailscale login
# or through the WebUI: Login -> open the printed URL
```

4. Recommended default for Android DNS compatibility:

```sh
su -c 'tailscale set --accept-dns=false'
```

## WebUI

KernelSU/APatch users can open the module WebUI to:

- View daemon/backend status, Tailscale IPs, peer counts, and recent logs.
- Run login, up/apply, down, and daemon restart.
- Configure boot autostart, hostname, Tailscale SSH, `tailscale up` args, extra
  advanced up args, and daemon args.

The WebUI writes `/data/adb/tailscale/config.env` through `tailscaled.config`.
It does not accept arbitrary config keys.

## CLI helpers

```sh
su -c tailscaled.service status
su -c tailscaled.service restart
su -c tailscaled.service log daemon
su -c tailscaled.config get
su -c "tailscaled.config set TS_UP_ARGS '--accept-dns=false'"
su -c tailscaled.config up
```

## Runtime behavior

Current default daemon command:

```sh
tailscaled -no-logs-no-support
```

You can change daemon args with:

```sh
su -c "tailscaled.config set TS_DAEMON_ARGS '-no-logs-no-support'"
su -c tailscaled.config restart
```

## Known limitations

- Only `arm` and `arm64` are packaged by default.
- Tailscale's Linux daemon is not an Android-native app; some features can be
  device/ROM/kernel dependent.
- MagicDNS, Headscale DNS, IPv6, exit nodes, subnet routes, and captive portals
  may require manual tuning and are not guaranteed on every Android build.
- Root modules are high-trust software. Prefer the full zip or verify release
  artifacts if you do not want install-time network downloads.

## Troubleshooting

```sh
su -c tailscaled.service restart
su -c tailscale status
su -c tailscaled.service log daemon
cat /data/adb/tailscale/run/runs.log
```

If Tailscale works but Android networking breaks, inspect your `tailscale up`
arguments, DNS settings, exit-node/subnet-route settings, and any other VPN or
firewall module running on the device.

## Upstream

Original project: https://github.com/anasfanani/magisk-tailscaled
