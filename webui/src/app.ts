export {};
declare global { interface Window { Android?: { exec(command: string): string; isModuleInstalled(): boolean } } }

type ExecResult = { stdout: string; stderr?: string; errno?: number };
const isAndroidApp = typeof window.Android !== 'undefined';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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
const run = async (cmd: string) => { const out = await exec(cmd); $('output').textContent = out || 'OK'; await refresh(); return out; };
async function getJson<T>(cmd: string, fallback: T): Promise<T> { try { return JSON.parse(await exec(cmd)); } catch { return fallback; } }

async function refresh() {
  const daemonOut = await exec('tailscaled.service status >/dev/null 2>&1 && echo running || echo stopped');
  $('daemon').textContent = daemonOut.trim();
  const status: any = await getJson('tailscale status --json 2>/dev/null || echo "{}"', {});
  $('backend').textContent = status.BackendState || '-';
  $('ip').textContent = (status.Self?.TailscaleIPs || []).join(', ') || (await exec('tailscale ip -4 2>/dev/null || true')).trim() || '-';
  const peers = status.Peer ? Object.values(status.Peer) as any[] : [];
  $('peers').textContent = peers.length ? `${peers.filter(p => p.Online).length} online / ${peers.length} total` : '-';
  const cfg: any = await getJson('tailscaled.config get 2>/dev/null || echo "{}"', {});
  ($('startOnBoot') as HTMLInputElement).checked = cfg.startOnBoot === '1' || cfg.startOnBoot === 'true';
  ($('enableSsh') as HTMLInputElement).checked = cfg.enableSsh === '1' || cfg.enableSsh === 'true';
  ($('hostname') as HTMLInputElement).value = cfg.hostname || '';
  ($('upArgs') as HTMLInputElement).value = cfg.upArgs || '';
  ($('extraUpArgs') as HTMLInputElement).value = cfg.extraUpArgs || '';
  ($('daemonArgs') as HTMLInputElement).value = cfg.daemonArgs || '';
  $('log').textContent = await exec('tail -n 80 /data/adb/tailscale/run/runs.log 2>/dev/null || true');
}
async function saveConfig() {
  const pairs: [string,string][] = [
    ['TS_START_ON_BOOT', ($('startOnBoot') as HTMLInputElement).checked ? '1' : '0'],
    ['TS_ENABLE_SSH', ($('enableSsh') as HTMLInputElement).checked ? '1' : '0'],
    ['TS_HOSTNAME', ($('hostname') as HTMLInputElement).value],
    ['TS_UP_ARGS', ($('upArgs') as HTMLInputElement).value],
    ['TS_EXTRA_UP_ARGS', ($('extraUpArgs') as HTMLInputElement).value],
    ['TS_DAEMON_ARGS', ($('daemonArgs') as HTMLInputElement).value],
  ];
  for (const [key, value] of pairs) await exec(`tailscaled.config set ${key} ${shq(value)}`);
  $('output').textContent = 'Config saved. Use Apply / Up to apply tailscale up args, or Restart Daemon for daemon args.';
  await refresh();
}
function init() {
  $('refresh').addEventListener('click', refresh);
  $('login').addEventListener('click', () => run('tailscaled.config login'));
  $('up').addEventListener('click', () => run('tailscaled.config up'));
  $('down').addEventListener('click', () => run('tailscaled.config down'));
  $('restart').addEventListener('click', () => run('tailscaled.config restart'));
  $('save').addEventListener('click', saveConfig);
  refresh(); setInterval(refresh, 10000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
