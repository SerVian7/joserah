'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');
const pd = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'permission-deny'));

test('denyFor owner returns exactly the base set', () => {
  assert.deepStrictEqual(pd.denyFor('owner'), pd.PERMISSION_DENY);
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
