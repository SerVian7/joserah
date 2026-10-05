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
  // active work (run) is the strip above the list, not a section of it (owner, 2026-10-05: "hepsini iki kere listelemiş olmayız")
  assert.deepStrictEqual(heads(html), ['Active work 1', 'Owner 1', 'Waiting 1', 'Plans 1', 'Done 1']);
  assert.deepStrictEqual(lis(dir).map((l) => l.match(/class="s (\w+)"/)[1]), ['you', 'wait', 'plan', 'ok']);
  assert.doesNotMatch(html, /<section class="pl">/, 'no section above the list any more');
  assert.doesNotMatch(html, /<details/, 'waiting and plans are open sections, never a closed fold');
  assert.strictEqual((html.match(/<li class="sec">/g) || []).length, 4);
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
  for (const w of ['Aktif çalışma', 'Sizde', 'Beklemede', 'Bitenler', 'Planlar', 'Bitti', 'Plan', '>sayfa<']) assert.ok(p.includes(w), w);
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

// Owner, 2026-10-05: "Ajan çalışıyor, kısmını aktif çalışma gibi yapalım" — one name in every mode.
test('the running work is "Active work" / "Aktif çalışma" in both modes', (t) => {
  const ws = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', ws, '--workspace', 'w', '--owner', 'A B']);
  const dir = path.join(ws, '.joserah', 'desk', 'artifacts', 'd', 'tracker');
  const tr = path.join(ws, '.joserah', 'desk', 'artifacts', 'd', 'tracker-tr');
  init(dir); init(tr, ['--lang', 'tr']);
  for (const d of [dir, tr]) setRows(d, [{ state: 'run', title: 'Research' }]);
  const p = path.join(ws, '.joserah', 'config.json');
  for (const dev of [false, true]) {
    fs.writeFileSync(p, JSON.stringify({ ...JSON.parse(fs.readFileSync(p, 'utf8')), devMode: dev }));
    render(dir); render(tr);
    assert.deepStrictEqual(heads(page(dir)), ['Active work 1'], `dev ${dev}`);
    assert.deepStrictEqual(heads(page(tr)), ['Aktif çalışma 1'], `dev ${dev}`);
    for (const d of [dir, tr]) assert.doesNotMatch(page(d), /Agent working|In progress|Ajan çalışıyor|Sürüyor/, `dev ${dev}`);
  }
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
  assert.match(html, /<span class="ic"><span title="Scout">/, 'the role is the icon\'s title');
  assert.doesNotMatch(html, /Scout · A/, 'never in the line text');
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
    assert.match(html, /<button type="button" class="tx" aria-expanded="false" aria-controls="cd-\d+">DOTS araştırması<\/button>/, 'a line is the work only');
    assert.doesNotMatch(html, ROLE_WORDS, `${lang}: no role name`);
    assert.doesNotMatch(html, /ajan|agent/i, `${lang}: no agent wording`);
    assert.match(html, lang === 'tr' ? /Aktif çalışma/ : /Active work/, `${lang}: the run label is neutral`);
  }
});
test('devMode off: the owner state keeps the page\'s owner colour', (t) => {
  const dir = tmpdir(t); init(dir);
  crew(dir, ['--role', 'scout', '--job', 'A', '--state', 'owner', '--reason', 'decision']);
  assert.match(page(dir), /\.crew-line\.owner svg\{[^}]*color:var\(--you\)/);
});
test('devMode on: the role shows only as the icon\'s title', (t) => {
  const dir = devWs(t);
  crew(dir, ['--role', 'scout', '--job', 'A', '--state', 'work']);
  const html = page(dir);
  assert.match(html, /<span class="ic"><span title="Scout"><svg/);
  assert.match(html, /class="tx" aria-expanded="false" aria-controls="cd-\d+">A<\/button>/);
  assert.doesNotMatch(html, /Scout · /);
  assert.match(html, /data-role="scout"[^>]*title="Scout"/, 'the summary icon keeps its title');
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
  // running rows are strip lines: the main job's own line, and the sub-job under its category (the main job)
  assert.ok(!html.includes('data-k="run"'), 'no running section in the list');
  assert.match(html, /class="tx" aria-expanded="false" aria-controls="cd-\d+">Main<\/button>/);
  assert.match(html, /class="tx" aria-expanded="false" aria-controls="cd-\d+"><span class="ct">Main ·<\/span> Sub running<\/button>/);
  // another section: the header carries the main job's state
  assert.match(sec('you'), /<li class="job"><div class="jh"><span class="jt">Main <em>· Active work<\/em><\/span><span>1 · 09:35<\/span><\/div><ol><li data-st="you">/);
  assert.match(sec('ok'), /<li class="grp"><details name="trk"><summary><span class="jt">Main <em>· Active work<\/em><\/span><span>2 · 09:20<\/span><\/summary><ol>[\s\S]*Sub done 2[\s\S]*Sub done 1[\s\S]*<\/ol><\/details><\/li>/);
  assert.match(sec('ok'), /<li data-st="ok">[\s\S]*Loose/, 'a row without parent stays a row');
  assert.ok(sec('ok').indexOf('Loose') < sec('ok').indexOf('class="grp"'), 'the container sorts by its newest row (done: newest first)');
  assert.doesNotMatch(sec('you'), /<details/, 'active work never folds');
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
  assert.doesNotMatch(html.match(/<section class="crew">[\s\S]*?<\/section>/)[0], /class="(more|fade)"/, 'the strip never clamps');
  for (const k of ['plan', 'you']) {
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
  assert.match(html, /class="tx" aria-expanded="false" aria-controls="cd-\d+">A <small class="cm" title="opus · high · 84k @09:05">opus · high<i> · 84k @09:05<\/i><\/small><\/button>/);
  crew(dir, ['--role', 'builder', '--job', 'A', '--state', 'idle']);
  const e = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8')).crew[0];
  assert.deepStrictEqual([e.model, e.effort, e.ctx, e.ctxTime, e.state], ['opus', 'high', 84213, '09:05', 'idle'], 'model, effort and ctx carry over');
  // a context figure without the time it was reported is never shown
  const store = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'));
  store.crew = [{ role: 'scout', job: 'B', state: 'work', ctx: 5000, time: '09:00' }, { role: 'scout', job: 'C', state: 'work', model: 'sonnet', ctx: 7000, time: '09:00' }];
  fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(store));
  render(dir);
  html = page(dir);
  assert.match(html, /class="tx" aria-expanded="false" aria-controls="cd-\d+">B<\/button>/, 'ctx alone: no tail');
  assert.match(html, /class="tx" aria-expanded="false" aria-controls="cd-\d+">C <small class="cm" title="sonnet">sonnet<\/small><\/button>/);
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

// Owner, 2026-10-05, at 12:29 looking at the strip: "10 dk dır hiçbir şey olmadı mı abi?" The page's
// "updated" stamp moves on every render that changes anything, the strip included; each working or
// waiting strip entry shows, in the page, how long it has been in that state.
const crewAt = (dir, now, args) => runTool('tracker.js', ['crew', dir, ...args], { env: { JOSERAH_NOW: now } });
const T3 = '2026-10-01T17:55:00';
const store = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'));
test('the updated stamp moves on a crew-only update', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, [{ state: 'run', title: 'A', time: '09:00' }]);
  render(dir, T1);
  assert.match(page(dir), new RegExp(`data-t="${new Date(T1).toISOString()}"`));
  assert.strictEqual(crewAt(dir, T2, ['--role', 'scout', '--job', 'B', '--state', 'work']).status, 0);
  assert.match(page(dir), new RegExp(`data-t="${new Date(T2).toISOString()}"`), 'a crew-only change moves the stamp');
});
test('crew since: set when the state changes, kept on an update that keeps the state', (t) => {
  const dir = tmpdir(t); init(dir);
  const ISO = (s) => new Date(s).toISOString();
  crewAt(dir, T1, ['--role', 'scout', '--job', 'A', '--state', 'work']);
  assert.strictEqual(store(dir).crew[0].since, ISO(T1), 'a new entry starts now');
  crewAt(dir, T2, ['--role', 'scout', '--job', 'A', '--state', 'work', '--url', 'https://example.com/x']);
  assert.strictEqual(store(dir).crew[0].since, ISO(T1), 'same state: the time counts from when it began');
  assert.strictEqual(store(dir).crew[0].time, '17:40', 'the edit time still moves');
  crewAt(dir, T3, ['--role', 'scout', '--job', 'A', '--state', 'owner', '--reason', 'approval']);
  assert.strictEqual(store(dir).crew[0].since, ISO(T3), 'a state change restarts it');
  // a hand edit that changes the state in rows.json restarts it on the next render too
  const s = store(dir); s.crew[0].state = 'work'; fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(s));
  render(dir, '2026-10-01T18:10:00');
  assert.strictEqual(store(dir).crew[0].since, ISO('2026-10-01T18:10:00'));
  // an entry written before `since` existed starts at its own time, never later than now
  const s2 = store(dir); s2.crew.push({ role: 'lead', job: 'Old', state: 'work', time: '09:00' }, { role: 'lead', job: 'Ahead', state: 'work', time: '23:59' });
  fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(s2));
  render(dir, '2026-10-01T18:10:00');
  const c = store(dir).crew;
  assert.strictEqual(c[1].since, ISO('2026-10-01T09:00:00'));
  assert.strictEqual(c[2].since, ISO('2026-10-01T18:10:00'), 'a time ahead of the clock is not trusted');
});
test('elapsed: working and waiting strip lines carry data-since and one inline script; idle and no-crew pages none', (t) => {
  const { SINCE_JS } = require('../tools/tracker.js');
  for (const dev of [true, false]) {
    const dir = dev ? devWs(t) : (() => { const d = tmpdir(t); init(d, ['--lang', 'tr']); return d; })();
    crewAt(dir, T1, ['--role', 'scout', '--job', 'A', '--state', 'work']);
    crewAt(dir, T1, ['--role', 'scout', '--job', 'B', '--state', 'owner', '--reason', 'decision']);
    crewAt(dir, T1, ['--role', 'builder', '--job', 'C', '--state', 'idle']);
    render(dir, T2);
    const html = page(dir);
    const iso = new Date(T1).toISOString();
    assert.match(html, new RegExp(`class="crew-line work"[^\n]*<time data-since="${iso}">09:05</time>`), `dev ${dev}: work`);
    assert.match(html, new RegExp(`class="crew-line owner"[^\n]*<time data-since="${iso}">09:05</time>`), `dev ${dev}: owner`);
    assert.match(html, /class="crew-line idle"[^\n]*<time>09:05<\/time>/, `dev ${dev}: idle has no elapsed`);
    assert.strictEqual(html.split('<script id="since">').length, 2, 'one script');
    assert.ok(html.includes(`<script id="since">${SINCE_JS}</script>`));
    if (!dev) assert.doesNotMatch(html, ROLE_WORDS, 'off: still no role name');
  }
  const plain = tmpdir(t); init(plain);
  setRows(plain, [{ state: 'run', title: 'A', time: '09:00' }]);
  render(plain);
  assert.doesNotMatch(page(plain), /data-since|id="since"/, 'nothing to tick, no script');
});
test('elapsed text: az önce / just now, minutes, hours and minutes; ticks every 30 s; text only', () => {
  const vm = require('vm');
  const { SINCE_JS } = require('../tools/tracker.js');
  assert.doesNotMatch(SINCE_JS, /animation|transition|requestAnimationFrame/, 'no motion');
  const at = Date.parse('2026-10-01T12:00:00Z');
  const run = (lang, mins, owner) => {
    const el = { textContent: '11:00', title: '', getAttribute: () => new Date(at - mins * 60000).toISOString(),
      parentNode: { classList: { contains: (c) => c === (owner ? 'owner' : 'work') } } };
    let every = 0;
    class D extends Date { static now() { return at; } }
    vm.runInNewContext(SINCE_JS, { Date: D, setInterval: (f, ms) => { every = ms; },
      document: { documentElement: { lang }, querySelectorAll: () => [el] } });
    return { text: el.textContent, title: el.title, every };
  };
  assert.deepStrictEqual(run('tr', 7, false), { text: "7 dk'dır sürüyor", title: '11:00', every: 30000 });
  assert.strictEqual(run('tr', 12, true).text, "12 dk'dır sizi bekliyor");
  assert.strictEqual(run('tr', 0.5, false).text, 'az önce');
  assert.strictEqual(run('tr', 65, false).text, "1 sa 5 dk'dır sürüyor");
  assert.strictEqual(run('en', 7, false).text, 'running 7 min');
  assert.strictEqual(run('en', 12, true).text, 'waiting on you 12 min');
  assert.strictEqual(run('en', 0, true).text, 'just now');
  assert.strictEqual(run('en', 65, true).text, 'waiting on you 1 h 5 min');
  assert.strictEqual(run('en', -3, false).text, 'just now', 'a start ahead of the clock reads as just now');
});

