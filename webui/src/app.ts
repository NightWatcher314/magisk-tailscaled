export {};

import { buildManagedArgs, getArgValue, getBooleanArg, preserveUnmanagedArgs, splitArgs } from './up-args';

declare global {
  interface Window {
    Android?: { exec(command: string): string; isModuleInstalled(): boolean };
    ksu?: { spawn?: (...args: unknown[]) => unknown };
  }
}

type ExecResult = { stdout: string; stderr?: string; errno?: number };
type Peer = {
  HostName?: string;
  DNSName?: string;
  TailscaleIPs?: string[];
  ExitNodeOption?: boolean;
  Online?: boolean;
};
type TailscaleStatus = {
  BackendState?: string;
  Self?: { TailscaleIPs?: string[]; Relay?: string };
  Peer?: Record<string, Peer>;
};
type RuntimeConfig = {
  startOnBoot?: string;
  daemonArgs?: string;
  upArgs?: string;
  loginServer?: string;
  hostname?: string;
  enableSsh?: string;
  extraUpArgs?: string;
};
type Snapshot = {
  daemon: string;
  ip: string;
  log: string;
  status: TailscaleStatus;
  config: RuntimeConfig;
};
type LogSnapshot = { log?: string };

const HELPER = '/data/adb/tailscale/scripts/tailscaled.config';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $(id) as HTMLInputElement;
const select = (id: string) => $(id) as HTMLSelectElement;
const shq = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;

let configDirty = false;
let refreshInFlight: Promise<void> | null = null;
let logRefreshInFlight: Promise<string> | null = null;
let latestSnapshot: Snapshot | null = null;
let preservedUpArgs: string[] = [];
let runtimeReady = false;
let operationBusy = false;
let saveInFlight = false;
let pendingLoginOperationId = '';
let pendingLoginDeadline = 0;

function execWithSpawn(mod: typeof import('kernelsu'), command: string, timeoutSeconds: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('KernelSU spawn returned no exit event.'));
    }, (timeoutSeconds + 3) * 1000);
    const finish = (errno: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve({ errno, stdout: stdout.join('\n'), stderr: stderr.join('\n') });
    };
    const child = mod.spawn('sh', ['-c', shq(command)]);
    child.stdout.on('data', (data: string) => stdout.push(data));
    child.stderr.on('data', (data: string) => stderr.push(data));
    child.on('exit', finish);
    child.on('error', (error: unknown) => {
      const exitCode = error && typeof error === 'object' && 'exitCode' in error && typeof error.exitCode === 'number' ? error.exitCode : null;
      if (exitCode !== null) finish(exitCode);
      else if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

async function exec(command: string, timeoutSeconds = 10): Promise<string> {
  const wrapped = `timeout ${timeoutSeconds} sh -c ${shq(command)}`;
  let moduleError: unknown;
  try {
    const mod = await import('kernelsu');
    const result = typeof window.ksu?.spawn === 'function'
      ? await execWithSpawn(mod, wrapped, timeoutSeconds)
      : await mod.exec(wrapped) as ExecResult;
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    return result.errno ? `${output}\n[exit ${result.errno}]`.trim() : output;
  } catch (error) { moduleError = error; }
  if (window.Android?.exec) return window.Android.exec(wrapped);
  throw new Error(`WebUI shell API unavailable: ${String(moduleError)}`);
}

async function execChecked(command: string, timeoutSeconds = 10): Promise<string> {
  const marker = `__TS_EXIT_${Date.now()}__`;
  const output = await exec(`{ ${command}; }; code=$?; printf '\\n${marker}%s\\n' "$code"`, timeoutSeconds);
  const match = output.match(new RegExp(`\\n?${marker}(\\d+)\\s*$`));
  if (!match) throw new Error(output.trim() || 'Command timed out without a result.');
  const body = output.slice(0, match.index).trim();
  if (Number(match[1]) !== 0) throw new Error(body || `Command failed with exit ${match[1]}.`);
  return body;
}

function parseSnapshot(text: string): Snapshot {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`Invalid runtime response: ${text.slice(0, 160)}`); }
  if (!value || typeof value !== 'object') throw new Error('Runtime response is empty.');
  const snapshot = value as Partial<Snapshot>;
  return {
    daemon: String(snapshot.daemon || 'stopped'),
    ip: String(snapshot.ip || ''),
    log: String(snapshot.log || ''),
    status: snapshot.status || {},
    config: snapshot.config || {},
  };
}

