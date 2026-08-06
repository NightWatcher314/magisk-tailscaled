import { parsePingProbe, type PeerProbe, type PeerView } from './peers';

export type RuntimeConfig = {
  startOnBoot?: string;
  daemonArgs?: string;
  upArgs?: string;
  loginServer?: string;
  hostname?: string;
  enableSsh?: string;
  extraUpArgs?: string;
  watchdogEnabled?: string;
  logMaxKb?: string;
};

const RUNTIME_CONFIG_KEYS = new Set<keyof RuntimeConfig>(['startOnBoot', 'daemonArgs', 'upArgs', 'loginServer', 'hostname', 'enableSsh', 'extraUpArgs', 'watchdogEnabled', 'logMaxKb']);

export type TailscaleStatus = {
  Version?: string;
  TUN?: boolean;
  BackendState?: string;
  Health?: string[];
  Self?: { TailscaleIPs?: string[]; Relay?: string };
  Peer?: Record<string, PeerView>;
};

export type Snapshot = {
  daemon: string;
  ip: string;
  log: string;
  status: TailscaleStatus;
  config: RuntimeConfig;
};

export type NetcheckResult = { report: Record<string, unknown>; warnings: string };
export type HealthReport = {
  moduleVersion: string;
  cliVersion: string;
  daemonRunning: boolean;
  backend: string;
  tun: boolean;
  health: string[];
  selinux: string;
  config: { valid: boolean; readable: boolean; mode: string; customLoginServer: boolean; disableDns: boolean };
  watchdog: { enabled: boolean; running: boolean; restarts: number };
  logs: { daemonBytes: number; runBytes: number };
};
export type ActionName = 'login' | 'up' | 'down' | 'restart';
export type ActionResult = { message: string; url?: string; log?: string; background?: boolean };
export type ActionProgress = { log: string; url?: string };
export type ActionOptions = { onProgress?: (progress: ActionProgress) => void };
export type ShellResult = { stdout: string; stderr?: string; errno?: number };
export type ShellTransport = { run(command: string, timeoutSeconds: number): Promise<ShellResult> };

export function parseRuntimeConfigImport(text: string): RuntimeConfig {
  const value = JSON.parse(text) as Record<string, unknown>;
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('JSON 必须是对象');
  const unknown = Object.keys(value).filter(key => !RUNTIME_CONFIG_KEYS.has(key as keyof RuntimeConfig));
  if (unknown.length) throw new Error(`不支持字段：${unknown.join(', ')}`);
  const invalid = Object.entries(value).filter(([, item]) => item !== null && !['string', 'number', 'boolean'].includes(typeof item));
  if (invalid.length) throw new Error(`字段值必须是字符串、数字或布尔值：${invalid.map(([key]) => key).join(', ')}`);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item ?? '')])) as RuntimeConfig;
}

export function formatNetcheckSummary(result: NetcheckResult): string {
  const report = result.report;
  const latency = report.RegionLatency && typeof report.RegionLatency === 'object'
    ? Object.entries(report.RegionLatency as Record<string, unknown>).map(([region, seconds]) => `${region}: ${(Number(seconds) * 1000).toFixed(0)} ms`).join(' · ')
    : '-';
  return [
    `UDP：${String(report.UDP ?? '-')}`,
    `IPv4 / IPv6：${String(report.IPv4 ?? '-')} / ${String(report.IPv6 ?? '-')}`,
    `NAT 映射随目标变化：${String(report.MappingVariesByDestIP ?? '-')}`,
    `UPnP / NAT-PMP / PCP：${String(report.UPnP ?? '-')} / ${String(report.PMP ?? '-')} / ${String(report.PCP ?? '-')}`,
    `首选 DERP：${String(report.PreferredDERP ?? '-')}`,
    `DERP 延迟：${latency}`,
  ].join('\n');
}

