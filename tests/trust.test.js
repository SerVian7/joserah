'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');
const pd = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'permission-deny'));

test('denyFor owner returns exactly the base set', () => {
  const result = pd.denyFor('owner');
  assert.deepStrictEqual(result, pd.PERMISSION_DENY);
  assert.notStrictEqual(result, pd.PERMISSION_DENY, 'returns a copy, not the original');
});

test('denyFor owner copy is independent of the original', () => {
  const result = pd.denyFor('owner');
  result.push('mutated');
  assert.strictEqual(pd.PERMISSION_DENY.length, 9, 'original unchanged after mutation');
});

test('denyFor guest adds machine-control rules on top of the base set', () => {
  const rules = pd.denyFor('guest');
  for (const base of pd.PERMISSION_DENY) assert.ok(rules.includes(base), `keeps ${base}`);
  assert.ok(rules.some((r) => /shutdown/.test(r)), 'denies shutdown');
  assert.ok(rules.some((r) => /taskkill/.test(r)), 'denies taskkill');
  assert.ok(rules.some((r) => /docker/.test(r)), 'denies docker');
});

test('denyFor guest walls off each declared host path for read, edit and write', () => {
  const rules = pd.denyFor('guest', { hostPaths: ['d:/atay'] });
  assert.ok(rules.includes('Read(//d/atay/**)'));
  assert.ok(rules.includes('Edit(//d/atay/**)'));
  assert.ok(rules.includes('Write(//d/atay/**)'));
});

test('denyFor rejects an unknown trust level rather than guessing', () => {
  assert.throws(() => pd.denyFor('sandboxed'), /unknown trust level/i);
});

test('toRulePath normalizes Windows paths with trailing slashes', () => {
  const rules = pd.denyFor('guest', { hostPaths: ['d:/atay/'] });
  assert.ok(rules.includes('Read(//d/atay/**)'));
  assert.ok(rules.includes('Edit(//d/atay/**)'));
  assert.ok(rules.includes('Write(//d/atay/**)'));
});

test('toRulePath handles POSIX absolute paths for non-Windows hosts', () => {
  const rules = pd.denyFor('guest', { hostPaths: ['/home/ubuntu'] });
  assert.ok(rules.includes('Read(//home/ubuntu/**)'));
  assert.ok(rules.includes('Edit(//home/ubuntu/**)'));
  assert.ok(rules.includes('Write(//home/ubuntu/**)'));
});