function removeArgs(args: string[], prefixes: string[], consumeValueFor: string[] = []) {
  const kept: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const matched = prefixes.find(prefix => args[index] === prefix || args[index].startsWith(`${prefix}=`));
    if (!matched) {
      kept.push(args[index]);
      continue;
    }
    if (consumeValueFor.includes(matched) && args[index] === matched && args[index + 1] && !args[index + 1].startsWith('-')) index += 1;
  }
  return kept;
}

function setDirty(dirty = true) {
  configDirty = dirty;
  $('dirty').textContent = dirty ? '有未保存修改' : '已保存';
  $('dirty').classList.toggle('dirty', dirty);
}

function setOutput(text: string) {
  const element = $('output');
  element.replaceChildren();
  const value = text || 'OK';
  const urlPattern = /(https?:\/\/[^\s<]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(value))) {
    element.append(document.createTextNode(value.slice(lastIndex, match.index)));
    const displayUrl = match[1].replace(/[),.;]+$/, '');
    try {
      const url = new URL(displayUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL scheme');
      const link = document.createElement('a');
      link.href = url.toString();
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = displayUrl;
      element.append(link);
    } catch {
      element.append(document.createTextNode(displayUrl));
    }
    lastIndex = match.index + match[1].length;
  }
  element.append(document.createTextNode(value.slice(lastIndex)));
}

function setOperation(text = '', busy = false) {
  operationBusy = busy;
  $('operation').textContent = text;
  updateActionAvailability();
}

function updateActionAvailability() {
  document.querySelectorAll<HTMLButtonElement>('.action-grid .btn').forEach(button => {
    button.disabled = operationBusy || saveInFlight || !runtimeReady;
  });
  ($('save') as HTMLButtonElement).disabled = operationBusy || saveInFlight || !runtimeReady;
}

function normalizeLoginServer(value: string) {
  let url = value.trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    const plainOrigin = !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === '/';
    return ['http:', 'https:'].includes(parsed.protocol) && plainOrigin ? parsed.origin : '';
  } catch {
    return '';
  }
}

function buildArgsFromUi(markDirty = true) {
  const exitNode = select('exitNode').value;
  const args = buildManagedArgs({
    disableDns: input('acceptDns').checked,
    acceptRoutes: input('acceptRoutes').checked,
    advertiseExitNode: input('advertiseExitNode').checked,
    shieldsUp: input('shieldsUp').checked,
    exitNode,
    allowLan: input('allowLan').checked,
    ssh: input('tailscaleSsh').checked,
  }, preservedUpArgs);
  input('allowLan').disabled = !exitNode;
  input('upArgs').value = args.join(' ');
  if (markDirty) setDirty(true);
  return input('upArgs').value;
}

function populateArgsUi(upArgs: string) {
  const args = splitArgs(upArgs);
  input('acceptDns').checked = getBooleanArg(args, '--accept-dns') === false;
  input('acceptRoutes').checked = getBooleanArg(args, '--accept-routes') === true;
  input('advertiseExitNode').checked = getBooleanArg(args, '--advertise-exit-node') === true;
  input('allowLan').checked = getBooleanArg(args, '--exit-node-allow-lan-access') === true;
  input('shieldsUp').checked = getBooleanArg(args, '--shields-up') === true;
  input('tailscaleSsh').checked = getBooleanArg(args, '--ssh') === true;
  const exitNode = getArgValue(args, '--exit-node');
  if (exitNode) select('exitNode').value = exitNode;
  preservedUpArgs = preserveUnmanagedArgs(args);
  buildArgsFromUi(false);
}

