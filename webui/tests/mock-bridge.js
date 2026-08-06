(() => {
  const state = { snapshots: 0, logReads: 0, calls: [] };
  const snapshot = {
    daemon: 'running',
    ip: '100.64.0.1',
    log: '06:00 PM [Info]: mock runtime ready',
    status: {
      Version: '1.98.8',
      TUN: true,
      BackendState: 'Running',
      Health: [],
      Self: { TailscaleIPs: ['100.64.0.1'], Relay: 'hkg' },
      Peer: {
        'node-peer-1': { ID: 'peer-1', HostName: 'nas', DNSName: 'nas.example.ts.net.', TailscaleIPs: ['100.64.0.2'], Online: true, Active: true, OS: 'linux', Relay: 'hkg', ExitNodeOption: true },
        'node-peer-2': { ID: 'peer-2', HostName: 'phone', TailscaleIPs: ['100.64.0.3'], Online: false, Active: false, OS: 'android', LastSeen: new Date(Date.now() - 3600000).toISOString() },
      },
    },
    config: {
      startOnBoot: '1', daemonArgs: '-no-logs-no-support', upArgs: '--accept-dns=false', loginServer: '', hostname: 'android-test', enableSsh: '0', extraUpArgs: '', watchdogEnabled: '0', logMaxKb: '1024',
    },
  };
  function wrap(command, body, exit = 0) {
    const marker = command.match(/(__TS_EXIT_[A-Za-z0-9_.]+__)/)?.[1];
    return marker ? `${body}\n${marker}${exit}\n` : body;
  }
  window.__mockRuntime = state;
  window.Android = {
    isModuleInstalled: () => true,
    exec(command) {
      state.calls.push(command);
      if (command.includes(' webui-log')) {
        state.logReads += 1;
        return wrap(command, JSON.stringify({ log: '=== OPERATION mock-login login ===\nhttps://login.example.test/device' }));
      }
      if (command.includes(' login-bg')) return wrap(command, 'OPERATION_ID=mock-login\nStarted tailscale login in the background.');
      if (command.includes(' peer-test ')) return wrap(command, [
        'pong from nas (100.64.0.2) via DERP(hkg) in 20ms',
        'pong from nas (100.64.0.2) via peer-relay(100.64.0.9:40000:1) in 12ms',
        'pong from nas (100.64.0.2) via 192.0.2.5:41641 in 8ms',
        'pong from nas (100.64.0.2) via 192.0.2.5:41641 in 7ms',
        'pong from nas (100.64.0.2) via 192.0.2.5:41641 in 6ms',
      ].join('\n'));
      if (command.includes(' netcheck')) return wrap(command, JSON.stringify({ report: { UDP: true, IPv4: true, IPv6: false, MappingVariesByDestIP: false, UPnP: true, PMP: false, PCP: false, PreferredDERP: 8, RegionLatency: { 8: 0.021 } }, warnings: 'JSON format is unstable' }));
      if (command.includes(' health')) return wrap(command, JSON.stringify({ moduleVersion: 'v2.4.0.0', cliVersion: '1.98.8', daemonRunning: true, backend: 'Running', tun: true, health: [], selinux: 'Enforcing', config: { valid: true, readable: true, mode: '600', customLoginServer: false, disableDns: true }, watchdog: { enabled: false, running: false, restarts: 0 }, logs: { daemonBytes: 1200, runBytes: 2400 } }));
      if (command.includes(' webui')) {
        state.snapshots += 1;
        return wrap(command, JSON.stringify(snapshot));
      }
      return wrap(command, 'OK');
    },
  };
})();
