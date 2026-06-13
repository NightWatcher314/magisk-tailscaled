export {};
declare global { interface Window { Android?: { exec(command: string): string; isModuleInstalled(): boolean } } }

type ExecResult = { stdout: string; stderr?: string; errno?: number };
type Peer = { HostName?: string; DNSName?: string; TailscaleIPs?: string[]; ExitNodeOption?: boolean; Online?: boolean };
const HELPER = '/data/adb/tailscale/scripts/tailscaled.config';
const isAndroidApp = typeof window.Android !== 'undefined';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let configDirty = false;
const input = (id: string) => $(id) as HTMLInputElement;
const select = (id: string) => $(id) as HTMLSelectElement;

async function exec(command: string): Promise<string> {
  if (isAndroidApp && window.Android) return window.Android.exec(command);
  try {
    const mod = await import('kernelsu');
    const result = await mod.exec(command) as ExecResult;
    return [result.stdout, result.stderr].filter(Boolean).join('\n');
  } catch (e) {
    return `ERROR: KernelSU WebUI API is not available (${String(e)})`;
  }
}
const shq = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;
async function getJson<T>(cmd: string, fallback: T): Promise<T> { try { return JSON.parse(await exec(cmd)); } catch { return fallback; } }
function setDirty(dirty = true) {
  configDirty = dirty;
  const el = document.getElementById('dirty');
  if (el) el.textContent = dirty ? 'Unsaved changes - tap Save config or Apply / Up.' : 'Saved.';
}
function setOutput(text: string) {
  const el = $('output');
  const escaped = (text || 'OK').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]!));
  el.innerHTML = escaped.replace(/https?:\/\/[^\s<]+/g, url => `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`).replace(/\n/g, '<br>');
}
const run = async (cmd: string) => { const out = await exec(cmd); setOutput(out); await refresh(); return out; };

function splitArgs(args: string): string[] { return args.trim().split(/\s+/).filter(Boolean); }
function hasArg(args: string[], prefix: string) { return args.some(a => a === prefix || a.startsWith(`${prefix}=`)); }
function removeArgs(args: string[], prefixes: string[]) { return args.filter(a => !prefixes.some(p => a === p || a.startsWith(`${p}=`))); }
function buildArgsFromUi(markDirty = true) {
  let args: string[] = [];
  if (input('acceptDns').checked) args.push('--accept-dns=false');
  if (input('acceptRoutes').checked) args.push('--accept-routes=true');
  if (input('advertiseExitNode').checked) args.push('--advertise-exit-node');
  if (input('shieldsUp').checked) args.push('--shields-up=true');
  const exitNode = select('exitNode').value;
  if (exitNode) {
    args.push(`--exit-node=${exitNode}`);
    if (input('allowLan').checked) args.push('--exit-node-allow-lan-access=true');
  }
  input('upArgs').value = args.join(' ');
  if (markDirty) setDirty(true);
  return input('upArgs').value;
}
function populateArgsUi(upArgs: string) {
  const args = splitArgs(upArgs);
  input('acceptDns').checked = hasArg(args, '--accept-dns=false') || args.includes('--accept-dns=false');
  input('acceptRoutes').checked = hasArg(args, '--accept-routes=true') || args.includes('--accept-routes');
  input('advertiseExitNode').checked = args.includes('--advertise-exit-node');
  input('allowLan').checked = hasArg(args, '--exit-node-allow-lan-access=true');
  input('shieldsUp').checked = hasArg(args, '--shields-up=true') || args.includes('--shields-up');
  const exitArg = args.find(a => a.startsWith('--exit-node='));
  if (exitArg) select('exitNode').value = exitArg.slice('--exit-node='.length);
  const known = ['--accept-dns', '--accept-dns=false', '--accept-routes', '--accept-routes=true', '--ssh', '--advertise-exit-node', '--exit-node', '--exit-node-allow-lan-access', '--shields-up'];
  const leftovers = removeArgs(args, known);
  if (!input('extraUpArgs').value) input('extraUpArgs').value = leftovers.join(' ');
  buildArgsFromUi(false);
}
function loadExitNodes(status: any, selected?: string) {
  const old = selected ?? select('exitNode').value;
  select('exitNode').innerHTML = '<option value="">None / clear exit node</option>';
  const peers: Peer[] = status.Peer ? Object.values(status.Peer) as Peer[] : [];
  for (const p of peers.filter(p => p.ExitNodeOption)) {
    const value = p.TailscaleIPs?.[0] || p.DNSName || p.HostName || '';
    if (!value) continue;
    const o = document.createElement('option');
    o.value = value;
    o.textContent = `${p.HostName || p.DNSName || value}${p.Online ? '' : ' (offline)'} — ${value}`;
    select('exitNode').appendChild(o);
  }
  select('exitNode').value = old;
}