function loadExitNodes(status: TailscaleStatus, selected?: string) {
  const current = selected ?? select('exitNode').value;
  const options = [new Option('不使用 / 清除', '')];
  const peers = status.Peer ? Object.values(status.Peer) : [];
  for (const peer of peers.filter(item => item.ExitNodeOption)) {
    const value = peer.TailscaleIPs?.[0] || peer.DNSName || peer.HostName || '';
    if (!value) continue;
    options.push(new Option(`${peer.HostName || peer.DNSName || value}${peer.Online ? '' : '（离线）'} — ${value}`, value));
  }
  if (current && !options.some(option => option.value === current)) {
    options.push(new Option(`${current}（当前配置，暂不可用）`, current));
  }
  select('exitNode').replaceChildren(...options);
  select('exitNode').value = current;
  input('allowLan').disabled = !select('exitNode').value;
}

function renderStatus(snapshot: Snapshot) {
  const status = snapshot.status;
  const backend = status.BackendState || '-';
  const online = backend === 'Running';
  const daemonRunning = snapshot.daemon === 'running';
  $('statusLabel').textContent = online ? '已连接' : daemonRunning ? 'daemon 运行中' : '已停止';
  $('statusDetail').textContent = online ? 'Tailscale backend 正常' : daemonRunning ? `Backend: ${backend}` : '服务未运行';
  $('statusDot').className = `status-dot ${online ? 'online' : daemonRunning ? 'busy' : 'error'}`;
  $('ip').textContent = (status.Self?.TailscaleIPs || []).join(', ') || snapshot.ip || '-';
  const peers = status.Peer ? Object.values(status.Peer) : [];
  $('peers').textContent = peers.length ? `${peers.filter(peer => peer.Online).length} 在线 / ${peers.length} 台` : '-';
  $('relay').textContent = status.Self?.Relay || '-';
}

function populateConfig(config: RuntimeConfig) {
  const upArgs = String(config.upArgs || '');
  const extraArgs = String(config.extraUpArgs || '');
  input('startOnBoot').checked = config.startOnBoot === '1' || config.startOnBoot === 'true';
  input('loginServer').value = config.loginServer || getArgValue(splitArgs(`${upArgs} ${extraArgs}`), '--login-server');
  input('hostname').value = config.hostname || '';
  input('daemonArgs').value = config.daemonArgs || '';
  populateArgsUi(removeArgs(splitArgs(upArgs), ['--login-server'], ['--login-server']).join(' '));
  input('tailscaleSsh').checked = config.enableSsh === '1' || config.enableSsh === 'true' || input('tailscaleSsh').checked;
  input('extraUpArgs').value = removeArgs(splitArgs(extraArgs), ['--login-server'], ['--login-server']).join(' ');
  buildArgsFromUi(false);
}

function renderLog(log: string) {
  $('log').textContent = log || '暂无日志';
  if (latestSnapshot) latestSnapshot.log = log;
  return pendingLoginOperationId && Date.now() < pendingLoginDeadline ? showLoginUrl(log, pendingLoginOperationId) : '';
}

async function fetchRuntimeLog(): Promise<string> {
  if (logRefreshInFlight) return logRefreshInFlight;
  const request = execChecked(`sh ${HELPER} webui-log`, 5).then(output => {
    let value: unknown;
    try { value = JSON.parse(output); } catch { throw new Error(`Invalid log response: ${output.slice(0, 160)}`); }
    if (!value || typeof value !== 'object') throw new Error('Log response is empty.');
    return String((value as LogSnapshot).log || '');
  });
  logRefreshInFlight = request;
  try {
    return await request;
  } finally {
    if (logRefreshInFlight === request) logRefreshInFlight = null;
  }
}

