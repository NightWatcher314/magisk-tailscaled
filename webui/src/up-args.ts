const MANAGED_FLAGS = [
  '--accept-dns',
  '--accept-routes',
  '--advertise-exit-node',
  '--exit-node',
  '--exit-node-allow-lan-access',
  '--login-server',
  '--shields-up',
  '--ssh',
];

export type ManagedUpState = {
  disableDns: boolean;
  acceptRoutes: boolean;
  advertiseExitNode: boolean;
  shieldsUp: boolean;
  exitNode: string;
  allowLan: boolean;
  ssh: boolean;
};

export function splitArgs(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean);
}

export function getArgValue(args: string[], flag: string): string {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    if (args[index].startsWith(`${flag}=`)) return args[index].slice(flag.length + 1);
    if (args[index] === flag && args[index + 1] && !args[index + 1].startsWith('-')) return args[index + 1];
  }
  return '';
}

export function getBooleanArg(args: string[], flag: string): boolean | undefined {
  for (const arg of [...args].reverse()) {
    if (arg === flag) return true;
    if (!arg.startsWith(`${flag}=`)) continue;
    const value = arg.slice(flag.length + 1).toLowerCase();
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
  }
  return undefined;
}

export function preserveUnmanagedArgs(args: string[]): string[] {
  const preserved: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const matched = MANAGED_FLAGS.find(flag => arg === flag || arg.startsWith(`${flag}=`));
    if (!matched) {
      preserved.push(arg);
      continue;
    }
    if ((matched === '--exit-node' || matched === '--login-server') && arg === matched && args[index + 1] && !args[index + 1].startsWith('-')) {
      index += 1;
    }
  }
  return preserved;
}

export function buildManagedArgs(state: ManagedUpState, preserved: string[]): string[] {
  const args = [
    `--accept-dns=${state.disableDns ? 'false' : 'true'}`,
    `--accept-routes=${state.acceptRoutes}`,
    state.advertiseExitNode ? '--advertise-exit-node' : '--advertise-exit-node=false',
    `--shields-up=${state.shieldsUp}`,
    state.exitNode ? `--exit-node=${state.exitNode}` : '--exit-node=',
  ];
  if (state.exitNode) args.push(`--exit-node-allow-lan-access=${state.allowLan}`);
  args.push(state.ssh ? '--ssh' : '--ssh=false');
  return [...args, ...preserved];
}
