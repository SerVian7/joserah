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
const lis = (dir) => page(dir).match(/<li data-st="[\s\S]*?<\/li>/g) || [];
// one section's block by its key (run, you, wait, plan, ok)
const blockOf = (html, k) => (html.match(new RegExp(`<div class="blk" data-k="${k}">[\\s\\S]*?</div></li>`)) || [''])[0];
// section heads, e.g. "Done 3": the label and its row count
const heads = (html) => (html.match(/<div class="hd">[^<]*<span>\d+<\/span>/g) || []).map((s) => s.replace(/<[^>]+>/g, '').trim());

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

// Section order (owner, 2026-10-05, "Sorunun cevabı A evet."): active work first — in progress (agent
// working in developer mode), then owner — then waiting, plans and done, all in the one list; this
// replaces the 2026-10-03 rule that put waiting and plans at the top.
test('sections: in progress, owner, waiting, plans, done, in that order; empty section has none', (t) => {
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
  const html = page(dir);
  assert.deepStrictEqual(heads(html), ['In progress 1', 'Owner 1', 'Waiting 1', 'Plans 1', 'Done 1'], 'outside a workspace developer mode is off');
  assert.deepStrictEqual(lis(dir).map((l) => l.match(/class="s (\w+)"/)[1]), ['run', 'you', 'wait', 'plan', 'ok']);
  assert.doesNotMatch(html, /<section class="pl">/, 'no section above the list any more');
  assert.doesNotMatch(html, /<details/, 'waiting and plans are open sections, never a closed fold');
  assert.strictEqual((html.match(/<li class="sec">/g) || []).length, 5);
  render(dir);
  assert.strictEqual(page(dir), html.replace(/data-t="[^"]*"/, page(dir).match(/data-t="[^"]*"/)[0]), 'a re-render is stable');
  setRows(dir, [{ state: 'ok', title: 'D', time: '08:00' }, { state: 'plan', title: 'P', time: '08:00' }]);
  render(dir);
  assert.deepStrictEqual(heads(page(dir)), ['Plans 1', 'Done 1']);
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

test('bytes outside <main> and the stamp stay identical across renders', (t) => {
  const dir = tmpdir(t);
  init(dir);
  const strip = (h) => h.replace(/<main>[\s\S]*<\/main>/, '<main></main>').replace(/data-t="[^"]*"/, 'data-t=""');
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

test('plans with a group: one flat open list, newest first, the group in the small line', (t) => {
  const dir = tmpdir(t);
  init(dir);
  setRows(dir, [
    { state: 'plan', title: 'P1', group: 'Alpha', time: '08:00' },
    { state: 'plan', title: 'P2', group: 'Beta', small: 'note', time: '09:00' },
    { state: 'plan', title: 'P3', group: 'Alpha', time: '08:00' },
    { state: 'plan', title: 'P4', time: '07:00' },
  ]);
  render(dir);
  const top = blockOf(page(dir), 'plan');
  assert.deepStrictEqual(heads(top), ['Plans 4']);
  assert.doesNotMatch(top, /<details/);
  assert.deepStrictEqual((top.match(/<b>\w+<\/b>/g) || []).map((s) => s.slice(3, -4)), ['P2', 'P1', 'P3', 'P4']);
  assert.match(top, /<b>P2<\/b><small>Beta · note<\/small>/);
  assert.match(top, /<b>P1<\/b><small>Alpha<\/small>/);
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
  // the strip's own styles carry its pulse keyframes (the console style adds layout rules for .crew too)
  assert.strictEqual(html.split('@keyframes crew-pulse').length, 2, 'styles injected once');
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
// Task 3.8 — console look and long lists (owner, 2026-10-05: no cards, an admin console; a main job is a
// container; lists are never fully closed, a long one shows its first rows and opens in place)
const { CONSOLE_CSS, CLIP_JS } = require('../tools/tracker.js');
const radii = (h) => [...h.matchAll(/border-radius:([^;}]*)/g)].map((m) => m[1].trim());
const shadows = (h) => [...h.matchAll(/box-shadow:([^;}]*)/g)].map((m) => m[1].trim());
test('console look: no rounded corners and no shadows, a page made before it included', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, [{ state: 'run', title: 'A', time: '09:00' }, { state: 'ok', title: 'B', time: '09:05' }]);
  render(dir);
  assert.deepStrictEqual([...new Set(radii(page(dir)))], ['0']);
  assert.deepStrictEqual([...new Set(shadows(page(dir)))], ['none']);
  fs.writeFileSync(path.join(dir, 'index.html'), page(dir).replace('</style>', 'li{border-radius:8px;box-shadow:0 1px 2px var(--line)}.x{border-radius:4px}\n</style>'));
  render(dir);
  assert.deepStrictEqual([...new Set(radii(page(dir)))], ['0'], 'an older radius is stripped');
  assert.deepStrictEqual([...new Set(shadows(page(dir)))], ['none'], 'an older shadow is stripped');
  assert.strictEqual(page(dir).split('<style id="console">').length, 2, 'one console style');
  assert.strictEqual(page(dir).split('<script id="clip">').length, 2, 'one clamp script');
});
test('a main job with sub-jobs is a container; only a finished container folds', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, [
    { state: 'run', title: 'Main', time: '09:00' },
    { state: 'ok', title: 'Sub done 1', parent: 'Main', time: '09:10' },
    { state: 'ok', title: 'Sub done 2', parent: 'Main', time: '09:20' },
    { state: 'run', title: 'Sub running', parent: 'Main', time: '09:30' },
    { state: 'you', title: 'Ask', parent: 'Main', time: '09:35' },
    { state: 'ok', title: 'Loose', time: '09:40' },
  ]);
  assert.strictEqual(render(dir).status, 0);
  const html = page(dir);
  const sec = (k) => html.match(new RegExp(`<div class="blk" data-k="${k}">([\\s\\S]*?)</div></li>`))[1];
  // same section: the main row heads its container; header line + indented children
  assert.match(sec('run'), /<li class="job"><div class="jh"><span class="jt">Main<\/span><span>1 · 09:30<\/span><\/div><ol><li data-st="run">[\s\S]*<b>Sub running<\/b>[\s\S]*<\/ol><\/li>/);
  assert.doesNotMatch(sec('run'), /<b>Main<\/b>/, 'the main row is the header, not a row as well');
  // another section: the header carries the main job's state
  assert.match(sec('you'), /<li class="job"><div class="jh"><span class="jt">Main <em>· In progress<\/em><\/span><span>1 · 09:35<\/span><\/div><ol><li data-st="you">/);
  assert.match(sec('ok'), /<li class="grp"><details name="trk"><summary><span class="jt">Main <em>· In progress<\/em><\/span><span>2 · 09:20<\/span><\/summary><ol>[\s\S]*Sub done 2[\s\S]*Sub done 1[\s\S]*<\/ol><\/details><\/li>/);
  assert.match(sec('ok'), /<li data-st="ok">[\s\S]*Loose/, 'a row without parent stays a row');
  assert.ok(sec('ok').indexOf('Loose') < sec('ok').indexOf('class="grp"'), 'the container sorts by its newest row (done: newest first)');
  for (const k of ['run', 'you']) assert.doesNotMatch(sec(k), /<details/, `${k}: active work never folds`);
  assert.doesNotMatch(html, /<details(?![^>]*name="trk")/, 'one open at a time');
  assert.doesNotMatch(html, /<details[^>]*\sopen/, 'closed by default');
});
test('waiting and plans are open sections; their containers never fold', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, [
    { state: 'wait', title: 'W main', time: '08:00' },
    { state: 'wait', title: 'W sub', parent: 'W main', time: '08:10' },
    { state: 'plan', title: 'P sub', parent: 'Done main', group: 'Alpha', time: '08:00' },
    { state: 'ok', title: 'Done main', time: '07:00' },
  ]);
  render(dir);
  const top = blockOf(page(dir), 'wait') + blockOf(page(dir), 'plan');
  assert.doesNotMatch(top, /<details/);
  assert.match(top, /<li class="job"><div class="jh"><span class="jt">W main<\/span><span>1 · 08:10<\/span><\/div><ol><li data-st="wait">[\s\S]*<b>W sub<\/b>/);
  assert.match(top, /<li class="job"><div class="jh"><span class="jt">Done main <em>· Done<\/em><\/span>/);
});
test('a long list shows its first rows: more than five items get a button and a fade, five do not', (t) => {
  const dir = tmpdir(t); init(dir);
  const n = (k, state) => [...Array(k)].map((_, i) => ({ state, title: `${state} ${i}`, time: `08:0${i}` }));
  setRows(dir, [...n(6, 'ok'), ...n(5, 'plan'), ...n(7, 'run'), ...n(7, 'you'), ...n(6, 'wait')]);
  render(dir);
  const html = page(dir);
  const blk = (k) => html.match(new RegExp(`<div class="blk" data-k="${k}">[\\s\\S]*?</ol></div>(<div class="fade"[^>]*></div><button[^>]*>[^<]*</button>)?</div>`));
  for (const k of ['ok', 'wait']) {
    assert.match(blk(k)[0], new RegExp(`<div class="clip clamp" id="clip-${k}">`), k);
    assert.match(blk(k)[1] || '', new RegExp(`<div class="fade" aria-hidden="true"></div><button type="button" class="more" aria-expanded="false" aria-controls="clip-${k}"[^>]*>all \\(\\d+\\)</button>`), k);
  }
  for (const k of ['plan', 'run', 'you']) {
    assert.ok(!blk(k)[1], `${k}: no button`);
    assert.match(blk(k)[0], new RegExp(`<div class="clip" id="clip-${k}">`), `${k}: not clamped`);
  }
  // a container counts as one item
  setRows(dir, [...n(4, 'ok'), { state: 'ok', title: 'M', time: '07:00' }, ...[1, 2, 3].map((i) => ({ state: 'ok', title: `s${i}`, parent: 'M', time: `07:1${i}` }))]);
  render(dir);
  assert.doesNotMatch(page(dir), /class="more"/);
  assert.doesNotMatch(page(dir), /class="fade"/);
});
test('tr: the button reads tümü and daralt', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [...Array(6)].map((_, i) => ({ state: 'ok', title: `d${i}`, time: `08:0${i}` })));
  render(dir);
  assert.match(page(dir), /data-label="tümü \(6\)" data-less="daralt">tümü \(6\)<\/button>/);
});
test('the clamp transition runs only without reduced motion', () => {
  const m = CONSOLE_CSS.match(/@media \(prefers-reduced-motion: no-preference\)\{([^@]*?)\}\}/);
  assert.ok(m, 'a no-preference block');
  assert.match(m[1], /\.clip\.clamp\{transition:max-height/);
  assert.doesNotMatch(CONSOLE_CSS.replace(m[0], ''), /transition/, 'no transition outside it');
});
test('the template carries the console style and the clamp script; a re-render is byte-stable', (t) => {
  const f = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'tracker', 'index.html'), 'utf8');
  assert.ok(f.includes(`<style id="console">\n${CONSOLE_CSS}\n</style>`), 'template and renderer agree (style)');
  assert.ok(f.includes(`<script id="clip">${CLIP_JS}</script>\n</body>`), 'template and renderer agree (script)');
  const dir = tmpdir(t); init(dir);
  const fresh = page(dir);
  render(dir, '2026-10-01T09:05:00Z');
  const once = page(dir);
  render(dir, '2026-10-01T09:05:00Z');
  assert.strictEqual(page(dir), once);
  const outside = (h) => h.replace(/<main>[\s\S]*<\/main>/, '').replace(/data-t="[^"]*"/, '');
  assert.strictEqual(outside(once), outside(fresh), 'only <main> and the stamp change');
});
test('crew --model --effort --ctx: a faint tail in developer mode; ctx only with its time; none when off', (t) => {
  const dir = devWs(t);
  assert.strictEqual(crew(dir, ['--role', 'builder', '--job', 'A', '--state', 'work', '--model', 'opus', '--effort', 'high', '--ctx', '84213']).status, 0);
  let html = page(dir);
  assert.match(html, /<span>Builder · A <small class="cm" title="opus · high · 84k @09:05">opus · high<i> · 84k @09:05<\/i><\/small><\/span>/);
  crew(dir, ['--role', 'builder', '--job', 'A', '--state', 'idle']);
  const e = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8')).crew[0];
  assert.deepStrictEqual([e.model, e.effort, e.ctx, e.ctxTime, e.state], ['opus', 'high', 84213, '09:05', 'idle'], 'model, effort and ctx carry over');
  // a context figure without the time it was reported is never shown
  const store = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'));
  store.crew = [{ role: 'scout', job: 'B', state: 'work', ctx: 5000, time: '09:00' }, { role: 'scout', job: 'C', state: 'work', model: 'sonnet', ctx: 7000, time: '09:00' }];
  fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(store));
  render(dir);
  html = page(dir);
  assert.match(html, /<span>Scout · B<\/span>/, 'ctx alone: no tail');
  assert.match(html, /<span>Scout · C <small class="cm" title="sonnet">sonnet<\/small><\/span>/);
  assert.doesNotMatch(html, /7k|5k/);
  for (const bad of [['--effort', 'extreme'], ['--ctx', 'many'], ['--ctx', '0'], ['--model', 'a b']]) {
    assert.strictEqual(crew(dir, ['--role', 'scout', '--job', 'D', '--state', 'work', ...bad]).status, 1, bad.join(' '));
  }
  const off = tmpdir(t); init(off);
  crew(off, ['--role', 'builder', '--job', 'A', '--state', 'work', '--model', 'opus', '--effort', 'high', '--ctx', '84213']);
  assert.doesNotMatch(page(off), /class="cm"|opus|84k/, 'developer mode off: no tail');
});
test('no parent anywhere: byte-identical to the fixture', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, [{ state: 'run', title: 'A', time: '09:00' }, { state: 'ok', title: 'B', time: '09:05' }]);
  render(dir, '2026-10-01T09:05:00Z'); // UTC, so the page's data-t stamp is the same in every time zone
  assert.strictEqual(page(dir), fs.readFileSync(path.join(__dirname, 'fixtures', 'tracker-no-parent.html'), 'utf8'));
});
test('crew --agent: stored as agent, kept when the entry is updated without it, never shown', (t) => {
  const dir = devWs(t);
  assert.strictEqual(crew(dir, ['--role', 'scout', '--job', 'DOTS research', '--state', 'work', '--agent', 'a1b2c3']).status, 0);
  crew(dir, ['--role', 'scout', '--job', 'dots research', '--state', 'owner', '--reason', 'approval']);
  const e = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8')).crew;
  assert.strictEqual(e.length, 1);
  assert.deepStrictEqual([e[0].agent, e[0].state], ['a1b2c3', 'owner']);
  assert.doesNotMatch(page(dir), /a1b2c3/, 'an agent id is a handle, not page text');
  assert.strictEqual(crew(dir, ['--role', 'scout', '--job', 'X', '--state', 'work', '--agent', 'bad id!']).status, 1);
});