async function refreshLog() {
  const button = $('refreshLog') as HTMLButtonElement;
  button.disabled = true;
  button.textContent = '刷新中…';
  try {
    renderLog(await fetchRuntimeLog());
  } catch (error) {
    $('log').textContent = `日志读取失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    button.disabled = false;
    button.textContent = '刷新日志';
  }
}

async function refresh(forceFresh = false): Promise<void> {
  if (refreshInFlight) {
    const current = refreshInFlight;
    if (!forceFresh) return current;
    await current;
  }
  const refreshButton = $('refresh') as HTMLButtonElement;
  refreshButton.disabled = true;
  refreshButton.classList.add('busy');
  refreshInFlight = (async () => {
    const output = await execChecked(`sh ${HELPER} webui`, 15);
    const snapshot = parseSnapshot(output);
    latestSnapshot = snapshot;
    renderStatus(snapshot);
    const selectedExitNode = configDirty ? select('exitNode').value : getArgValue(splitArgs(String(snapshot.config.upArgs || '')), '--exit-node');
    loadExitNodes(snapshot.status, selectedExitNode);
    renderLog(snapshot.log);
    $('updated').textContent = `最后更新 ${new Date().toLocaleTimeString()}`;
    if (!configDirty) populateConfig(snapshot.config);
    runtimeReady = true;
    updateActionAvailability();
  })().catch(error => {
    runtimeReady = false;
    updateActionAvailability();
    $('updated').textContent = `状态读取失败 ${new Date().toLocaleTimeString()}`;
    $('statusLabel').textContent = '读取失败';
    $('statusDetail').textContent = error instanceof Error ? error.message : String(error);
    $('statusDot').className = 'status-dot error';
    $('log').textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`;
  }).finally(() => {
    refreshInFlight = null;
    refreshButton.disabled = false;
    refreshButton.classList.remove('busy');
  });
  return refreshInFlight;
}