// Owner, 2026-10-05: "Ajan çalışıyor, kısmını aktif çalışma gibi yapalım ben yukarıdan tıklayınca aşağıyı
// doldursun bence. hepsini iki kere listelemiş olmayız ayrıca yukarıdaki başlıklar daha anlaşılır, önce işin
// kategori ismi sonra kısa özet gibi. net yalın olsun." The strip is the one list of running work; a line
// reads "<category> · <summary>"; clicking it opens its detail in one panel under the strip.
const stripOf = (html) => (html.match(/<section class="crew">[\s\S]*?<\/section>/) || [''])[0];
const linesOf = (html) => stripOf(html).match(/<li class="crew-line[\s\S]*?<\/li>/g) || [];
test('active work: run rows are listed once, in the strip, never in the list', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [
    { state: 'run', title: 'R one', time: '09:00' },
    { state: 'run', title: 'R two', small: 'note · sonraki: x', time: '08:00' },
    { state: 'you', title: 'Y', time: '08:30' },
  ]);
  render(dir);
  const html = page(dir);
  assert.doesNotMatch(html, /<li data-st="run"/, 'no run row in the list');
  assert.deepStrictEqual(heads(html), ['Aktif çalışma 2', 'Sizde 1']);
  const ls = linesOf(html);
  assert.strictEqual(ls.length, 2);
  for (const r of ['R one', 'R two']) assert.strictEqual(ls.filter((l) => l.includes(r)).length, 1, r);
  assert.ok(ls[0].includes('R two'), 'oldest first');
  assert.ok(html.indexOf('<section class="crew">') < html.indexOf('<ol>'), 'the strip is above the list');
  // a run row with no crew entry: a line without an icon, so nothing running is hidden
  assert.strictEqual(ls[1], '<li class="crew-line run"><span class="ic"></span><button type="button" class="tx" aria-expanded="false" aria-controls="cd-2">R one</button><time>09:00</time></li>');
  assert.match(stripOf(html), /<div class="cd bare" id="cd-2"><b>R one<\/b><\/div>/, 'nothing more to show: the panel shows the title');
  assert.match(ls[0], /<button type="button" class="tx" aria-expanded="false" aria-controls="cd-1">R two<\/button>/, 'a row with a detail opens it');
});
test('crew --row: category and summary from the row, one detail panel, one line per row', (t) => {
  const dir = devWs(t);
  fs.writeFileSync(path.join(dir, 'index.html'), page(dir).replace('<html lang="en">', '<html lang="tr">'));
  setRows(dir, [
    { state: 'run', title: 'Zenger', time: '08:00' },
    { state: 'run', title: "Sinan Bey'e cevap", parent: 'Zenger', small: 'kısa taslak hazır · sonraki: siz gönderin', url: 'https://example.com/d', label: 'taslak', time: '09:00' },
    { state: 'run', title: 'Loose', time: '09:30' },
  ]);
  assert.strictEqual(crew(dir, ['--role', 'lead', '--job', 'Zenger işleri', '--state', 'work', '--row', "sinan bey'e cevap ", '--model', 'opus', '--effort', 'medium']).status, 0);
  assert.strictEqual(crew(dir, ['--role', 'builder', '--job', 'Mail taslağı', '--state', 'work', '--row', "Sinan Bey'e cevap", '--url', 'https://example.com/r']).status, 0);
  crew(dir, ['--role', 'scout', '--job', 'Kendi işi', '--state', 'work']);
  assert.strictEqual(store(dir).crew[0].row, "sinan bey'e cevap ");
  crew(dir, ['--role', 'lead', '--job', 'Zenger işleri', '--state', 'owner', '--reason', 'decision']);
  assert.strictEqual(store(dir).crew[0].row, "sinan bey'e cevap ", 'the row carries over');
  const html = page(dir);
  const ls = linesOf(html);
  assert.strictEqual(ls.length, 4, 'Sinan (two entries, one line), Kendi işi, Zenger, Loose');
  assert.strictEqual(ls.filter((l) => l.includes('Sinan')).length, 1, 'one row, one line');
  const sinan = ls.find((l) => l.includes('Sinan'));
  assert.match(sinan, /^<li class="crew-line owner" data-role="lead"><span class="ic"><span title="Lead"><svg[\s\S]*?<\/svg><\/span><span title="Builder"><svg/);
  assert.match(sinan, /<button type="button" class="tx" aria-expanded="false" aria-controls="cd-1"><span class="ct">Zenger ·<\/span> Sinan Bey'e cevap/);
  assert.match(sinan, /<em>karar<\/em>/);
  assert.match(sinan, /class="cm" title="opus · medium">opus · medium</);
  // the entry with no row: its own job, no detail, no button
  assert.match(ls.find((l) => l.includes('Kendi')), /class="tx" aria-expanded="false" aria-controls="cd-\d+">Kendi işi<\/button>/);
  // the detail: small text, next step, links (the row's and the entries'), in one panel under the lines
  const s = stripOf(html);
  assert.ok(s.indexOf('<div class="crew-d">') > s.indexOf('</ul>'), 'the panel is under the lines');
  const cd = (s.match(/<div class="cd" id="cd-1">[\s\S]*?<\/div>/) || [''])[0];
  assert.match(cd, /<p>kısa taslak hazır<\/p>/);
  assert.match(cd, /<p class="nx"><span>sonraki<\/span> siz gönderin<\/p>/);
  assert.match(cd, /<a href="https:\/\/example\.com\/d"[^>]*>taslak<\/a>/);
  assert.match(cd, /<a href="https:\/\/example\.com\/r"[^>]*>sayfa<\/a>/);
  assert.doesNotMatch(s, /\shidden/, 'without script every detail shows');
  // every button controls a detail that exists, once
  const ctl = [...s.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ctl.length >= 1);
  for (const id of ctl) assert.strictEqual(html.split(`id="${id}"`).length, 2, id);
  // a running row with no crew entry still shows
  assert.ok(ls.some((l) => /<span class="ic"><\/span><button type="button" class="tx" aria-expanded="false" aria-controls="cd-\d+">Loose<\/button>/.test(l)));
  assert.strictEqual(html.split('<script id="panel">').length, 2, 'one panel script');
  render(dir);
  assert.strictEqual(page(dir).split('<script id="panel">').length, 2, 'still one after a re-render');
  // a row that does not exist is refused; --row "" clears
  assert.strictEqual(crew(dir, ['--role', 'scout', '--job', 'Kendi işi', '--state', 'work', '--row', 'Nope']).status, 1);
  assert.strictEqual(crew(dir, ['--role', 'lead', '--job', 'Zenger işleri', '--state', 'work', '--row', '']).status, 0);
  assert.strictEqual(store(dir).crew[0].row, undefined);
});
test('devMode off: no role name in a mapped strip line or its detail', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [{ state: 'run', title: 'Fiyat', parent: 'Dell', small: 'a · sonraki: b', time: '09:00' }, { state: 'ok', title: 'Dell', time: '08:00' }]);
  crew(dir, ['--role', 'scout', '--job', 'Fiyat taraması', '--state', 'work', '--row', 'Fiyat', '--model', 'opus', '--effort', 'high']);
  const html = page(dir);
  assert.match(stripOf(html), /<span class="ct">Dell ·<\/span> Fiyat/);
  assert.match(stripOf(html), /<span class="ic"><span><svg/, 'the icon stays, untitled');
  assert.doesNotMatch(html, ROLE_WORDS);
  assert.doesNotMatch(html, /ajan|agent/i);
  assert.doesNotMatch(stripOf(html), /class="cm"|opus/, 'no model tail');
  assert.match(stripOf(html), /<time data-since="[^"]+">/, 'elapsed stays');
});
test('the panel script: one detail open at a time, aria-expanded follows, hidden otherwise', () => {
  const vm = require('vm');
  const { PANEL_JS } = require('../tools/tracker.js');
  assert.ok(PANEL_JS, 'exported');
  const ds = { 'cd-1': { hidden: false }, 'cd-2': { hidden: false } };
  const btn = (id) => { const a = { 'aria-controls': id, 'aria-expanded': 'false' }; return { getAttribute: (k) => a[k], setAttribute: (k, v) => { a[k] = v; }, closest() { return this; } }; };
  const bs = [btn('cd-1'), btn('cd-2')];
  let onClick = null; const cls = new Set();
  const sec = { classList: { add: (c) => cls.add(c) }, querySelectorAll: () => bs, addEventListener: (ev, f) => { if (ev === 'click') onClick = f; } };
  vm.runInNewContext(PANEL_JS, { document: { querySelector: () => sec, getElementById: (id) => ds[id] } });
  assert.ok(cls.has('js'));
  assert.deepStrictEqual([ds['cd-1'].hidden, ds['cd-2'].hidden], [true, true], 'with script, all closed at first');
  onClick({ target: bs[0] });
  assert.deepStrictEqual([bs[0].getAttribute('aria-expanded'), ds['cd-1'].hidden, ds['cd-2'].hidden], ['true', false, true]);
  onClick({ target: bs[1] });
  assert.deepStrictEqual([bs[0].getAttribute('aria-expanded'), bs[1].getAttribute('aria-expanded'), ds['cd-1'].hidden, ds['cd-2'].hidden], ['false', 'true', true, false], 'one open at a time');
  onClick({ target: bs[1] });
  assert.deepStrictEqual([bs[1].getAttribute('aria-expanded'), ds['cd-2'].hidden], ['false', true], 'a second click closes it');
  assert.doesNotMatch(PANEL_JS, /scroll|focus\(/, 'no page jump, focus stays');
});

// Lead, 2026-10-05, after the owner could not click a waiting line ("onay"): every strip line is a
// control. A row opens its panel; no row but a url is the link itself; neither opens a panel with the
// job text; a line waiting on the owner leads its panel with the link to where it is decided.
test('every strip line is clickable; a waiting line leads its panel with the decision link', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [
    { state: 'you', title: 'Peplink planı', parent: 'Zenger', small: 'plan hazır · sonraki: tek evet', url: 'https://example.com/row', label: 'plan', time: '09:00' },
    { state: 'ok', title: 'Zenger', time: '08:00' },
    { state: 'run', title: 'Bare run', time: '08:30' },
  ]);
  crew(dir, ['--role', 'lead', '--job', 'Peplink', '--state', 'owner', '--reason', 'approval', '--row', 'Peplink planı', '--url', 'https://example.com/decide']);
  crew(dir, ['--role', 'scout', '--job', 'Row-less with url', '--state', 'owner', '--reason', 'decision', '--url', 'https://example.com/direct']);
  crew(dir, ['--role', 'builder', '--job', 'Row-less, no url', '--state', 'work']);
  crew(dir, ['--role', 'sentry', '--job', 'Row only', '--state', 'owner', '--row', 'Zenger']);
  const html = page(dir);
  const ls = linesOf(html);
  assert.strictEqual(ls.length, 5);
  for (const l of ls) assert.match(l, /<button type="button" class="tx" aria-expanded="false" aria-controls="cd-\d+">|<a class="tx" href="https?:/, 'a clickable control on every line');
  // an owner line with a row: its panel starts with the decision link (the entry's url before the row's)
  const id = (l) => l.match(/aria-controls="([^"]+)"/)[1];
  const cdOf = (l) => (stripOf(html).match(new RegExp('<div class="cd[^"]*" id="' + id(l) + '">([\\s\\S]*?)</div>')) || [])[1];
  const pep = ls.find((l) => l.includes('Peplink planı'));
  assert.match(cdOf(pep), /^<b>[^<]*(<span[^>]*>[^<]*<\/span>)?[^<]*<\/b><p class="dl"><a href="https:\/\/example\.com\/decide"[^>]*>karar sayfası<\/a><\/p>/);
  assert.match(cdOf(pep), /<a href="https:\/\/example\.com\/row"[^>]*>plan<\/a>/, 'the row link still follows');
  // an owner line with a row whose only link is the row's: that link leads
  const only = ls.find((l) => l.includes('Zenger') && !l.includes('Peplink'));
  assert.match(cdOf(only), /^<b>Zenger<\/b>/);
  // no row, a url: the line is the link
  assert.match(ls.find((l) => l.includes('Row-less with url')), /<a class="tx" href="https:\/\/example\.com\/direct" target="_blank" rel="noopener">Row-less with url <em>karar<\/em><\/a>/);
  // neither: a panel with the job text
  const bare = ls.find((l) => l.includes('Row-less, no url'));
  assert.match(stripOf(html), new RegExp('<div class="cd bare" id="' + id(bare) + '"><b>Row-less, no url</b></div>'));
  // a run row with nothing more to show still opens its title
  assert.match(cdOf(ls.find((l) => l.includes('Bare run'))), /^<b>Bare run<\/b>$/);
});
