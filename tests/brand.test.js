'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN_ROOT } = require('./helpers');

const BRAND = path.join(PLUGIN_ROOT, '.brand');
const read = (f) => fs.readFileSync(path.join(BRAND, f), 'utf8');

test('the brand folder ships both templates and the logo', () => {
  for (const f of ['mail.html', 'report.html', 'logo.png', 'j-faded.png']) {
    assert.ok(fs.existsSync(path.join(BRAND, f)), `.brand/${f} is missing`);
  }
});

test('the mail template carries exactly the placeholders a mail is filled with', () => {
  const text = read('mail.html');
  for (const p of ['{{PATH}}', '{{BODY}}', '{{SIGNATURE}}', '{{DATE}}']) {
    assert.ok(text.includes(p), `mail.html has no ${p}`);
  }
  assert.match(text, /#8B0D32/, 'the burgundy rule');
  assert.doesNotMatch(text, /<table/i, 'no tables: the body has to wrap in any reading pane');
});

test('the report template carries its placeholders and the report-style rule', () => {
  const text = read('report.html');
  for (const p of ['{{TITLE}}', '{{BODY}}', '{{SIGNATURE}}', '{{DATE}}']) {
    assert.ok(text.includes(p), `report.html has no ${p}`);
  }
  for (const rule of ['conclusion first', 'Short sentences', 'Numbers, not claims']) {
    assert.ok(text.includes(rule), `report.html does not carry the rule: ${rule}`);
  }
  assert.match(text, /#8B0D32/, 'the brand colour');
});

// Mail that has already gone out fetches its background from the assets/ URL.
// Moving or deleting those files breaks messages sitting in other people's
// inboxes, so assets/ is frozen, not migrated.
test('the assets folder keeps the files already-sent mail fetches', () => {
  for (const f of ['j-faded.png', 'logo.png', 'logo-dark.png', 'logo-white.png']) {
    assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, 'assets', f)), `assets/${f} was moved or deleted`);
  }
});

test('the mail template still points at the published asset URL, not at .brand', () => {
  assert.match(read('mail.html'),
    /https:\/\/raw\.githubusercontent\.com\/SerVian7\/joserah\/main\/assets\/j-faded\.png/,
    'a mail is read after it is sent, from a URL that has to keep resolving');
});

// The two tells of a generated page: a label joined by a middle dot, and a
// framework's stock palette. Both are checked over the whole file, comment
// included — a rule that only covers the markup comes back through an example.
const ZINC = ['#f4f4f5', '#27272a', '#71717a', '#a1a1aa', '#1f1f23'];
const WARM_GREY = ['#f5f3f2', '#2a2326', '#8f8387', '#7a6f73', '#a89ea2',
                   '#1c1819', '#ddd5d7', '#75696d', '#9a8d91', '#5e5457'];

test('neither template joins anything with a middle dot', () => {
  for (const f of ['mail.html', 'report.html']) {
    assert.doesNotMatch(read(f), /·/, `${f} still joins a label with a middle dot`);
  }
});

test('no stock zinc value is left anywhere under .brand', () => {
  for (const f of fs.readdirSync(BRAND).filter((n) => /\.(html|css|svg|md|txt)$/i.test(n))) {
    const text = fs.readFileSync(path.join(BRAND, f), 'utf8').toLowerCase();
    for (const hex of ZINC) {
      assert.ok(!text.includes(hex), `.brand/${f} still carries the stock ${hex}`);
    }
  }
});

test('the mail template is painted in the burgundy-derived greys', () => {
  const text = read('mail.html');
  for (const hex of WARM_GREY) assert.ok(text.includes(hex), `mail.html is missing ${hex}`);
  assert.match(text, /#8B0D32/, 'the rule stays burgundy');
  assert.match(text, /#d9587e/, 'the dark-theme link stays burgundy');
});

test('the report template is painted in the same greys', () => {
  const text = read('report.html');
  for (const hex of ['#f5f3f2', '#2a2326', '#7a6f73', '#1c1819', '#ddd5d7', '#9a8d91']) {
    assert.ok(text.includes(hex), `report.html is missing ${hex}`);
  }
});

test('the mail template says the path is the subject and how a name signs', () => {
  const text = read('mail.html');
  assert.ok(text.includes('the subject alone'), 'the path rule is not stated');
  assert.ok(text.includes('Yarkın, Joserah'), 'the plain-text signature is not documented');
  assert.ok(text.includes('chosen'), 'the comment does not say the palette is a choice');
});

test('the report template carries the rules against decoration that carries nothing', () => {
  const text = read('report.html');
  for (const rule of ['ALL-CAPS', 'restates the heading', 'carry information']) {
    assert.ok(text.includes(rule), `report.html does not carry the rule: ${rule}`);
  }
});

// The middle-dot signature left the templates at 0.13.1; a sentence still
// stating the old form in a skill, a hook or the prompt is what an assistant
// would copy, so the guard covers the whole shipped tree, not .brand alone.
// The pattern is written as an escape on purpose: this file lives inside the
// tree it scans. docs/migrations is exempt - a structure note's job is to
// quote the old shape so a workspace can recognise it.
test('no file in the shipped tree still states the middle-dot signature', (t) => {
  if (spawnSync('git', ['--version']).status !== 0) return t.skip('git unavailable');
  const r = spawnSync('git', ['-C', PLUGIN_ROOT, 'grep', '-n', '-F', '\u00b7 Joserah',
    '--', '.', ':(exclude)docs/migrations'], { encoding: 'utf8' });
  assert.strictEqual((r.stdout || '').trim(), '',
    'the old signature is back:' + (r.stdout || ''));
});
