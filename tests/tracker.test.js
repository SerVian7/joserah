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

test('groups: in progress (agent working in developer mode), owner, done in the list; waiting and plans as closed groups at the top; empty group has none', (t) => {
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
    ['In', 'In', 'Owner', 'Owner', 'Done', 'Done'], 'outside a workspace developer mode is off');
  const html = page(dir);
  const folds = html.match(/<section class="folds">([\s\S]*?)<\/section>/);
  assert.ok(folds, 'folds section present');
  assert.ok(html.indexOf('<section class="folds">') < html.indexOf('<ol>'), 'folds sit above the list');
  assert.deepStrictEqual((folds[1].match(/<summary>[^<]*/g) || []).map((s) => s.replace('<summary>', '').trim()), ['Waiting 1', 'Plans 1']);
  assert.doesNotMatch(folds[1], /<details[^>]*\bopen/);
  assert.match(folds[1], /<b>W<\/b>[\s\S]*<b>P<\/b>/);
  render(dir);
  assert.strictEqual((page(dir).match(/<section class="folds">/g) || []).length, 1);
  setRows(dir, [{ state: 'ok', title: 'D', time: '08:00' }, { state: 'plan', title: 'P', time: '08:00' }]);
  render(dir);
  assert.strictEqual(lis(dir).filter((l) => l.includes('class="hd"')).length, 1);
  assert.doesNotMatch(page(dir), /<summary>Waiting/);
  assert.match(page(dir), /<summary>Plans 1/);
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
  assert.ok(!p.includes('Ajan'), 'no agent wording with developer mode off');
  for (const w of ['Sürüyor', 'Sizde', 'Beklemede', 'Bitenler', 'Planlar', 'Bitti', 'Plan', '>sayfa<']) assert.ok(p.includes(w), w);
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

test('plans with a group: one closed fold per group inside the Plans fold', (t) => {
  const dir = tmpdir(t);
  init(dir);
  setRows(dir, [
    { state: 'plan', title: 'P1', group: 'Alpha', time: '08:00' },
    { state: 'plan', title: 'P2', group: 'Beta', time: '08:00' },
    { state: 'plan', title: 'P3', group: 'Alpha', time: '08:00' },
    { state: 'plan', title: 'P4', time: '08:00' },
  ]);
  render(dir);
  const folds = page(dir).match(/<section class="folds">([\s\S]*?)<\/section>/)[1];
  assert.deepStrictEqual((folds.match(/<summary>[^<]*/g) || []).map((s) => s.replace('<summary>', '').trim()), ['Plans 4', 'Alpha 2', 'Beta 1', 'Other 1']);
  assert.doesNotMatch(folds, /<details[^>]*\bopen/);
});

test('devMode off: the run group reads as in progress, never agent', (t) => {
  const ws = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', ws, '--workspace', 'w', '--owner', 'A B']);
  const dir = path.join(ws, '.joserah', 'desk', 'artifacts', 'd', 'tracker');
  init(dir);
  setRows(dir, [{ state: 'run', title: 'Research' }]);
  render(dir);
  assert.doesNotMatch(page(dir), /Agent working/);
  assert.match(page(dir), /In progress/);
  const p = path.join(ws, '.joserah', 'config.json');
  fs.writeFileSync(p, JSON.stringify({ ...JSON.parse(fs.readFileSync(p, 'utf8')), devMode: true }));
  render(dir);
  assert.match(page(dir), /Agent working/);
});

const crew = (dir, args) => runTool('tracker.js', ['crew', dir, ...args], { env: { JOSERAH_NOW: T1 } });
test('crew upserts by role and job', (t) => {
  const dir = tmpdir(t); init(dir);
  assert.strictEqual(crew(dir, ['--role', 'scout', '--job', 'DOTS research', '--state', 'work']).status, 0);
  crew(dir, ['--role', 'scout', '--job', 'dots research ', '--state', 'idle']);
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'));
  assert.strictEqual(j.crew.length, 1);
  assert.strictEqual(j.crew[0].state, 'idle');
});
test('crew refuses an unknown state, role or reason', (t) => {
  const dir = tmpdir(t); init(dir);
  assert.strictEqual(crew(dir, ['--role', 'scout', '--job', 'x', '--state', 'busy']).status, 1);
  assert.strictEqual(crew(dir, ['--role', 'pilot', '--job', 'x', '--state', 'work']).status, 1);
  assert.strictEqual(crew(dir, ['--role', 'scout', '--job', 'x', '--state', 'owner', '--reason', 'mood']).status, 1);
  assert.strictEqual(crew(dir, ['--role', 'scout', '--job', 'x', '--state', 'owner', '--reason', 'approval']).status, 0, 'a valid one is taken');
});
test('a legacy array rows.json renders as before', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, [{ state: 'ok', title: 'A' }]);
  assert.strictEqual(render(dir).status, 0);
  assert.ok(Array.isArray(JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'))));
});

test('one inline line icon per role, no emoji', () => {
  const { ICONS } = require('../tools/lib/crew-icons');
  for (const r of ['voice', 'lead', 'architect', 'builder', 'scout', 'sentry']) {
    assert.match(ICONS[r], /^<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"/, r);
    assert.doesNotMatch(ICONS[r], /[\u{1F300}-\u{1FAFF}]/u, r);
    assert.doesNotMatch(ICONS[r], /<(image|use|text)\b/, `${r}: paths only`);
  }
  assert.strictEqual(new Set(Object.values(ICONS)).size, 6, 'all six differ');
});
test('icons carry no colour of their own (calm, theme tokens only)', () => {
  const { ICONS } = require('../tools/lib/crew-icons');
  for (const [r, svg] of Object.entries(ICONS)) {
    assert.doesNotMatch(svg, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i, r);
    assert.doesNotMatch(svg, /\b(style|fill|stroke)="(?!none|currentColor)/, r);
  }
});

const devWs = (t) => {
  const ws = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', ws, '--workspace', 'w', '--owner', 'A B']);
  const p = path.join(ws, '.joserah', 'config.json');
  fs.writeFileSync(p, JSON.stringify({ ...JSON.parse(fs.readFileSync(p, 'utf8')), devMode: true }));
  const dir = path.join(ws, '.joserah', 'desk', 'artifacts', 'x', 'tracker');
  init(dir);
  return dir;
};
test('strip: icon, line, state class, reason; counts only working or waiting', (t) => {
  const dir = devWs(t);
  crew(dir, ['--role', 'scout', '--job', 'A', '--state', 'work']);
  crew(dir, ['--role', 'scout', '--job', 'B', '--state', 'owner', '--reason', 'approval']);
  crew(dir, ['--role', 'scout', '--job', 'C', '--state', 'idle']);
  crew(dir, ['--role', 'lead', '--job', 'Conversation', '--state', 'work']);
  const html = page(dir);
  assert.match(html, /class="crew"/);
  assert.match(html, /data-role="scout"[^>]*data-count="2"/);
  assert.doesNotMatch(html, /data-role="lead"[^>]*data-count=/, 'a single one has no badge');
  assert.match(html, /class="crew-line owner"[\s\S]*?approval/);
  assert.match(html, /Scout · A/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
  // template tokens: icons in the muted text token, `owner` in the page's owner colour (no --accent exists)
  assert.match(html, /\.crew svg\{[^}]*color:var\(--muted\)/);
  assert.match(html, /\.crew-line\.owner svg\{[^}]*color:var\(--you\)/);
  // the strip sits under the header, above the row groups
  assert.ok(html.indexOf('class="crew"') > html.indexOf('</header>') && html.indexOf('class="crew"') < html.indexOf('<ol>'));
  // Voice leads the summary
  assert.match(html, /<div class="crew-sum"><span[^>]*data-role="voice"/);
});
// Task 3.7 (owner, 2026-10-05): "normal davranışta, ajan dememeli ve ajan isimleri olmamalı.
// ikonları kalabilir." With devMode off the strip shows — icons, states, count badge — but no
// role name and no agent wording anywhere on the page, aria and title text included.
const ROLE_WORDS = /\b(voice|lead|architect|builder|scout|sentry)\b/i;
test('devMode off: the strip shows icons and states, with no role name and no agent wording', (t) => {
  const { ICONS } = require('../tools/lib/crew-icons');
  for (const lang of ['tr', 'en']) {
    const dir = tmpdir(t); init(dir, ['--lang', lang]);
    setRows(dir, [{ state: 'run', title: 'DOTS araştırması', time: '09:00' }]);
    crew(dir, ['--role', 'scout', '--job', 'DOTS araştırması', '--state', 'work']);
    crew(dir, ['--role', 'scout', '--job', 'Fiyat taraması', '--state', 'owner', '--reason', 'approval']);
    crew(dir, ['--role', 'builder', '--job', 'Sayfa düzeltmesi', '--state', 'idle']);
    crew(dir, ['--role', 'lead', '--job', 'Konuşma', '--state', 'work']);
    const html = page(dir);
    assert.match(html, /<section class="crew">/, `${lang}: the strip is shown`);
    for (const r of ['voice', 'lead', 'scout', 'builder']) assert.ok(html.includes(ICONS[r]), `${lang}: ${r} icon`);
    assert.match(html, /class="crew-line owner"/, 'the three states stay');
    assert.match(html, /class="crew-line work"/);
    assert.match(html, /class="crew-line idle"/);
    assert.match(html, /data-count="2"/, 'the count badge stays');
    assert.match(html, /<span>DOTS araştırması<\/span>/, 'a line is the work only');
    assert.doesNotMatch(html, ROLE_WORDS, `${lang}: no role name`);
    assert.doesNotMatch(html, /ajan|agent/i, `${lang}: no agent wording`);
    assert.match(html, lang === 'tr' ? /Sürüyor/ : /In progress/, `${lang}: the run label is neutral`);
  }
});
test('devMode off: the owner state keeps the page\'s owner colour', (t) => {
  const dir = tmpdir(t); init(dir);
  crew(dir, ['--role', 'scout', '--job', 'A', '--state', 'owner', '--reason', 'decision']);
  assert.match(page(dir), /\.crew-line\.owner svg\{[^}]*color:var\(--you\)/);
});
test('devMode on: the strip names the roles, as before', (t) => {
  const dir = devWs(t);
  crew(dir, ['--role', 'scout', '--job', 'A', '--state', 'work']);
  const html = page(dir);
  assert.match(html, /Scout · A/);
  assert.match(html, /data-role="scout"[^>]*title="Scout"/);
});
test('the template carries the strip styles and the crew slot; an old page gets them once', (t) => {
  const { CREW_CSS } = require('../tools/tracker.js');
  const f = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'tracker', 'index.html'), 'utf8');
  assert.ok(f.includes(CREW_CSS), 'template and renderer agree');
  assert.match(f, /<main>\n<!-- crew -->\n<ol>/);
  const dir = devWs(t);
  const old = page(dir).replace(CREW_CSS + '\n', '').replace('<!-- crew -->\n', '');
  fs.writeFileSync(path.join(dir, 'index.html'), old);
  crew(dir, ['--role', 'scout', '--job', 'A', '--state', 'work']);
  crew(dir, ['--role', 'scout', '--job', 'A', '--state', 'idle']);
  const html = page(dir);
  assert.strictEqual(html.split('.crew{').length, 2, 'styles injected once');
  assert.strictEqual(html.split('<section class="crew">').length, 2, 'one strip');
  assert.ok(html.indexOf('<section class="crew">') < html.indexOf('<ol>'));
});

const row = (dir, args) => runTool('tracker.js', ['row', dir, ...args], { env: { JOSERAH_NOW: T1 } });
test('row --parent sets, clears, and refuses an unknown parent', (t) => {
  const dir = tmpdir(t); init(dir);
  row(dir, ['--title', 'Main', '--state', 'run']);
  assert.strictEqual(row(dir, ['--title', 'Sub', '--state', 'ok', '--parent', 'main ']).status, 0);
  const rows = () => JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'));
  assert.strictEqual(rows().find((r) => r.title === 'Sub').parent, 'main ');
  assert.strictEqual(row(dir, ['--title', 'Sub', '--state', 'ok', '--parent', '']).status, 0);
  assert.strictEqual(rows().find((r) => r.title === 'Sub').parent, undefined);
  const r = row(dir, ['--title', 'Sub2', '--state', 'ok', '--parent', 'Nope']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /parent "Nope" is not a row/);
  assert.ok(!rows().some((x) => x.title === 'Sub2'), 'a refused row is not written');
});
test('one level only, and not its own parent', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, [{ state: 'run', title: 'A' }, { state: 'ok', title: 'B', parent: 'A' }, { state: 'ok', title: 'C', parent: 'B' }]);
  assert.match(render(dir).stderr, /one level only/);
  setRows(dir, [{ state: 'run', title: 'A', parent: 'A' }]);
  assert.strictEqual(render(dir).status, 1);
});
test('row without --parent keeps the parent it had (only --parent "" ungroups)', (t) => {
  const dir = tmpdir(t); init(dir);
  row(dir, ['--title', 'Main', '--state', 'run']);
  row(dir, ['--title', 'Sub', '--state', 'run', '--parent', 'Main']);
  assert.strictEqual(row(dir, ['--title', 'Sub', '--state', 'ok']).status, 0);
  const sub = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8')).find((r) => r.title === 'Sub');
  assert.strictEqual(sub.parent, 'Main');
});

