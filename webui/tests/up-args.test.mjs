import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/up-args.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
});
const module = { exports: {} };
new Function('module', 'exports', outputText)(module, module.exports);
const { buildManagedArgs, getArgValue, getBooleanArg, preserveUnmanagedArgs, splitArgs } = module.exports;

test('supports two-token exit nodes and removes all UI-managed flag variants', () => {
  const args = splitArgs('--exit-node 100.64.0.9 --ssh=false --advertise-exit-node=false --exit-node-allow-lan-access=false --advertise-routes=10.0.0.0/24');
  assert.equal(getArgValue(args, '--exit-node'), '100.64.0.9');
  assert.equal(getBooleanArg(args, '--ssh'), false);
  assert.deepEqual(preserveUnmanagedArgs(args), ['--advertise-routes=10.0.0.0/24']);
});

test('keeps unknown arguments while parsing bare and explicit booleans', () => {
  const args = splitArgs('--accept-routes --shields-up=true --accept-dns=false --netfilter-mode=nodivert');
  assert.equal(getBooleanArg(args, '--accept-routes'), true);
  assert.equal(getBooleanArg(args, '--accept-dns'), false);
  assert.deepEqual(preserveUnmanagedArgs(args), ['--netfilter-mode=nodivert']);
});

test('builds explicit false values so switches and exit nodes can be cleared', () => {
  assert.deepEqual(buildManagedArgs({
    disableDns: false,
    acceptRoutes: false,
    advertiseExitNode: false,
    shieldsUp: false,
    exitNode: '',
    allowLan: false,
    ssh: false,
  }, ['--netfilter-mode=nodivert']), [
    '--accept-dns=true',
    '--accept-routes=false',
    '--advertise-exit-node=false',
    '--shields-up=false',
    '--exit-node=',
    '--ssh=false',
    '--netfilter-mode=nodivert',
  ]);
});
