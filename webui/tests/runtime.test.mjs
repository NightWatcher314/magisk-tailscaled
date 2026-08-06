import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

global.window = { setTimeout, clearTimeout };

const out = mkdtempSync(join(tmpdir(), 'tailscale-runtime-'));
for (const name of ['peers', 'runtime']) {
  const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } });
  writeFileSync(join(out, `${name}.js`), compiled.outputText);
}
const { RuntimeClient, createShellTransport, formatNetcheckSummary, parseRuntimeConfigImport } = await import(`file://${join(out, 'runtime.js')}`);

test('supports KernelSU spawn, legacy exec and Android fallback transports', async () => {
  let spawnCall;
  const handlers = {};
  const spawnModule = {
    spawn(command, args) {
      spawnCall = { command, args };
      queueMicrotask(() => {
        handlers.stdout('first line');
        handlers.stdout('second line');
        handlers.stderr('warning');
        handlers.exit(0);
      });
      return {
        stdout: { on(_event, callback) { handlers.stdout = callback; } },
        stderr: { on(_event, callback) { handlers.stderr = callback; } },
        on(event, callback) { handlers[event] = callback; },
      };
    },
  };
  const spawn = createShellTransport({ runtimeWindow: { ksu: { spawn() {} } }, loadKernelSu: async () => spawnModule });
  assert.deepEqual(await spawn.run('echo ok', 2), { errno: 0, stdout: 'first line\nsecond line', stderr: 'warning' });
  assert.deepEqual(spawnCall, { command: 'sh', args: ['-c', "'timeout 2 sh -c '\\''echo ok'\\'''"] });

  const legacy = createShellTransport({ runtimeWindow: {}, loadKernelSu: async () => ({ exec: async command => ({ stdout: command, errno: 0 }) }) });
  assert.match((await legacy.run('echo legacy', 3)).stdout, /echo legacy/);

  const android = createShellTransport({ runtimeWindow: { Android: { exec: command => `android:${command}` } }, loadKernelSu: async () => { throw new Error('missing'); } });
  assert.match((await android.run('echo fallback', 4)).stdout, /^android:timeout 4/);
});

test('rejects when KernelSU spawn never emits an exit event', async () => {
  const originalSetTimeout = window.setTimeout;
  const originalClearTimeout = window.clearTimeout;
  window.setTimeout = callback => {
    queueMicrotask(callback);
    return 1;
  };
  window.clearTimeout = () => {};
  try {
    const spawnModule = {
      spawn() {
        return {
          stdout: { on() {} },
          stderr: { on() {} },
          on() {},
        };
      },
    };
    const transport = createShellTransport({ runtimeWindow: { ksu: { spawn() {} } }, loadKernelSu: async () => spawnModule });
    await assert.rejects(() => transport.run('echo timeout', 1), /no exit event/);
  } finally {
    window.setTimeout = originalSetTimeout;
    window.clearTimeout = originalClearTimeout;
  }
});

function result(command, body = '', exit = 0) {
  const marker = command.match(/(__TS_EXIT_[A-Za-z0-9_.]+__)/)?.[1];
  assert.ok(marker, `missing marker in ${command}`);
  return { stdout: `${body}\n${marker}${exit}\n`, errno: 0 };
}

test('coalesces snapshots and keeps runtime protocol details inside client', async () => {
  let calls = 0;
  const transport = {
    async run(command) {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return result(command, JSON.stringify({ daemon: 'running', status: { BackendState: 'Running' }, config: {}, log: '' }));
    },
  };
  const client = new RuntimeClient(transport);
  const [left, right] = await Promise.all([client.snapshot(), client.snapshot()]);
  assert.equal(calls, 1);
  assert.equal(left.status.BackendState, 'Running');
  assert.deepEqual(left, right);
});

test('handles managed config, peer probes, JSON Netcheck, health and login URL', async () => {
  const commands = [];
  const transport = {
    async run(command) {
      commands.push(command);
      if (command.includes('set-many')) return result(command);
      if (command.includes('peer-test')) return result(command, 'pong from peer (100.64.0.9) via DERP(hkg) in 20ms');
      if (command.includes(' netcheck')) return result(command, JSON.stringify({ report: { UDP: true }, warnings: 'unstable' }));
      if (command.includes(' health')) return result(command, JSON.stringify({ moduleVersion: 'v2.4.0.0', cliVersion: '1.98.8', daemonRunning: true, backend: 'Running', tun: true, health: [], selinux: 'Enforcing', config: { valid: true, readable: true, mode: '600', customLoginServer: false, disableDns: true }, watchdog: { enabled: false, running: false, restarts: 0 }, logs: { daemonBytes: 1, runBytes: 2 } }));
      if (command.includes('login-bg')) return result(command, 'OPERATION_ID=123-login');
      if (command.includes('webui-log')) return result(command, JSON.stringify({ log: '=== OPERATION 123-login login ===\nhttps://login.example.test/device' }));
      throw new Error(`unexpected command: ${command}`);
    },
  };
  const client = new RuntimeClient(transport);
  await client.saveConfig({ startOnBoot: '1', loginServer: 'https://headscale.test', logMaxKb: '1024' });
  assert.match(commands[0], /TS_WATCHDOG_ENABLED/);
  assert.doesNotMatch(commands[0], /tailscaled\.state|nodekey/);
  assert.equal((await client.peerProbe('100.64.0.9')).lastPath, 'DERP hkg');
  assert.equal((await client.netcheck()).report.UDP, true);
  assert.equal((await client.health()).backend, 'Running');
  assert.equal((await client.action('login')).url, 'https://login.example.test/device');
});

test('surfaces non-zero helper exits', async () => {
  const client = new RuntimeClient({ run: async command => result(command, 'bad input', 2) });
  await assert.rejects(() => client.health(), /bad input/);
});

test('validates config imports and formats structured Netcheck summaries', () => {
  assert.deepEqual(parseRuntimeConfigImport('{"hostname":"phone","watchdogEnabled":true,"logMaxKb":2048}'), {
    hostname: 'phone', watchdogEnabled: 'true', logMaxKb: '2048',
  });
  assert.throws(() => parseRuntimeConfigImport('{"tailscaledState":"secret"}'), /不支持字段/);
  assert.throws(() => parseRuntimeConfigImport('[]'), /JSON 必须是对象/);
  const summary = formatNetcheckSummary({ report: { UDP: true, IPv4: true, IPv6: false, PreferredDERP: 8, RegionLatency: { hkg: 0.021 } }, warnings: '' });
  assert.match(summary, /UDP：true/);
  assert.match(summary, /IPv4 \/ IPv6：true \/ false/);
  assert.match(summary, /hkg: 21 ms/);
});
