export type PeerView = {
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
};

export type PeerPath = {
  kind: 'offline' | 'idle' | 'active' | 'direct' | 'relay' | 'peer-relay';
  label: string;
};

export type PingResult = { latency: string; path: string; line: string };

const MULLVAD_DNS_SUFFIX = 'mullvad.ts.net.';

export function peerDisplayName(peer: PeerView): string {
  return peer.HostName || peer.DNSName?.replace(/\.$/, '') || peer.TailscaleIPs?.[0] || '未知设备';
}

export function isVisiblePeer(peer: PeerView): boolean {
  return !peer.ShareeNode && !(peer.ExitNodeOption && !peer.ExitNode && peer.DNSName?.toLowerCase().endsWith(MULLVAD_DNS_SUFFIX));
}

export function peerPath(peer: PeerView): PeerPath {
  if (!peer.Online) return { kind: 'offline', label: '离线' };
  if (!peer.Active) return { kind: 'idle', label: '在线 · 空闲' };
  if (peer.CurAddr) return { kind: 'direct', label: `直连 ${peer.CurAddr}` };
  if (peer.PeerRelay) return { kind: 'peer-relay', label: `Peer relay ${peer.PeerRelay}` };
  if (peer.Relay) return { kind: 'relay', label: `DERP ${peer.Relay}` };
  return { kind: 'active', label: '活动 · 路径未知' };
}

function pingPathLabel(via: string): string {
  const derp = via.match(/^DERP\((.+)\)$/i);
  if (derp) return `DERP ${derp[1]}`;
  const peerRelay = via.match(/^peer-relay\((.+)\)$/i);
  if (peerRelay) return `Peer relay ${peerRelay[1]}`;
  if (/^(?:\d{1,3}\.){3}\d{1,3}:\d+$/.test(via) || /^\[[0-9a-f:]+\]:\d+$/i.test(via)) return `直连 ${via}`;
  return `路径未知（${via}）`;
}

export function parsePingResult(output: string): PingResult | null {
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('pong from '));
  const line = lines[lines.length - 1];
  if (!line) return null;
  const match = line.match(/ via (.+) in ([^\s]+)$/);
  return match ? { path: pingPathLabel(match[1]), latency: match[2], line } : null;
}