async function refresh() {
  const daemonOut = await exec('tailscaled.service status >/dev/null 2>&1 && echo running || echo stopped');
  $('daemon').textContent = daemonOut.trim();
  const status: any = await getJson('tailscale status --json 2>/dev/null || echo "{}"', {});
  $('backend').textContent = status.BackendState || '-';
  $('ip').textContent = (status.Self?.TailscaleIPs || []).join(', ') || (await exec('tailscale ip -4 2>/dev/null || true')).trim() || '-';
  const peers = status.Peer ? Object.values(status.Peer) as Peer[] : [];
  $('peers').textContent = peers.length ? `${peers.filter(p => p.Online).length} online / ${peers.length} total` : '-';
  const cfg: any = await getJson(`sh ${HELPER} get 2>/dev/null || echo "{}"`, {});
  if (configDirty) {
    $('log').textContent = await exec('tail -n 80 /data/adb/tailscale/run/runs.log 2>/dev/null || true');
    return;
  }
  const exitArg = String(cfg.upArgs || '').split(/\s+/).find((a: string) => a.startsWith('--exit-node='));
  loadExitNodes(status, exitArg ? exitArg.slice('--exit-node='.length) : undefined);
  input('startOnBoot').checked = cfg.startOnBoot === '1' || cfg.startOnBoot === 'true';
  input('tailscaleSsh').checked = cfg.enableSsh === '1' || cfg.enableSsh === 'true' || splitArgs(cfg.upArgs || '').includes('--ssh');
  input('hostname').value = cfg.hostname || '';
  input('extraUpArgs').value = cfg.extraUpArgs || '';
  input('daemonArgs').value = cfg.daemonArgs || '';
  populateArgsUi(cfg.upArgs || '');
  $('log').textContent = await exec('tail -n 80 /data/adb/tailscale/run/runs.log 2>/dev/null || true');
}
async function saveConfig() {
  buildArgsFromUi();
  const pairs: [string,string][] = [
    ['TS_START_ON_BOOT', input('startOnBoot').checked ? '1' : '0'],
    ['TS_ENABLE_SSH', input('tailscaleSsh').checked ? '1' : '0'],
    ['TS_HOSTNAME', input('hostname').value],
    ['TS_UP_ARGS', input('upArgs').value],
    ['TS_EXTRA_UP_ARGS', input('extraUpArgs').value],
    ['TS_DAEMON_ARGS', input('daemonArgs').value],
  ];
  for (const [key, value] of pairs) await exec(`sh ${HELPER} set ${key} ${shq(value)}`);
  setDirty(false);
  setOutput('Config saved. Use Apply / Up to apply tailscale up args, or Restart Daemon for daemon args.');
  await refresh();
}
function init() {
  $('refresh').addEventListener('click', refresh);
  $('login').addEventListener('click', () => run(`sh ${HELPER} login`));
  $('up').addEventListener('click', async () => { await saveConfig(); await run(`sh ${HELPER} up`); });
  $('down').addEventListener('click', () => run(`sh ${HELPER} down`));
  $('restart').addEventListener('click', () => run(`sh ${HELPER} restart`));
  $('save').addEventListener('click', saveConfig);
  ['startOnBoot','acceptDns','acceptRoutes','tailscaleSsh','advertiseExitNode','allowLan','shieldsUp','exitNode'].forEach(id => $(id).addEventListener('change', () => buildArgsFromUi(true)));
  ['hostname','extraUpArgs','daemonArgs'].forEach(id => $(id).addEventListener('input', () => setDirty(true)));
  refresh(); setInterval(refresh, 10000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
