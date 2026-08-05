export {};
declare global { interface Window { Android?: { exec(command: string): string; isModuleInstalled(): boolean } } }
type ExecResult = { stdout: string; stderr?: string; errno?: number };
type Peer = { HostName?: string; DNSName?: string; TailscaleIPs?: string[]; ExitNodeOption?: boolean; Online?: boolean };
type Status = { BackendState?: string; Self?: { TailscaleIPs?: string[]; Relay?: string }; Peer?: Record<string, Peer> };
const HELPER = '/data/adb/tailscale/scripts/tailscaled.config';
const isAndroidApp = typeof window.Android !== 'undefined';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $(id) as HTMLInputElement;
const select = (id: string) => $(id) as HTMLSelectElement;
let configDirty = false;
let refreshInFlight: Promise<void> | null = null;

const shq = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;
async function exec(command: string, timeoutSeconds = 10): Promise<string> {
  const wrapped = `timeout ${timeoutSeconds} sh -c ${shq(command)}`;
  try {
    if (isAndroidApp && window.Android) return window.Android.exec(wrapped);
    const mod = await import('kernelsu');
    const result = await mod.exec(wrapped) as ExecResult;
    const out = [result.stdout, result.stderr].filter(Boolean).join('\n');
    return result.errno ? `${out}\n[exit ${result.errno}]`.trim() : out;
  } catch (e) { return `ERROR: WebUI shell API unavailable (${String(e)})`; }
}
async function getJson<T>(cmd: string, fallback: T): Promise<T> { try { return JSON.parse(await exec(cmd)); } catch { return fallback; } }
function splitArgs(args: string): string[] { return args.trim().split(/\s+/).filter(Boolean); }
function hasArg(args: string[], prefix: string) { return args.some(a => a === prefix || a.startsWith(`${prefix}=`)); }
function removeArgs(args: string[], prefixes: string[], consumeValueFor: string[] = []) {
  const kept: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const matched = prefixes.find(p => args[i] === p || args[i].startsWith(`${p}=`));
    if (!matched) { kept.push(args[i]); continue; }
    if (consumeValueFor.includes(matched) && args[i] === matched && args[i + 1] && !args[i + 1].startsWith('-')) i += 1;
  }
  return kept;
}
function setDirty(dirty = true) { configDirty = dirty; $('dirty').textContent = dirty ? '有未保存修改' : '已保存'; $('dirty').classList.toggle('dirty', dirty); }
function setOutput(text: string) {
  const el = $('output'); el.replaceChildren();
  const value = text || 'OK';
  const urlPattern = /(https?:\/\/[^\s<]+)/g; let last = 0; let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(value))) {
    el.append(document.createTextNode(value.slice(last, match.index)));
    const url = match[1].replace(/[),.;]+$/, '');
    try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('scheme'); const a = document.createElement('a'); a.href = parsed.toString(); a.target = '_blank'; a.rel = 'noreferrer'; a.textContent = url; el.append(a); } catch { el.append(document.createTextNode(url)); }
    last = match.index + match[1].length;
  }
  el.append(document.createTextNode(value.slice(last)));
}
function setOperation(text = '', busy = false) { $('operation').textContent = text; document.querySelectorAll<HTMLButtonElement>('.action-grid .btn').forEach(b => { b.disabled = busy; }); $('statusDot').className = `status-dot ${busy ? 'busy' : ''}`; }
function normalizeLoginServer(value: string) { let url = value.trim().replace(/\/+$/, ''); if (!url) return ''; if (!/^https?:\/\//i.test(url)) url = `https://${url}`; try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString().replace(/\/+$/, '') : ''; } catch { return ''; } }
function buildArgsFromUi(markDirty = true) {
  const args: string[] = [];
  if (input('acceptDns').checked) args.push('--accept-dns=false');
  if (input('acceptRoutes').checked) args.push('--accept-routes=true');
  if (input('advertiseExitNode').checked) args.push('--advertise-exit-node');
  if (input('shieldsUp').checked) args.push('--shields-up=true');
  const exitNode = select('exitNode').value;
  if (exitNode) { args.push(`--exit-node=${exitNode}`); if (input('allowLan').checked) args.push('--exit-node-allow-lan-access=true'); }
  if (input('tailscaleSsh').checked) args.push('--ssh');
  input('allowLan').disabled = !exitNode; input('upArgs').value = args.join(' '); if (markDirty) setDirty(true); return input('upArgs').value;
}
function populateArgsUi(upArgs: string) {
  const args = splitArgs(upArgs);
  input('acceptDns').checked = hasArg(args, '--accept-dns=false'); input('acceptRoutes').checked = hasArg(args, '--accept-routes=true'); input('advertiseExitNode').checked = args.includes('--advertise-exit-node'); input('allowLan').checked = hasArg(args, '--exit-node-allow-lan-access=true'); input('shieldsUp').checked = hasArg(args, '--shields-up=true'); input('tailscaleSsh').checked = args.includes('--ssh');
  const exitArg = args.find(a => a.startsWith('--exit-node=')); if (exitArg) select('exitNode').value = exitArg.slice('--exit-node='.length);
  const known = ['--accept-dns', '--accept-dns=false', '--accept-routes', '--accept-routes=true', '--ssh', '--advertise-exit-node', '--exit-node', '--exit-node-allow-lan-access', '--shields-up', '--login-server'];
  input('extraUpArgs').value = removeArgs(args, known, ['--exit-node', '--login-server']).join(' '); buildArgsFromUi(false);
}
function loadExitNodes(status: Status, selected?: string) { const old = selected ?? select('exitNode').value; select('exitNode').replaceChildren(new Option('不使用 / 清除', '')); const peers = status.Peer ? Object.values(status.Peer) : []; for (const p of peers.filter(p => p.ExitNodeOption)) { const value = p.TailscaleIPs?.[0] || p.DNSName || p.HostName || ''; if (value) select('exitNode').add(new Option(`${p.HostName || p.DNSName || value}${p.Online ? '' : '（离线）'} — ${value}`, value)); } select('exitNode').value = old; input('allowLan').disabled = !select('exitNode').value; }
function renderStatus(status: Status, daemon: string) {
  const backend = status.BackendState || '-'; const online = backend === 'Running'; const daemonRunning = daemon.trim() === 'running';
  $('backend').textContent = backend; $('statusLabel').textContent = online ? '已连接' : daemonRunning ? 'daemon 运行中' : '已停止'; $('statusDetail').textContent = online ? 'Tailscale backend 正常' : daemonRunning ? '等待 backend 就绪' : '服务未运行'; $('statusDot').className = `status-dot ${online ? 'online' : daemonRunning ? 'busy' : 'error'}`;
  $('ip').textContent = (status.Self?.TailscaleIPs || []).join(', ') || '-'; const peers = status.Peer ? Object.values(status.Peer) : []; $('peers').textContent = peers.length ? `${peers.filter(p => p.Online).length} 在线 / ${peers.length} 台` : '-'; $('relay').textContent = status.Self?.Relay || '-';
}
async function refresh() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const [daemon, status, cfg, log, ipFallback] = await Promise.all([
      exec('tailscaled.service status >/dev/null 2>&1 && echo running || echo stopped', 8),
      getJson<Status>('tailscale status --json 2>/dev/null || echo "{}"', {}),
      getJson<any>(`sh ${HELPER} get 2>/dev/null || echo "{}"`, {}),
      exec('tail -n 80 /data/adb/tailscale/run/runs.log 2>/dev/null || true', 5),
      exec('tailscale ip -4 2>/dev/null || true', 5),
    ]);
    if (!status.Self?.TailscaleIPs?.length && ipFallback.trim()) { status.Self = { ...(status.Self || {}), TailscaleIPs: [ipFallback.trim()] }; }
    renderStatus(status, daemon); loadExitNodes(status, String(cfg.upArgs || '').match(/--exit-node=([^\s]+)/)?.[1]); $('log').textContent = log || '暂无日志'; $('updated').textContent = `最后更新 ${new Date().toLocaleTimeString()}`;
    if (!configDirty) { const upArgs = String(cfg.upArgs || ''); const extra = String(cfg.extraUpArgs || ''); input('startOnBoot').checked = cfg.startOnBoot === '1' || cfg.startOnBoot === 'true'; input('loginServer').value = cfg.loginServer || ''; input('hostname').value = cfg.hostname || ''; input('daemonArgs').value = cfg.daemonArgs || ''; populateArgsUi(removeArgs(splitArgs(upArgs), ['--login-server'], ['--login-server']).join(' ')); input('extraUpArgs').value = removeArgs(splitArgs(extra), ['--login-server'], ['--login-server']).join(' '); buildArgsFromUi(false); }
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}
async function saveConfig() {
  buildArgsFromUi(); const loginServer = normalizeLoginServer(input('loginServer').value); if (input('loginServer').value.trim() && !loginServer) { setOutput('Control server URL 无效。'); return false; }
  const pairs: [string,string][] = [['TS_START_ON_BOOT', input('startOnBoot').checked ? '1' : '0'], ['TS_ENABLE_SSH', input('tailscaleSsh').checked ? '1' : '0'], ['TS_LOGIN_SERVER', loginServer], ['TS_HOSTNAME', input('hostname').value], ['TS_UP_ARGS', input('upArgs').value], ['TS_EXTRA_UP_ARGS', input('extraUpArgs').value], ['TS_DAEMON_ARGS', input('daemonArgs').value]];
  const args = pairs.map(([key, value]) => `${key} ${shq(value)}`).join(' '); const out = await exec(`sh ${HELPER} set-many ${args}`, 12); if (/ERROR:|\[exit [1-9]/.test(out)) { setOutput(`保存失败：\n${out}`); return false; }
  setDirty(false); setOutput('配置已保存。点击“应用并连接”使 up 参数生效。'); await refresh(); return true;
}
async function action(id: string, command: string, message: string, background = false) { setOperation(message, true); setOutput(message); const out = await exec(command, background ? 8 : 20); setOutput(out || message); setOperation('', false); await refresh(); if (background) { for (let i = 0; i < 4; i += 1) { await new Promise(resolve => setTimeout(resolve, 2500)); await refresh(); } } return out; }
function init() {
  $('refresh').addEventListener('click', () => refresh()); $('clearOutput').addEventListener('click', () => { $('output').textContent = '就绪。'; });
  $('login').addEventListener('click', () => action('login', `sh ${HELPER} login-bg`, '正在启动登录…', true));
  $('up').addEventListener('click', async () => { if (await saveConfig()) await action('up', `sh ${HELPER} up-bg`, '正在应用配置…', true); });
  $('down').addEventListener('click', () => action('down', `sh ${HELPER} down`, '正在断开…'));
  $('restart').addEventListener('click', () => action('restart', `sh ${HELPER} restart`, '正在重启 daemon…'));
  $('save').addEventListener('click', saveConfig);
  ['startOnBoot','acceptDns','acceptRoutes','tailscaleSsh','advertiseExitNode','allowLan','shieldsUp','exitNode'].forEach(id => $(id).addEventListener('change', () => buildArgsFromUi(true)));
  ['loginServer','hostname','extraUpArgs','daemonArgs'].forEach(id => $(id).addEventListener('input', () => setDirty(true)));
  refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 15000); document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