async function saveConfig(refreshAfterSave = true) {
  if (saveInFlight || operationBusy) return false;
  saveInFlight = true;
  updateActionAvailability();
  const saveButton = $('save') as HTMLButtonElement;
  saveButton.textContent = '保存中…';
  setOutput('正在保存配置…');
  buildArgsFromUi();
  const loginServer = normalizeLoginServer(input('loginServer').value);
  if (input('loginServer').value.trim() && !loginServer) {
    setOutput('Control server URL 无效。');
    saveInFlight = false;
    saveButton.textContent = '保存配置';
    updateActionAvailability();
    return false;
  }
  const pairs: [string, string][] = [
    ['TS_START_ON_BOOT', input('startOnBoot').checked ? '1' : '0'],
    ['TS_ENABLE_SSH', input('tailscaleSsh').checked ? '1' : '0'],
    ['TS_LOGIN_SERVER', loginServer],
    ['TS_HOSTNAME', input('hostname').value],
    ['TS_UP_ARGS', input('upArgs').value],
    ['TS_EXTRA_UP_ARGS', input('extraUpArgs').value],
    ['TS_DAEMON_ARGS', input('daemonArgs').value],
  ];
  const args = pairs.map(([key, value]) => `${key} ${shq(value)}`).join(' ');
  try {
    await execChecked(`sh ${HELPER} set-many ${args}`, 12);
    setDirty(false);
    setOutput('配置已保存。点击“应用并连接”使 up 参数生效。');
    if (refreshAfterSave) await refresh(true);
    return true;
  } catch (error) {
    setOutput(`保存失败：\n${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    saveInFlight = false;
    saveButton.textContent = '保存配置';
    updateActionAvailability();
  }
}

function operationIdFromOutput(output: string) {
  return output.match(/^OPERATION_ID=(.+)$/m)?.[1]?.trim() || '';
}

function loginUrlFromLog(log: string, operationId: string) {
  const marker = operationId ? `=== OPERATION ${operationId} login ===` : '';
  if (marker && !log.includes(marker)) return '';
  const relevant = marker ? log.slice(log.lastIndexOf(marker)) : log;
  const urls = [...relevant.matchAll(/https?:\/\/[^\s<]+/gi)];
  return urls[urls.length - 1]?.[0]?.replace(/[),.;]+$/, '') || '';
}

function operationExitFromLog(log: string, operationId: string) {
  const marker = `=== OPERATION ${operationId} END exit=`;
  const start = log.lastIndexOf(marker);
  if (start < 0) return null;
  const match = log.slice(start + marker.length).match(/^(\d+) ===/);
  return match ? Number(match[1]) : null;
}

function showLoginUrl(log: string, operationId: string) {
  if (!operationId || pendingLoginOperationId !== operationId) return '';
  const url = loginUrlFromLog(log, operationId);
  if (!url) return '';
  pendingLoginOperationId = '';
  setOutput(`登录 URL：\n${url}\n\n点击链接打开。`);
  return url;
}

async function pollLoginUrl(operationId: string) {
  while (pendingLoginOperationId === operationId && Date.now() < pendingLoginDeadline) {
    try {
      const log = await fetchRuntimeLog();
      if (renderLog(log)) return;
      const exitCode = operationExitFromLog(log, operationId);
      if (exitCode !== null) {
        pendingLoginOperationId = '';
        setOutput(exitCode === 0
          ? '登录命令已完成，未返回新 URL；设备可能已经登录。'
          : `登录命令失败（exit ${exitCode}）。请查看最近日志。`);
        return;
      }
    } catch (error) {
      $('log').textContent = `日志读取失败：${error instanceof Error ? error.message : String(error)}`;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (pendingLoginOperationId === operationId) {
    pendingLoginOperationId = '';
    setOutput('60 秒内未发现登录 URL。请查看最近日志或重试登录。');
  }
}

async function runAction(command: string, message: string, background = false, captureLoginUrl = false) {
  if (operationBusy || saveInFlight) return false;
  if (!captureLoginUrl) pendingLoginOperationId = '';
  setOperation(message, true);
  setOutput(message);
  try {
    const output = await execChecked(command, background ? 10 : 25);
    const operationId = operationIdFromOutput(output);
    if (captureLoginUrl && operationId) {
      pendingLoginOperationId = operationId;
      pendingLoginDeadline = Date.now() + 60000;
    }
    if (background) {
      setOutput(captureLoginUrl ? `${output}\n\n正在等待登录 URL…` : (output || '后台操作已启动。'));
      if (captureLoginUrl && operationId) void pollLoginUrl(operationId);
      else setTimeout(() => { void refresh(true); }, 1500);
    } else {
      await refresh(true);
      setOutput(output || '操作已完成。');
    }
    return true;
  } catch (error) {
    setOutput(`操作失败：\n${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    setOperation('', false);
  }
}

function init() {
  updateActionAvailability();
  $('refresh').addEventListener('click', () => refresh());
  $('refreshLog').addEventListener('click', refreshLog);
  $('login').addEventListener('click', () => runAction(`sh ${HELPER} login-bg`, '正在启动登录…', true, true));
  $('up').addEventListener('click', async () => { if (await saveConfig(false)) await runAction(`sh ${HELPER} up-bg`, '正在应用配置…', true); });
  $('down').addEventListener('click', () => runAction(`sh ${HELPER} down`, '正在断开…'));
  $('restart').addEventListener('click', () => runAction(`sh ${HELPER} restart`, '正在重启 daemon…'));
  $('save').addEventListener('click', () => saveConfig());
  ['startOnBoot', 'acceptDns', 'acceptRoutes', 'tailscaleSsh', 'advertiseExitNode', 'allowLan', 'shieldsUp', 'exitNode']
    .forEach(id => $(id).addEventListener('change', () => buildArgsFromUi(true)));
  ['loginServer', 'hostname', 'extraUpArgs', 'daemonArgs']
    .forEach(id => $(id).addEventListener('input', () => setDirty(true)));
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