type SpawnChild = {
  stdout: { on(event: 'data', callback: (data: string) => void): void };
  stderr: { on(event: 'data', callback: (data: string) => void): void };
  on(event: 'exit', callback: (code: number) => void): void;
  on(event: 'error', callback: (error: unknown) => void): void;
};
type KernelModule = typeof import('kernelsu') & { spawn(command: string, args?: string[]): SpawnChild };
type RuntimeWindow = Window & {
  Android?: { exec(command: string): string };
  ksu?: { spawn?: (...args: unknown[]) => unknown };
};

const HELPER = '/data/adb/tailscale/scripts/tailscaled.config';
const shq = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

function spawnRun(mod: KernelModule, command: string, timeoutSeconds: number): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) reject(new Error('KernelSU spawn returned no exit event.'));
      settled = true;
    }, (timeoutSeconds + 3) * 1000);
    const finish = (errno: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve({ errno, stdout: stdout.join('\n'), stderr: stderr.join('\n') });
    };
    // KernelSU's native bridge concatenates argv into a shell command and
    // emits stdout/stderr callbacks one line at a time.
    const child = mod.spawn('sh', ['-c', shq(command)]);
    child.stdout.on('data', (data: string) => stdout.push(data));
    child.stderr.on('data', (data: string) => stderr.push(data));
    child.on('exit', finish);
    child.on('error', (error: unknown) => {
      const code = error && typeof error === 'object' && 'exitCode' in error && typeof error.exitCode === 'number' ? error.exitCode : null;
      if (code !== null) finish(code);
      else if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

export function createShellTransport(options: {
  runtimeWindow?: RuntimeWindow;
  loadKernelSu?: () => Promise<KernelModule>;
} = {}): ShellTransport {
  const runtimeWindow = options.runtimeWindow || window as RuntimeWindow;
  const loadKernelSu = options.loadKernelSu || (() => import('kernelsu') as Promise<KernelModule>);
  return {
    async run(command, timeoutSeconds) {
      const wrapped = `timeout ${timeoutSeconds} sh -c ${shq(command)}`;
      let moduleError: unknown;
      try {
        const mod = await loadKernelSu();
        if (typeof runtimeWindow.ksu?.spawn === 'function') return spawnRun(mod, wrapped, timeoutSeconds);
        return await mod.exec(wrapped) as ShellResult;
      } catch (error) {
        moduleError = error;
      }
      if (runtimeWindow.Android?.exec) return { stdout: runtimeWindow.Android.exec(wrapped), errno: 0 };
      throw new Error(`WebUI shell API unavailable: ${String(moduleError)}`);
    },
  };
}

function parseObject<T>(text: string, label: string): T {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`Invalid ${label} response: ${text.slice(0, 160)}`); }
  if (!value || typeof value !== 'object') throw new Error(`${label} response is empty.`);
  return value as T;
}

export class RuntimeClient {
  private snapshotInFlight: Promise<Snapshot> | null = null;

  constructor(private readonly transport: ShellTransport = createShellTransport()) {}

