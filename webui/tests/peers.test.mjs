import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/peers.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
});
const module = { exports: {} };
new Function('module', 'exports', outputText)(module, module.exports);
const { isVisiblePeer, parsePingProbe, parsePingResult, peerDisplayName, peerPath, peerProbeIsStale, peerStableKey } = module.exports;

test('summarizes direct, DERP, peer-relay, idle and offline peers', () => {
  assert.deepEqual(peerPath({ Online: true, Active: true, CurAddr: '1.2.3.4:5678' }), { kind: 'direct', label: '直连 1.2.3.4:5678' });
  assert.deepEqual(peerPath({ Online: true, Active: true, Relay: 'hkg' }), { kind: 'relay', label: 'DERP hkg' });
  assert.deepEqual(peerPath({ Online: true, Active: true, PeerRelay: '100.64.0.8:40000:1' }), { kind: 'peer-relay', label: 'Peer Relay 100.64.0.8:40000:1' });
  assert.deepEqual(peerPath({ Online: true, Active: true, CurAddr: '1.2.3.4:5678', PeerRelay: '100.64.0.8:40000:1', Relay: 'hkg' }), { kind: 'direct', label: '直连 1.2.3.4:5678' });
  assert.deepEqual(peerPath({ Online: true, Active: true, PeerRelay: '100.64.0.8:40000:1', Relay: 'hkg' }), { kind: 'peer-relay', label: 'Peer Relay 100.64.0.8:40000:1' });
  assert.deepEqual(peerPath({ Online: true, Active: true }), { kind: 'active', label: '活动 · 路径未知' });
  assert.equal(peerPath({ Online: true }).kind, 'idle');
  assert.equal(peerPath({ Online: false }).kind, 'offline');
});

test('matches the default tailscale status peer filters', () => {
  assert.equal(isVisiblePeer({ HostName: 'normal' }), true);
  assert.equal(isVisiblePeer({ HostName: 'shared', ShareeNode: true }), false);
  assert.equal(isVisiblePeer({ DNSName: 'hk.mullvad.ts.net.', ExitNodeOption: true }), false);
  assert.equal(isVisiblePeer({ DNSName: 'hk.mullvad.ts.net.', ExitNodeOption: true, ExitNode: true }), true);
});

test('uses hostname, DNS name and IP as display-name fallbacks', () => {
  assert.equal(peerDisplayName({ HostName: 'phone', DNSName: 'phone.tail.test.' }), 'phone');
  assert.equal(peerDisplayName({ DNSName: 'router.tail.test.' }), 'router.tail.test');
  assert.equal(peerDisplayName({ TailscaleIPs: ['100.64.0.9'] }), '100.64.0.9');
  assert.equal(peerStableKey('map-key', { ID: 'node-id', TailscaleIPs: ['100.64.0.9'] }), 'node-id');
  assert.equal(peerStableKey('map-key', { TailscaleIPs: ['100.64.0.9'] }), 'map-key');
});

test('parses latency and route from tailscale ping output', () => {
  assert.deepEqual(parsePingResult('pong from phone (100.64.0.9) via DERP(hkg) in 31ms'), {
    path: 'DERP hkg', latency: '31ms', line: 'pong from phone (100.64.0.9) via DERP(hkg) in 31ms',
  });
  assert.equal(parsePingResult('pong from phone (100.64.0.9) via 1.2.3.4:41641 in 8ms')?.path, '直连 1.2.3.4:41641');
  assert.equal(parsePingResult('pong from phone (100.64.0.9) via [2001:db8::1]:41641 in 9ms')?.path, '直连 [2001:db8::1]:41641');
  assert.equal(parsePingResult('pong from phone (100.64.0.9) via peer-relay(100.64.0.8:40000:1) in 18ms')?.path, 'Peer Relay 100.64.0.8:40000:1');
  assert.equal(parsePingResult('pong from phone (100.64.0.9) via mystery in 22ms')?.path, '路径未知（mystery）');
  assert.equal(parsePingResult('ping timed out'), null);
});

test('parses five probes, path evolution and mixed latency units', () => {
  const probe = parsePingProbe([
    'pong from phone (100.64.0.9) via DERP(hkg) in 900µs',
    'ping timed out',
    'pong from phone (100.64.0.9) via peer-relay(100.64.0.8:40000:1) in 12ms',
    'pong from phone (100.64.0.9) via peer-relay(100.64.0.8:40000:1) in 0.02s',
    'pong from phone (100.64.0.9) via 1.2.3.4:41641 in 7ms',
  ].join('\n'), 1000);
  assert.deepEqual(probe.sequence, ['DERP hkg', 'Peer Relay 100.64.0.8:40000:1', '直连 1.2.3.4:41641']);
  assert.equal(probe.samples.length, 4);
  assert.equal(probe.lastPath, '直连 1.2.3.4:41641');
  assert.equal(probe.averageMs, 9.975);
  assert.equal(probe.testedAt, 1000);
});

test('marks probes stale by age, offline state or changed status path', () => {
  const base = { ...parsePingProbe('pong from phone (100.64.0.9) via DERP(hkg) in 20ms', 1000), statusPathAtTest: 'DERP hkg' };
  assert.equal(peerProbeIsStale(base, { Online: true, Active: true, Relay: 'hkg' }, 120000), false);
  assert.equal(peerProbeIsStale(base, { Online: true, Active: true, Relay: 'hkg' }, 122000), true);
  assert.equal(peerProbeIsStale(base, { Online: false }, 2000), true);
  assert.equal(peerProbeIsStale(base, { Online: true, Active: true, CurAddr: '1.2.3.4:41641' }, 2000), true);
});
