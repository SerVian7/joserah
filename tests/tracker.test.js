'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT, tmpdir, runTool } = require('./helpers');

const T1 = '2026-10-01T09:05:00';
const T2 = '2026-10-01T17:40:00';
const init = (dir, extra = [], now = T1) =>
  runTool('tracker.js', ['init', dir, '--title', 'Demo board', '--date', '01.10.2026', ...extra], { env: { JOSERAH_NOW: now } });
const render = (dir, now = T1) => runTool('tracker.js', [dir], { env: { JOSERAH_NOW: now } });
const setRows = (dir, rows) => fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(rows));
const page = (dir) => fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const lis = (dir) => (page(dir).match(/<ol>([\s\S]*?)<\/ol>/)[1].match(/<li[\s\S]*?<\/li>/g) || []);

test('init writes the one-line header and an empty rows.json', (t) => {
  const dir = tmpdir(t);
  const r = init(dir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(page(dir), /Demo board · 01\.10\.2026/);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8')), []);
  assert.doesNotMatch(page(dir), /<img/);
  assert.match(page(dir), /<html lang="en"/);
});

test('init defaults the date to today (local clock)', (t) => {
  const dir = tmpdir(t);
  const r = runTool('tracker.js', ['init', dir, '--title', 'X'], { env: { JOSERAH_NOW: T1 } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(page(dir), /X · 01\.10\.2026/);
});

test('init refuses an existing page unless --force', (t) => {
  const dir = tmpdir(t);
  init(dir);
  fs.appendFileSync(path.join(dir, 'index.html'), '<!-- mine -->');
  const r = init(dir);
  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.length > 0);
  assert.match(page(dir), /mine/);
  assert.strictEqual(init(dir, ['--force']).status, 0);
  assert.doesNotMatch(page(dir), /mine/);
});

test('init --logo writes the logo as a separate file; --lang tr is stored on the page', (t) => {
  const dir = tmpdir(t);
  const logo = path.join(dir, 'l.svg');
  fs.writeFileSync(logo, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
  const out = path.join(dir, 'out');
  const r = init(out, ['--logo', logo, '--lang', 'tr']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(page(out), /<img[^>]+src="logo.svg"/);
  assert.ok(fs.existsSync(path.join(out, 'logo.svg')));
  assert.match(page(out), /<html lang="tr"/);
});

test('render stamps a timeless row once and persists it', (t) => {
  const dir = tmpdir(t);
  init(dir);
  setRows(dir, [{ state: 'run', title: 'A' }]);
  const r = render(dir, T1);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /rows: 1/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'))[0].time, '09:05');
  render(dir, T2);
  assert.match(page(dir), /<time>09:05<\/time>/);
  assert.doesNotMatch(page(dir), /17:40<\/time>/);
});

test('a row with time keeps it untouched', (t) => {
  const dir = tmpdir(t);
  init(dir);
  setRows(dir, [{ state: 'ok', title: 'A', time: '03:30' }]);
  render(dir, T2);
  assert.match(page(dir), /<time>03:30<\/time>/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'))[0].time, '03:30');
});

test('groups: agent working, owner, waiting, done, plans; headings; empty group has none', (t) => {
  const dir = tmpdir(t);
  init(dir);
  setRows(dir, [
    { state: 'plan', title: 'P', time: '08:00' },
    { state: 'ok', title: 'D', time: '08:00' },
    { state: 'you', title: 'Y', time: '08:00' },
    { state: 'run', title: 'R', time: '08:00' },
    { state: 'wait', title: 'W', time: '08:00' },
  ]);
  render(dir);
  const items = lis(dir).map((l) => l.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  assert.deepStrictEqual(items.map((s) => s.split(' ')[0]),
    ['Agent', 'Agent', 'Owner', 'Owner', 'Waiting', 'Waiting', 'Done', 'Done', 'Plans', 'Plan']);
  setRows(dir, [{ state: 'ok', title: 'D', time: '08:00' }]);
  render(dir);
  assert.strictEqual(lis(dir).filter((l) => l.includes('class="hd"')).length, 1);
  assert.doesNotMatch(page(dir), /class="hd">Plans/);
});

test('chronological inside a group (done: newest first), ties keep file order, removed row disappears', (t) => {
  const dir = tmpdir(t);
  init(dir);
  setRows(dir, [
    { state: 'ok', title: 'late', time: '10:00' },
    { state: 'ok', title: 'tieA', time: '09:00' },
    { state: 'ok', title: 'tieB', time: '09:00' },
    { state: 'ok', title: 'gone', time: '09:30' },
  ]);
  render(dir);
  const order = (page(dir).match(/<b>(\w+)<\/b>/g) || []).map((s) => s.slice(3, -4));
  assert.deepStrictEqual(order, ['late', 'gone', 'tieA', 'tieB']);
  setRows(dir, [{ state: 'ok', title: 'late', time: '10:00' }]);
  const r = render(dir);
  assert.match(r.stdout, /rows: 1/);
  assert.doesNotMatch(page(dir), /gone/);
});

test('url + label makes a link after small text; default label; non-http gives none', (t) => {
  const dir = tmpdir(t);
  init(dir);
  setRows(dir, [
    { state: 'ok', title: 'A', small: 'note', url: 'https://example.com/x?a=1&b=2', label: 'open', time: '01:00' },
    { state: 'ok', title: 'B', url: 'http://example.com/', time: '01:01' },
    { state: 'ok', title: 'C', small: 's', url: 'javascript:alert(1)', label: 'bad', time: '01:02' },
  ]);
  render(dir);
  const p = page(dir);
  assert.match(p, /note · <a href="https:\/\/example\.com\/x\?a=1&amp;b=2"[^>]*>open<\/a>/);
  assert.match(p, /<a href="http:\/\/example\.com\/"[^>]*>page<\/a>/);
  assert.doesNotMatch(p, /javascript:/);
  assert.doesNotMatch(p, />bad</);
});

test('every text value is escaped', (t) => {
  const dir = tmpdir(t);
  init(dir);
  setRows(dir, [{ state: 'ok', title: '<b>&"x"', small: '<i>', url: 'https://e.com/"><x', label: '<l>', time: '01:00' }]);
  render(dir);
  const p = page(dir);
  assert.match(p, /&lt;b&gt;&amp;&quot;x&quot;/);
  assert.match(p, /&lt;i&gt;/);
  assert.match(p, /&lt;l&gt;/);
  assert.doesNotMatch(p, /<x/);
  assert.doesNotMatch(p, /<l>/);
});

test('bytes outside <ol> and the stamp stay identical across renders', (t) => {
  const dir = tmpdir(t);
  init(dir);
  const strip = (h) => h.replace(/<ol>[\s\S]*?<\/ol>/, '<ol></ol>').replace(/data-t="[^"]*"/, 'data-t=""');
  const before = strip(page(dir));
  setRows(dir, [{ state: 'run', title: 'A' }]);
  render(dir, T1);
  const mid = page(dir);
  assert.strictEqual(strip(mid), before);
  render(dir, T2);
  assert.strictEqual(strip(page(dir)), before);
  assert.match(mid, /data-t="2026-10-01T/);
  assert.notStrictEqual(page(dir), mid, 'stamp moves');
});

test('tr labels', (t) => {
  const dir = tmpdir(t);
  init(dir, ['--lang', 'tr']);
  setRows(dir, [
    { state: 'run', title: 'a', time: '01:00' }, { state: 'ok', title: 'b', time: '01:00', url: 'https://e.com' },
    { state: 'wait', title: 'c', time: '01:00' }, { state: 'you', title: 'd', time: '01:00' },
    { state: 'plan', title: 'e', time: '01:00' },
  ]);
  render(dir);
  const p = page(dir);
  for (const w of ['Ajan çalışıyor', 'Sizde', 'Beklemede', 'Bitenler', 'Planlar', 'Bitti', 'Plan', '>sayfa<']) assert.ok(p.includes(w), w);
});

test('errors: missing dir, bad JSON, unknown state', (t) => {
  const dir = tmpdir(t);
  assert.strictEqual(render(path.join(dir, 'nope')).status, 1);
  init(dir);
  fs.writeFileSync(path.join(dir, 'rows.json'), '{oops');
  assert.strictEqual(render(dir).status, 1);
  setRows(dir, [{ state: 'bogus', title: 'x' }]);
  const r = render(dir);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /bogus/);
  fs.rmSync(path.join(dir, 'rows.json'));
  assert.strictEqual(render(dir).status, 1);
});

test('template has no placeholders and no external requests', () => {
  const f = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'tracker', 'index.html'), 'utf8');
  assert.ok(!f.includes('{{'));
  assert.doesNotMatch(f, /(src|href)="https?:/);
});

test('two rows with the same title are refused (one job, one row)', (t) => {
  const dir = tmpdir(t);
  init(dir);
  setRows(dir, [{ state: 'run', title: 'Price research' }, { state: 'ok', title: ' price research ' }]);
  const r = render(dir);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /duplicate/i);
  setRows(dir, [{ state: 'run', title: 'Price research' }, { state: 'ok', title: 'Case research' }]);
  assert.strictEqual(render(dir).status, 0);
});

test('the one-row-per-job rule is written in the orchestrate skill (0.17.3)', () => {
  for (const f of [['skills', 'orchestrate', 'SKILL.md']]) {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, ...f), 'utf8').replace(/\s+/g, ' ');
    assert.match(text, /never a summary row that repeats other rows/, f.join('/'));
    assert.match(text, /separate jobs are never merged into one row/, f.join('/'));
    assert.match(text, /changes the existing row instead of adding a repeating one/, f.join('/'));
  }
});

test('0.17.4: explicit states, next step on open rows, new-day opening and evaluations on pages are written in the skill', () => {
  const read = (...f) => fs.readFileSync(path.join(PLUGIN_ROOT, ...f), 'utf8').replace(/\s+/g, ' ');
  for (const f of [['skills', 'orchestrate', 'SKILL.md']]) {
    const text = read(...f);
    for (const w of ['agent working (only while a background agent is on it', 'waiting (on someone outside, no AI working)', 'ends with the next step and where it happens']) {
      assert.ok(text.includes(w), `${f.join('/')}: ${w}`);
    }
  }
  const skill = read('skills', 'orchestrate', 'SKILL.md');
  for (const w of ['first message of a new day', '.frozen', 'a missing price never blocks the evaluation', 'marked recommendation']) assert.ok(skill.includes(w), w);
  assert.ok(skill.includes('open rows carried over, marked with the day'));
});

test('row upserts by title and done rows sort newest first', (t) => {
  const dir = tmpdir(t);
  init(dir);
  const row = (a, now) => runTool('tracker.js', ['row', dir, ...a], { env: { JOSERAH_NOW: now } });
  assert.strictEqual(row(['--title', 'A', '--state', 'ok'], '2026-10-01T09:00:00').status, 0);
  assert.strictEqual(row(['--title', 'B', '--state', 'ok'], '2026-10-01T10:00:00').status, 0);
  assert.strictEqual(row(['--title', ' a ', '--state', 'ok', '--small', 'again'], '2026-10-01T11:00:00').status, 0);
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'));
  assert.strictEqual(rows.length, 2);
  const p = page(dir);
  assert.ok(p.indexOf('<b>a</b>') < p.indexOf('<b>B</b>'));
});
