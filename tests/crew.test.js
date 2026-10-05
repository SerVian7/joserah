'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT, tmpdir, runTool } = require('./helpers');
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
  for (const s of ['Ledger', 'ledger.js add', 'ledger.js open', 'Done today', 'Distill', 'started:', 'Job:', 'Rules:', 'Done when:', 'Report:'])
    assert.ok(lead.includes(s), `lead: ${s}`);
  // the session that sees the event writes the strip (owner, 2026-10-05): Voice, told by Lead's start line
  assert.ok(!lead.includes('tracker.js" crew'), 'lead: does not write the strip itself');
  const started = lead.split('\n').find((l) => l.includes('started:'));
  for (const s of ['agent <id>', '<model>', '<effort>']) assert.ok(started && started.includes(s), `lead: started line carries ${s}`);
  for (const r of ROLES.filter((x) => x !== 'lead')) {
    const w = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'crew', `${r}.md`), 'utf8');
    assert.match(w, /never your own (strip )?entry/i, `${r}: a worker never writes its own entry`);
  }
});

const ws = (t, cfgExtra = {}) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'A B']);
  const p = path.join(dir, '.joserah', 'config.json');
  fs.writeFileSync(p, JSON.stringify({ ...JSON.parse(fs.readFileSync(p, 'utf8')), ...cfgExtra }, null, 2));
  return dir;
};
const agent = (dir, r) => path.join(dir, '.claude', 'agents', `${r}.md`);

test('defaults write five stamped definitions with model and effort', (t) => {
  const dir = ws(t);
  const r = runTool('crew.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const lead = fs.readFileSync(agent(dir, 'lead'), 'utf8');
  assert.match(lead, /^---\nname: lead\n/);
  assert.match(lead, /\nmodel: opus\n/);
  assert.match(lead, /\neffort: medium\n/);
  assert.match(lead, /joserah:crew generated from config/);
});

test('crew off writes nothing', (t) => {
  const dir = ws(t, { crew: false });
  assert.strictEqual(runTool('crew.js', [dir]).status, 0);
  assert.ok(!fs.existsSync(agent(dir, 'lead')));
});

test('an unstamped same-named file is kept and reported', (t) => {
  const dir = ws(t);
  fs.mkdirSync(path.dirname(agent(dir, 'scout')), { recursive: true });
  fs.writeFileSync(agent(dir, 'scout'), 'mine');
  const r = runTool('crew.js', [dir]);
  assert.strictEqual(fs.readFileSync(agent(dir, 'scout'), 'utf8'), 'mine');
  assert.match(r.stdout, /kept-owner scout/);
});

test('a config error exits 1 and names the key', (t) => {
  const dir = ws(t, { crew: { scuot: {} } });
  const r = runTool('crew.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /scuot/);
});

test('description from the template first line; plugin root resolved in the body', (t) => {
  const dir = ws(t);
  runTool('crew.js', [dir]);
  const scout = fs.readFileSync(agent(dir, 'scout'), 'utf8');
  const first = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'crew', 'scout.md'), 'utf8').split('\n')[0];
  assert.ok(scout.includes('\ndescription: ' + first + '\n'), 'description is the first line');
  assert.match(scout, /\nmodel: sonnet\n/);
  const lead = fs.readFileSync(agent(dir, 'lead'), 'utf8');
  assert.doesNotMatch(lead, /\$\{CLAUDE_PLUGIN_ROOT\}/, 'a subagent has no CLAUDE_PLUGIN_ROOT in its shell');
  assert.ok(lead.includes(PLUGIN_ROOT.replace(/\\/g, '/') + '/tools/ledger.js'));
});

test('--check finds drift and writes nothing', (t) => {
  const dir = ws(t);
  runTool('crew.js', [dir]);
  const p = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8')); cfg.crew = { scout: { effort: 'low' } };
  fs.writeFileSync(p, JSON.stringify(cfg));
  const before = fs.readFileSync(agent(dir, 'scout'), 'utf8');
  const r = runTool('crew.js', [dir, '--check']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /drift scout/);
  assert.strictEqual(fs.readFileSync(agent(dir, 'scout'), 'utf8'), before);
  assert.strictEqual(runTool('crew.js', [dir]).status, 0);
  assert.strictEqual(runTool('crew.js', [dir, '--check']).status, 0);
});

test('--check: a missing definition is drift; an owner file and crew off are not', (t) => {
  const dir = ws(t);
  let r = runTool('crew.js', [dir, '--check']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /drift lead/);
  assert.ok(!fs.existsSync(agent(dir, 'lead')), '--check never writes');
  runTool('crew.js', [dir]);
  fs.writeFileSync(agent(dir, 'scout'), 'mine');
  r = runTool('crew.js', [dir, '--check']);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /kept-owner scout/);
  const off = ws(t, { crew: false });
  assert.strictEqual(runTool('crew.js', [off, '--check']).status, 0);
});