  private async checked(command: string, timeoutSeconds = 10): Promise<string> {
    const marker = `__TS_EXIT_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
    const result = await this.transport.run(`{ ${command}; } 2>&1; code=$?; printf '\\n${marker}%s\\n' "$code"`, timeoutSeconds);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const match = output.match(new RegExp(`\\n?${marker}(\\d+)\\s*$`));
    if (!match) throw new Error(output.trim() || 'Command timed out without a result.');
    const body = output.slice(0, match.index).trim();
    if (Number(match[1]) !== 0) throw new Error(body || `Command failed with exit ${match[1]}.`);
    return body;
  }

  snapshot(): Promise<Snapshot> {
    if (this.snapshotInFlight) return this.snapshotInFlight;
    const request = this.checked(`sh ${HELPER} webui`, 15).then(text => {
      const value = parseObject<Partial<Snapshot>>(text, 'runtime');
      return {
        daemon: String(value.daemon || 'stopped'),
        ip: String(value.ip || ''),
        log: String(value.log || ''),
        status: value.status || {},
        config: value.config || {},
      };
    });
    this.snapshotInFlight = request;
    return request.finally(() => {
      if (this.snapshotInFlight === request) this.snapshotInFlight = null;
    });
  }

  async log(): Promise<string> {
    const value = parseObject<{ log?: string }>(await this.checked(`sh ${HELPER} webui-log`, 5), 'log');
    return String(value.log || '');
  }

  async saveConfig(config: RuntimeConfig): Promise<void> {
    const pairs: [string, string][] = [
      ['TS_START_ON_BOOT', config.startOnBoot || '0'],
      ['TS_ENABLE_SSH', config.enableSsh || '0'],
      ['TS_LOGIN_SERVER', config.loginServer || ''],
      ['TS_HOSTNAME', config.hostname || ''],
      ['TS_UP_ARGS', config.upArgs || ''],
      ['TS_EXTRA_UP_ARGS', config.extraUpArgs || ''],
      ['TS_DAEMON_ARGS', config.daemonArgs || ''],
      ['TS_WATCHDOG_ENABLED', config.watchdogEnabled || '0'],
      ['TS_LOG_MAX_KB', config.logMaxKb || '1024'],
    ];
    await this.checked(`sh ${HELPER} set-many ${pairs.map(([key, value]) => `${key} ${shq(value)}`).join(' ')}`, 12);
  }

  async action(action: ActionName, options: ActionOptions = {}): Promise<ActionResult> {
    if (action === 'login' || action === 'up') return this.runBackground(action, options);
    const output = await this.checked(`sh ${HELPER} ${action}`, 25);
    return { message: output || '操作已完成。' };
  }

  private async runBackground(action: 'login' | 'up', options: ActionOptions): Promise<ActionResult> {
    const output = await this.checked(`sh ${HELPER} ${action}-bg`, 10);
    const operationId = output.match(/^OPERATION_ID=([^\s]+)$/m)?.[1];
    if (!operationId) return { message: output || `${action} 操作已启动。`, background: true };
    const deadline = Date.now() + (action === 'login' ? 60000 : 30000);
    while (Date.now() < deadline) {
      const log = await this.log();
      const marker = `=== OPERATION ${operationId} ${action} ===`;
      const relevant = log.includes(marker) ? log.slice(log.lastIndexOf(marker)) : '';
      const urls = [...relevant.matchAll(/https?:\/\/[^\s<]+/gi)];
      const url = urls[urls.length - 1]?.[0]?.replace(/[),.;]+$/, '');
      options.onProgress?.({ log, url });
      if (action === 'login' && url) return { message: '登录 URL 已生成；点击下方链接继续。', url, log, background: true };
      const exit = relevant.match(new RegExp(`=== OPERATION ${operationId} END exit=(\\d+) ===`));
      if (exit) {
        const ok = Number(exit[1]) === 0;
        return {
          message: ok
            ? action === 'login' ? '登录命令已完成，未返回新 URL；设备可能已经登录。' : '配置已应用并完成连接操作。'
            : `${action === 'login' ? '登录' : '连接'}命令失败（exit ${exit[1]}）。`,
          log,
        };
      }
      await wait(1000);
    }
    return {
      message: action === 'login' ? '60 秒内未发现登录 URL。请查看最近日志或重试登录。' : '连接操作仍在后台运行，请查看最近日志。',
      background: true,
    };
  }

  async peerProbe(ip: string): Promise<PeerProbe> {
    return parsePingProbe(await this.checked(`sh ${HELPER} peer-test ${shq(ip)}`, 20));
  }

  async netcheck(): Promise<NetcheckResult> {
    return parseObject<NetcheckResult>(await this.checked(`sh ${HELPER} netcheck`, 35), 'Netcheck');
  }

  async health(): Promise<HealthReport> {
    return parseObject<HealthReport>(await this.checked(`sh ${HELPER} health`, 12), 'health');
  }
}