test('finished sub-jobs fold under their main job; active rows never fold', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, [
    { state: 'run', title: 'Main', time: '09:00' },
    { state: 'ok', title: 'Sub done 1', parent: 'Main', time: '09:10' },
    { state: 'ok', title: 'Sub done 2', parent: 'Main', time: '09:20' },
    { state: 'run', title: 'Sub running', parent: 'Main', time: '09:30' },
    { state: 'ok', title: 'Loose', time: '09:40' },
  ]);
  assert.strictEqual(render(dir).status, 0);
  const html = page(dir);
  const done = html.slice(html.indexOf('>Done<'));
  assert.match(done, /<li class="grp"><details name="trk"><summary><b>Main<\/b> 2 · In progress<\/summary><ul>[\s\S]*Sub done 2[\s\S]*Sub done 1[\s\S]*<\/ul><\/details><\/li>/);
  assert.match(done, /<li>[\s\S]*Loose/, 'a row without parent stays ungrouped');
  const run = html.slice(html.indexOf('>In progress<'), html.indexOf('>Done<'));
  assert.doesNotMatch(run, /<details/, 'active work never folds');
  assert.match(run, /<span class="par">Main<\/span>[\s\S]*Sub running/, 'an active sub-job shows its main job as a label');
  // one open at a time: top-level folds share name="trk"; a fold nested in a fold takes the next level's
  // name (trk-2, trk-3), because a same-named descendant closes its own ancestor when opened (Edge 154)
  assert.doesNotMatch(html, /<details(?![^>]*name="trk(-\d)?")/, 'every fold carries a one-open-at-a-time name');
  assert.doesNotMatch(html, /<details[^>]*\sopen/, 'closed by default');
});
test('no parent anywhere: byte-identical to the previous renderer', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, [{ state: 'run', title: 'A', time: '09:00' }, { state: 'ok', title: 'B', time: '09:05' }]);
  render(dir, '2026-10-01T09:05:00Z'); // UTC, so the page's data-t stamp is the same in every time zone
  assert.strictEqual(page(dir), fs.readFileSync(path.join(__dirname, 'fixtures', 'tracker-no-parent.html'), 'utf8'));
});
test('groups inside the waiting and plans folds: details.sub, main in the same section heads the fold', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, [
    { state: 'wait', title: 'W main', time: '08:00' },
    { state: 'wait', title: 'W sub', parent: 'W main', time: '08:10' },
    { state: 'plan', title: 'P sub', parent: 'Done main', group: 'Alpha', time: '08:00' },
    { state: 'plan', title: 'P loose', group: 'Alpha', time: '08:00' },
    { state: 'ok', title: 'Done main', time: '07:00' },
    { state: 'ok', title: 'Done sub', parent: 'Done main', time: '07:30' },
    { state: 'you', title: 'Ask', parent: 'Done main', time: '07:40' },
  ]);
  assert.strictEqual(render(dir).status, 0, render(dir).stderr);
  const html = page(dir);
  const folds = html.match(/<section class="folds">([\s\S]*?)<\/section>/)[1];
  assert.match(folds, /<details name="trk"><summary>Waiting 2<\/summary><ul>\n  <li class="grp"><details class="sub" name="trk-2"><summary><b>W main<\/b> 1<\/summary><ul>[\s\S]*<b>W main<\/b>[\s\S]*<b>W sub<\/b>/);
  assert.match(folds, /<details class="sub" name="trk-2"><summary>Alpha 2<\/summary><ul>\n  <li class="grp"><details class="sub" name="trk-3"><summary><b>Done main<\/b> 1 · Done<\/summary>/);
  const done = html.slice(html.indexOf('>Done<'));
  assert.match(done, /<li class="grp"><details name="trk"><summary><b>Done main<\/b> 1<\/summary><ul>[\s\S]*<b>Done main<\/b>[\s\S]*<b>Done sub<\/b>/);
  assert.match(html, /<span class="par">Done main<\/span><b>Ask<\/b>/);
  assert.match(html, /\.grp summary b\{/, 'group styles injected once a group shows');
  render(dir);
  assert.strictEqual(page(dir).split('.grp summary b{').length, 2, 'once');
});
