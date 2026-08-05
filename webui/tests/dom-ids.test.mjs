import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const referencedIds = new Set([
  ...[...source.matchAll(/\$<[^>]+>\('([^']+)'\)|\$\('([^']+)'\)/g)].map(match => match[1] || match[2]),
  ...[...source.matchAll(/(?:input|select)\('([^']+)'\)/g)].map(match => match[1]),
]);

test('every statically referenced DOM id exists', () => {
  const missing = [...referencedIds].filter(id => !htmlIds.has(id));
  assert.deepEqual(missing, []);
});
