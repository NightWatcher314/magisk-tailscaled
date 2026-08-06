export type PeerView = {
  ID?: string;
  HostName?: string;
  DNSName?: string;
  TailscaleIPs?: string[];
  CurAddr?: string;
  Relay?: string;
  PeerRelay?: string;
  Online?: boolean;
  Active?: boolean;
  ExitNode?: boolean;
  ExitNodeOption?: boolean;
  ShareeNode?: boolean;
  OS?: string;
  LastSeen?: string;
};

export type PeerPath = {
  kind: 'offline' | 'idle' | 'active' | 'direct' | 'relay' | 'peer-relay';
  label: string;
};

export type ProbePathKind = 'direct' | 'derp' | 'peer-relay' | 'unknown';
export type PeerProbeSample = {
  latency: string;
  latencyMs?: number;
  kind: ProbePathKind;
  path: string;
  line: string;
};
export type PeerProbe = {
  samples: PeerProbeSample[];
  sequence: string[];
  lastPath: string;
  averageMs?: number;
  testedAt: number;
  raw: string;
};
export type StoredPeerProbe = PeerProbe & { statusPathAtTest: string };

const MULLVAD_DNS_SUFFIX = 'mullvad.ts.net.';

export function peerDisplayName(peer: PeerView): string {
  return peer.HostName || peer.DNSName?.replace(/\.$/, '') || peer.TailscaleIPs?.[0] || '未知设备';
}

export function peerStableKey(statusKey: string, peer: PeerView): string {
  return peer.ID || statusKey || peer.TailscaleIPs?.[0] || peerDisplayName(peer);
}

export function isVisiblePeer(peer: PeerView): boolean {
  return !peer.ShareeNode && !(peer.ExitNodeOption && !peer.ExitNode && peer.DNSName?.toLowerCase().endsWith(MULLVAD_DNS_SUFFIX));
}

export function peerPath(peer: PeerView): PeerPath {
  if (!peer.Online) return { kind: 'offline', label: '离线' };
  if (!peer.Active) return { kind: 'idle', label: '在线 · 空闲' };
  if (peer.CurAddr) return { kind: 'direct', label: `直连 ${peer.CurAddr}` };
  if (peer.PeerRelay) return { kind: 'peer-relay', label: `Peer Relay ${peer.PeerRelay}` };
  if (peer.Relay) return { kind: 'relay', label: `DERP ${peer.Relay}` };
  return { kind: 'active', label: '活动 · 路径未知' };
}

function pingPath(via: string): { kind: ProbePathKind; label: string } {
  const derp = via.match(/^DERP\((.+)\)$/i);
  if (derp) return { kind: 'derp', label: `DERP ${derp[1]}` };
  const relay = via.match(/^peer-relay\((.+)\)$/i);
  if (relay) return { kind: 'peer-relay', label: `Peer Relay ${relay[1]}` };
  if (/^(?:\d{1,3}\.){3}\d{1,3}:\d+$/.test(via) || /^\[[0-9a-f:]+\]:\d+$/i.test(via)) {
    return { kind: 'direct', label: `直连 ${via}` };
  }
  return { kind: 'unknown', label: `路径未知（${via}）` };
}

function latencyMs(value: string): number | undefined {
  const match = value.match(/^([0-9]+(?:\.[0-9]+)?)(µs|us|ms|s)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'ms') return amount;
  if (unit === 's') return amount * 1000;
  return amount / 1000;
}

export function parsePingProbe(output: string, testedAt = Date.now()): PeerProbe {
  const samples = output.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('pong from ')).flatMap(line => {
    const match = line.match(/ via (.+) in ([^\s]+)$/);
    if (!match) return [];
    const path = pingPath(match[1]);
    return [{ latency: match[2], latencyMs: latencyMs(match[2]), kind: path.kind, path: path.label, line }];
  });
  const sequence = samples.reduce<string[]>((paths, sample) => {
    if (paths[paths.length - 1] !== sample.path) paths.push(sample.path);
    return paths;
  }, []);
  const measurable = samples.map(sample => sample.latencyMs).filter((value): value is number => value !== undefined);
  return {
    samples,
    sequence,
    lastPath: samples[samples.length - 1]?.path || '无回复',
    averageMs: measurable.length ? measurable.reduce((total, value) => total + value, 0) / measurable.length : undefined,
    testedAt,
    raw: output,
  };
}

export function parsePingResult(output: string) {
  const samples = parsePingProbe(output).samples;
  const sample = samples[samples.length - 1];
  return sample ? { path: sample.path, latency: sample.latency, line: sample.line } : null;
}

export function peerProbeIsStale(probe: StoredPeerProbe, peer: PeerView, now = Date.now()): boolean {
  return !peer.Online || now - probe.testedAt > 120000 || peerPath(peer).label !== probe.statusPathAtTest;
}
