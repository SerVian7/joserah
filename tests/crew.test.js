'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');
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

test('every role template carries job, limits, reply and the log rule', () => {
  for (const r of ROLES) {
    const t = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'crew', `${r}.md`), 'utf8');
    for (const h of ['## Job', '## Limits', '## Reply']) assert.ok(t.includes(h), `${r}: ${h}`);
    assert.match(t, /\.joserah\/desk\/crew\//, `${r}: log location`);
    assert.match(t, /write .*log .*before/i, `${r}: result to the log before the reply`);
    assert.doesNotMatch(t, /^---/m, `${r}: no frontmatter, the generator writes it`);
  }
  const lead = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'crew', 'lead.md'), 'utf8');
  for (const s of ['Ledger', 'ledger.js add', 'ledger.js open', 'Done today', 'Distill', 'tracker.js crew', 'Job:', 'Rules:', 'Done when:', 'Report:'])
    assert.ok(lead.includes(s), `lead: ${s}`);
});
