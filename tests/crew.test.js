'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resolveCrew, ROLES } = require('../tools/lib/crew-config');

test('no crew block means on, with defaults, devMode off', () => {
  const c = resolveCrew({});
  assert.strictEqual(c.enabled, true);
  assert.strictEqual(c.devMode, false);
  assert.deepStrictEqual(c.roles.lead, { model: 'opus', effort: 'medium' });
  assert.deepStrictEqual(c.roles.sentry, { model: 'haiku', effort: 'low' });
  assert.deepStrictEqual(Object.keys(c.roles), ROLES);
});

test('per-role override keeps the other field and the other roles', () => {
  const c = resolveCrew({ crew: { scout: { effort: 'low' } } });
  assert.deepStrictEqual(c.roles.scout, { model: 'sonnet', effort: 'low' });
  assert.deepStrictEqual(c.roles.builder, { model: 'opus', effort: 'high' });
});

test('crew false and enabled false switch it off', () => {
  assert.strictEqual(resolveCrew({ crew: false }).enabled, false);
  assert.strictEqual(resolveCrew({ crew: { enabled: false } }).enabled, false);
});

test('devMode is read from the top level only', () => {
  assert.strictEqual(resolveCrew({ devMode: true }).devMode, true);
  assert.throws(() => resolveCrew({ crew: { devMode: true } }), /devMode/, 'devMode inside crew is an unknown key');
});

test('unknown role or effort is an error', () => {
  assert.throws(() => resolveCrew({ crew: { scuot: {} } }), /scuot/);
  assert.throws(() => resolveCrew({ crew: { lead: { effort: 'hgih' } } }), /hgih/);
});

test('a typo in a field name or a non-object role is an error too', () => {
  assert.throws(() => resolveCrew({ crew: { lead: { efort: 'high' } } }), /efort/);
  assert.throws(() => resolveCrew({ crew: { scout: 'low' } }), /scout/);
  assert.throws(() => resolveCrew({ crew: { lead: { model: 'opus\nname: x' } } }), /lead/, 'a model value cannot break the frontmatter');
});
