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
const heads = (html) => (html.match(/<(?:div|summary) class="hd">[^<]*<span>\d+<\/span>/g) || []).map((s) => s.replace(/<[^>]+>/g, '').trim());
// one section of the list by its key (you, wait, ok, plan): from its block to the next section
const secOf = (html, k) => { const i = html.indexOf(`<div class="blk" data-k="${k}">`); if (i < 0) return ''; const j = html.indexOf('<li class="sec', i + 1); return html.slice(i, j < 0 ? html.indexOf('</main>', i) : j); };

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
test('sections: in progress, owner, waiting, done today, plans, in that order; empty section has none', (t) => {
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
  // Tracker yeni düzen (owner, 2026-10-05): the board, then plans alone below
  assert.deepStrictEqual(heads(html), ['Active work 1', 'Owner 1', 'Waiting 1', 'Done today 1', 'Plans 1']);
  assert.deepStrictEqual(lis(dir).map((l) => l.match(/data-st="(\w+)"/)[1]), ['you', 'wait', 'ok', 'plan']);
  assert.doesNotMatch(html, /<section class="pl">/, 'no section above the list any more');
  assert.doesNotMatch(secOf(html, 'you') + secOf(html, 'wait'), /<details/, 'owner and waiting are open sections, never a closed fold');
  assert.strictEqual((html.match(/<li class="sec( pl)?">/g) || []).length, 4);
  render(dir);
  assert.strictEqual(page(dir), html.replace(/data-t="[^"]*"/, page(dir).match(/data-t="[^"]*"/)[0]), 'a re-render is stable');
  setRows(dir, [{ state: 'ok', title: 'D', time: '08:00' }, { state: 'plan', title: 'P', time: '08:00' }]);
  render(dir);
  assert.deepStrictEqual(heads(page(dir)), ['Active work 0', 'Done today 1', 'Plans 1'], 'nothing running: the strip says so');
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

test('url + label makes a link on the line; default label; non-http gives none', (t) => {
  const dir = tmpdir(t);
  init(dir);
  setRows(dir, [
    { state: 'ok', title: 'A', small: 'note', url: 'https://example.com/x?a=1&b=2', label: 'open', time: '01:00' },
    { state: 'ok', title: 'B', url: 'http://example.com/', time: '01:01' },
    { state: 'ok', title: 'C', small: 's', url: 'javascript:alert(1)', label: 'bad', time: '01:02' },
  ]);
  render(dir);
  const p = page(dir);
  assert.match(p, />A<\/button><a class="lk" href="https:\/\/example\.com\/x\?a=1&amp;b=2"[^>]*>open<\/a>/);
  assert.match(p, /<a class="lk" href="http:\/\/example\.com\/"[^>]*>page<\/a>/);
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
  for (const w of ['Aktif çalışma', 'Sizde', 'Beklemede', 'Bugün biten', 'Planlar', '>sayfa<']) assert.ok(p.includes(w), w);
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

test('plans: one closed fold per group, the newest group first, newest first inside; no group goes under Other', (t) => {
  const dir = tmpdir(t);
  init(dir);
  setRows(dir, [
    { state: 'plan', title: 'P1', group: 'Alpha', time: '08:00' },
    { state: 'plan', title: 'P2', group: 'Beta', small: 'note', time: '09:00' },
    { state: 'plan', title: 'P3', group: 'Alpha', time: '08:00' },
    { state: 'plan', title: 'P4', time: '07:00' },
  ]);
  render(dir);
  const top = secOf(page(dir), 'plan');
  assert.deepStrictEqual(heads(top), ['Plans 4']);
  assert.deepStrictEqual([...top.matchAll(/<summary class="jh"><span class="jt">(\w+)<\/span><span>(\d)<\/span>/g)].map((m) => `${m[1]} ${m[2]}`), ['Beta 1', 'Alpha 2', 'Other 1']);
  assert.doesNotMatch(top, /<details[^>]* open/, 'all closed');
  assert.deepStrictEqual([...top.matchAll(/>(P\d)<\/button>/g)].map((m) => m[1]), ['P2', 'P1', 'P3', 'P4']);
  assert.match(top, /<b>Beta · P2<\/b><p>note<\/p>/, 'the detail names its group');
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
test('strip: icon, line, state class; counts only working entries (owner, 2026-10-05)', (t) => {
  const dir = devWs(t);
  crew(dir, ['--role', 'scout', '--job', 'A', '--state', 'work']);
  crew(dir, ['--role', 'scout', '--job', 'B', '--state', 'owner', '--reason', 'approval']);
  crew(dir, ['--role', 'scout', '--job', 'C', '--state', 'idle']);
  crew(dir, ['--role', 'lead', '--job', 'Conversation', '--state', 'work']);
  const html = page(dir);
  assert.match(html, /class="crew"/);
  assert.doesNotMatch(html, /data-count=/, 'one working scout, one working lead: no badge');
  assert.doesNotMatch(stripOf(html), /class="crew-line (owner|idle)"|approval|>B</, 'waiting and idle entries are not strip lines');
  assert.match(html, /<span class="ic"><span role="img" title="Scout · researching" aria-label="Scout · researching">/, 'the role and its activity are the icon\'s title');
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
    for (const r of ['voice', 'lead', 'scout']) assert.ok(html.includes(ICONS[r]), `${lang}: ${r} icon`);
    assert.ok(!html.includes(ICONS.builder), `${lang}: an idle role shows no icon`);
    assert.match(html, /class="crew-line work"/);
    assert.doesNotMatch(html, /class="crew-line (owner|idle)"/, 'only running lines');
    assert.match(html, /<button type="button" class="tx" aria-expanded="false" aria-controls="d-[a-z0-9-]+">DOTS araştırması<\/button>/, 'a line is the work only');
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
  assert.match(html, /<span class="ic"><span role="img" title="Scout · researching" aria-label="Scout · researching"><svg/);
  assert.match(html, /class="tx" aria-expanded="false" aria-controls="d-[a-z0-9-]+">A<\/button>/);
  assert.doesNotMatch(html, />[^<>]*Scout · /, 'never in the line text');
  assert.match(html, /data-role="scout"[^>]*title="1 · Scout · researching"/, 'the summary icon says it with its count');
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
test('a main job with sub-jobs: a category line in each group; only a finished one folds; running shows everywhere', (t) => {
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
  assert.ok(!html.includes('data-k="run"'), 'no running section in the list');
  // in the strip the main job is the category line, its running sub-job under it
  const s = stripOf(html);
  assert.match(s, /<li class="cat"><ul class="ch">\n  <li class="crew-line run">[^\n]*aria-controls="d-run-main-[0-9a-z]+">Main <span class="n">1<\/span> <em>running<\/em><\/button>/);
  assert.match(s, /<\/ul><ol>\n  <li class="crew-line run">[^\n]*>Sub running<\/button>/);
  // one sub-job in a group: prefixed with its category
  assert.match(secOf(html, 'you'), />\s*<span class="ct">Main ·<\/span> Ask<\/button>/);
  // done: the category folds, closed, with its count and last time; newest first inside
  const ok = secOf(html, 'ok');
  assert.match(ok, /<li class="cat"><details name="trk-ok" id="f-ok-main-[0-9a-z]+"><summary class="jh"><span class="jt">Main <em>running<\/em><\/span><span>2 · 09:20<\/span><\/summary><ol>[\s\S]*Sub done 2[\s\S]*Sub done 1[\s\S]*<\/ol><\/details><\/li>/);
  assert.ok(ok.indexOf('Loose') < ok.indexOf('class="cat"'), 'a category stands where its newest member stands (done: newest first)');
  assert.doesNotMatch(secOf(html, 'you'), /<details/, 'the owner group never folds');
  assert.doesNotMatch(html, /<details[^>]*\sopen/, 'closed by default');
});
test('waiting categories never fold; plans fold by group', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, [
    { state: 'wait', title: 'W main', time: '08:00' },
    { state: 'wait', title: 'W sub', parent: 'W main', time: '08:10' },
    { state: 'plan', title: 'P sub', parent: 'Done main', group: 'Alpha', time: '08:00' },
    { state: 'ok', title: 'Done main', time: '07:00' },
  ]);
  render(dir);
  const w = secOf(page(dir), 'wait');
  assert.doesNotMatch(w, /<details/);
  assert.match(w, /<li class="cat"><ul class="ch">\n  <li data-st="wait" class="crew-line wait">[^\n]*>W main <span class="n">1<\/span><\/button>[\s\S]*<\/ul><ol>\n  <li data-st="wait" class="crew-line wait">[^\n]*>W sub<\/button>/);
  assert.match(secOf(page(dir), 'plan'), /<details name="trk" id="f-plan-alpha-[0-9a-z]+"><summary class="jh"><span class="jt">Alpha<\/span><span>1<\/span><\/summary><ol>\n[^\n]*>P sub<\/button>/);
});
test('a long list shows its first lines: more than five units get a button and a fade, five do not', (t) => {
  const dir = tmpdir(t); init(dir);
  const n = (k, state) => [...Array(k)].map((_, i) => ({ state, title: `${state} ${i}`, time: `08:0${i}` }));
  setRows(dir, [...n(6, 'ok'), ...n(5, 'plan'), ...n(7, 'run'), ...n(7, 'you'), ...n(6, 'wait')]);
  render(dir);
  const html = page(dir);
  for (const k of ['ok', 'wait']) {
    assert.match(secOf(html, k), new RegExp(`<div class="clip clamp" id="clip-${k}">`), k);
    assert.match(secOf(html, k), new RegExp(`</ol></div><div class="fade" aria-hidden="true"></div><button type="button" class="more" aria-expanded="false" aria-controls="clip-${k}"[^>]*>all \\(\\d+\\)</button>`), k);
  }
  assert.doesNotMatch(stripOf(html), /class="(more|fade)"/, 'the strip never clamps');
  assert.match(secOf(html, 'you'), /<div class="clip" id="clip-you">/, 'the owner group never clamps');
  assert.doesNotMatch(secOf(html, 'you') + secOf(html, 'plan'), /class="(more|fade)"/);
  // a category counts as one unit
  setRows(dir, [...n(4, 'ok'), { state: 'ok', title: 'M', time: '07:00' }, ...[1, 2, 3].map((i) => ({ state: 'ok', title: `s${i}`, parent: 'M', time: `07:1${i}` }))]);
  render(dir);
  assert.doesNotMatch(page(dir), /class="more"/);
  assert.doesNotMatch(page(dir), /class="fade"/);
  // the clamp measures lines, never the detail items between them
  const { CLIP_JS } = require('../tools/tracker.js');
  assert.match(CLIP_JS, /:scope>ol>li:not\(\.crew-dl\)/);
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
  const { PANEL_JS, STATE_JS } = require('../tools/tracker.js');
  assert.ok(f.includes(`<script id="clip">${CLIP_JS}</script>\n<script id="panel">${PANEL_JS}</script>\n<script id="state">${STATE_JS}</script>\n</body>`), 'template and renderer agree (scripts)');
  const dir = tmpdir(t); init(dir);
  const fresh = page(dir);
  render(dir, '2026-10-01T09:05:00Z');
  const once = page(dir);
  render(dir, '2026-10-01T09:05:00Z');
  assert.strictEqual(page(dir), once);
  const outside = (h) => h.replace(/<main>[\s\S]*<\/main>/, '').replace(/data-t="[^"]*"/, '');
  assert.strictEqual(outside(once), outside(fresh), 'only <main> and the stamp change');
});
test('crew --model --effort --ctx: a faint tail in the detail in developer mode; ctx only with its time; none when off', (t) => {
  const dir = devWs(t);
  assert.strictEqual(crew(dir, ['--role', 'builder', '--job', 'A', '--state', 'work', '--model', 'opus', '--effort', 'high', '--ctx', '84213']).status, 0);
  let html = page(dir);
  assert.match(html, /class="tx" aria-expanded="false" aria-controls="d-[a-z0-9-]+">A<\/button>/, 'the line is the work only');
  assert.match(html, /<b>A<\/b><p class="cm">opus · high · 84k @09:05<\/p>/);
  crew(dir, ['--role', 'builder', '--job', 'A', '--state', 'idle']);
  const e = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8')).crew[0];
  assert.deepStrictEqual([e.model, e.effort, e.ctx, e.ctxTime, e.state], ['opus', 'high', 84213, '09:05', 'idle'], 'model, effort and ctx carry over');
  // a context figure without the time it was reported is never shown
  const store = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'));
  store.crew = [{ role: 'scout', job: 'B', state: 'work', ctx: 5000, time: '09:00' }, { role: 'scout', job: 'C', state: 'work', model: 'sonnet', ctx: 7000, time: '09:00' }];
  fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(store));
  render(dir);
  html = page(dir);
  assert.match(html, /<div class="cd bare" id="d-[a-z0-9-]+"><b>B<\/b><\/div>/, 'ctx alone: no tail');
  assert.match(html, /<b>C<\/b><p class="cm">sonnet<\/p>/);
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
    assert.doesNotMatch(html, /class="crew-line (owner|idle)"/, `dev ${dev}: waiting and idle are not strip lines`);
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
  assert.match(ls[1], /^<li class="crew-line run"><span class="ic"><span class="sq"><\/span><\/span><button type="button" class="tx" aria-expanded="false" aria-controls="(d-run-r-one-[0-9a-z]+)">R one<\/button><time>09:00<\/time><\/li>$/, 'a run row with no entry: the square mark');
  assert.match(stripOf(html), /<div class="cd bare" id="d-run-r-one-[0-9a-z]+"><b>R one<\/b><\/div>/, 'nothing more to show: the panel shows the title');
  assert.match(ls[0], /<button type="button" class="tx" aria-expanded="false" aria-controls="d-run-r-two-[0-9a-z]+">R two<\/button>/, 'a row with a detail opens it');
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
  crew(dir, ['--role', 'lead', '--job', 'Zenger işleri', '--state', 'work', '--effort', 'high']);
  assert.strictEqual(store(dir).crew[0].row, "sinan bey'e cevap ", 'the row carries over');
  const html = page(dir);
  const ls = linesOf(html);
  assert.strictEqual(ls.length, 4, 'Sinan (two entries, one line), Kendi işi, Zenger, Loose');
  assert.strictEqual(ls.filter((l) => l.includes('Sinan')).length, 1, 'one row, one line');
  const sinan = ls.find((l) => l.includes('Sinan'));
  assert.match(sinan, /^<li class="crew-line work" data-role="lead"><span class="ic"><span role="img" title="Lead · yönetiyor" aria-label="Lead · yönetiyor"><svg[\s\S]*?<\/svg><\/span><span role="img" title="Builder · kod yazıyor" aria-label="Builder · kod yazıyor"><svg/);
  // Zenger runs too: it is the category line, Sinan under it without a prefix, the row's link on the line
  const sid = sinan.match(/aria-controls="(d-run-[^"]+)">Sinan Bey'e cevap<\/button><a class="lk" href="https:\/\/example\.com\/d" target="_blank" rel="noopener">taslak<\/a>/)[1];
  assert.match(stripOf(html), /<li class="cat"><ul class="ch">\n  <li class="crew-line run">[^\n]*>Zenger <span class="n">1<\/span> <em>sürüyor<\/em><\/button>/);
  assert.doesNotMatch(sinan, /class="cm"/, 'the model tail is in the detail');
  // the entry with no row: its own job, a panel with its title
  assert.match(ls.find((l) => l.includes('Kendi')), /class="tx" aria-expanded="false" aria-controls="d-[a-z0-9-]+">Kendi işi<\/button>/);
  // the detail: small text, next step, the entries' links, the model tail, right under its line
  const s = stripOf(html);
  assert.ok(s.indexOf(`<li class="crew-dl"><div class="cd" id="${sid}">`) === s.indexOf('</li>', s.indexOf(`aria-controls="${sid}"`)) + '</li>\n  '.length, 'the panel is right under its line');
  const cd = (s.match(new RegExp(`<div class="cd" id="${sid}">[\\s\\S]*?</div>`)) || [''])[0];
  assert.match(cd, /<p>kısa taslak hazır<\/p>/);
  assert.match(cd, /<p class="nx"><span>sonraki<\/span> siz gönderin<\/p>/);
  assert.match(cd, /<a href="https:\/\/example\.com\/r"[^>]*>sayfa<\/a>/);
  assert.match(cd, /<p class="cm">opus · high<\/p>/);
  assert.doesNotMatch(s, /\shidden/, 'without script every detail shows');
  // every button controls a detail that exists, once
  const ctl = [...s.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ctl.length >= 1);
  for (const id of ctl) assert.strictEqual(html.split(`id="${id}"`).length, 2, id);
  // a running row with no crew entry still shows
  assert.ok(ls.some((l) => /<span class="ic"><span class="sq"><\/span><\/span><button type="button" class="tx" aria-expanded="false" aria-controls="d-[a-z0-9-]+">Loose<\/button>/.test(l)));
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
  assert.match(stripOf(html), /<span class="ic"><span role="img" title="Araştırıyor" aria-label="Araştırıyor"><svg/, 'the icon stays, titled with the activity only');
  assert.doesNotMatch(html, ROLE_WORDS);
  assert.doesNotMatch(html, /ajan|agent/i);
  assert.doesNotMatch(stripOf(html), /class="cm"|opus/, 'no model tail');
  assert.match(stripOf(html), /<time data-since="[^"]+">/, 'elapsed stays');
});
test('the panel script: one detail open at a time across the page, aria-expanded follows, hidden otherwise', () => {
  const vm = require('vm');
  const { PANEL_JS } = require('../tools/tracker.js');
  assert.ok(PANEL_JS, 'exported');
  const ds = { 'cd-1': { hidden: false }, 'cd-2': { hidden: false } };
  const btn = (id) => { const a = { 'aria-controls': id, 'aria-expanded': 'false' }; return { getAttribute: (k) => a[k], setAttribute: (k, v) => { a[k] = v; }, closest() { return this; } }; };
  const bs = [btn('cd-1'), btn('cd-2')];
  let onClick = null; let onReady = null; const cls = new Set();
  const document = { readyState: 'loading', documentElement: { classList: { add: (c) => cls.add(c) } }, querySelectorAll: () => bs, getElementById: (id) => ds[id],
    addEventListener: (ev, f) => { if (ev === 'click') onClick = f; if (ev === 'DOMContentLoaded') onReady = f; } };
  vm.runInNewContext(PANEL_JS, { document });
  assert.deepStrictEqual([ds['cd-1'].hidden, cls.size], [false, 0], 'it waits for the whole document');
  onReady();
  assert.ok(cls.has('js-cd'));
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
// job text. (Lines waiting on the owner left the strip later that day, owner 2026-10-05, so no panel
// leads with a decision link any more.)
test('every strip line is clickable', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [
    { state: 'run', title: 'Peplink planı', parent: 'Zenger', small: 'plan hazır · sonraki: tek evet', url: 'https://example.com/row', label: 'plan', time: '09:00' },
    { state: 'ok', title: 'Zenger', time: '08:00' },
    { state: 'run', title: 'Bare run', time: '08:30' },
  ]);
  crew(dir, ['--role', 'lead', '--job', 'Peplink', '--state', 'work', '--row', 'Peplink planı', '--url', 'https://example.com/entry']);
  crew(dir, ['--role', 'scout', '--job', 'Row-less with url', '--state', 'work', '--url', 'https://example.com/direct']);
  crew(dir, ['--role', 'builder', '--job', 'Row-less, no url', '--state', 'work']);
  const html = page(dir);
  const ls = linesOf(html);
  assert.strictEqual(ls.length, 4);
  for (const l of ls) assert.match(l, /<button type="button" class="tx" aria-expanded="false" aria-controls="d-[a-z0-9-]+">/, 'a button on every line');
  const id = (l) => l.match(/aria-controls="([^"]+)"/)[1];
  const cdOf = (l) => (stripOf(html).match(new RegExp('<div class="cd[^"]*" id="' + id(l) + '">([\\s\\S]*?)</div>')) || [])[1];
  // a row: the row's link on the line; in the detail its text, next step and the entry's link
  const pepLine = ls.find((l) => l.includes('Peplink planı'));
  assert.match(pepLine, /<\/button><a class="lk" href="https:\/\/example\.com\/row" target="_blank" rel="noopener">plan<\/a><time/);
  assert.match(cdOf(pepLine), /^<b>Zenger · Peplink planı<\/b><p>plan hazır<\/p><p class="nx"><span>sonraki<\/span> tek evet<\/p><p class="ln"><a href="https:\/\/example\.com\/entry"[^>]*>sayfa<\/a><\/p>$/);
  assert.doesNotMatch(stripOf(html), /class="dl"|karar sayfası/, 'no decision link');
  // no row, a url: the url is in its detail (the build note: an entry's url shows in the detail, not on the line)
  const direct = ls.find((l) => l.includes('Row-less with url'));
  assert.doesNotMatch(direct, /example\.com\/direct/);
  assert.match(cdOf(direct), /<a href="https:\/\/example\.com\/direct"[^>]*>sayfa<\/a>/);
  // neither: a panel with the job text
  const bare = ls.find((l) => l.includes('Row-less, no url'));
  assert.match(stripOf(html), new RegExp('<div class="cd bare" id="' + id(bare) + '"><b>Row-less, no url</b></div>'));
  // a run row with nothing more to show still opens its title
  assert.match(cdOf(ls.find((l) => l.includes('Bare run'))), /^<b>Bare run<\/b>$/);
});

// Owner, 2026-10-05: clicking the first strip line opened its detail under another line. Every detail
// was emitted in one shared panel after the whole list, so it always showed below the last line. Each
// line's detail now sits directly under that line, and its button controls exactly that element.
test('strip: each line opens its detail directly under itself, never under another line', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [
    { state: 'you', title: 'Yeni ekip', parent: 'Joserah', small: 'test bitti · sonraki: karar', time: '09:00' },
    { state: 'you', title: 'Peplink planı', parent: 'Zenger', small: 'plan hazır', time: '09:05' },
    { state: 'run', title: 'Trail', parent: 'Joserah', small: 'yazılıyor', time: '09:10' },
    { state: 'ok', title: 'Joserah', time: '08:00' },
    { state: 'ok', title: 'Zenger', time: '08:00' },
  ]);
  assert.strictEqual(crew(dir, ['--role', 'lead', '--job', 'Joserah karar', '--state', 'work', '--row', 'Yeni ekip', '--url', 'https://example.com/a']).status, 0);
  crew(dir, ['--role', 'lead', '--job', 'CTRL', '--state', 'work', '--row', 'Peplink planı']);
  crew(dir, ['--role', 'lead', '--job', 'Trail', '--state', 'work', '--row', 'Trail']);
  crew(dir, ['--role', 'builder', '--job', 'No row', '--state', 'work']);
  const s = stripOf(page(dir));
  const ul = s;
  // the list's items in order: each line, then (when it opens a panel) its own detail
  const items = ul.match(/<li class="crew-(?:line|dl)[\s\S]*?<\/li>/g) || [];
  const lines = items.filter((l) => l.startsWith('<li class="crew-line'));
  assert.strictEqual(lines.length, 4);
  for (const l of lines) {
    const id = l.match(/aria-controls="([^"]+)"/)[1];
    const next = items[items.indexOf(l) + 1] || '';
    assert.match(next, new RegExp(`^<li class="crew-dl"><div class="cd[^"]*" id="${id}">`), `the detail ${id} follows its own line`);
    assert.strictEqual(s.split(`id="${id}"`).length, 2, `${id} once`);
  }
  assert.match(items[items.indexOf(lines[0]) + 1], /<b>Joserah · Yeni ekip<\/b>/);
  assert.doesNotMatch(s, /<div class="crew-d">/, 'no shared panel after the list');
  // the first of several lines: its panel is the second item, nothing of it after the last line
  const first = lines[0].match(/aria-controls="([^"]+)"/)[1];
  assert.match(items[1], new RegExp(`id="${first}"`));
  assert.ok(ul.lastIndexOf(`id="${first}"`) < ul.indexOf(lines[1]), 'the first line\'s detail comes before the second line');
  assert.strictEqual(page(dir).split('<script id="panel">').length, 2, 'one panel script');
  // attached to its line as a child is: the children's indent and left rule
  const { STRIP_CSS } = require('../tools/tracker.js');
  const rule = STRIP_CSS.find((c) => c.startsWith(':is(.crew,main) li.crew-dl{'));
  assert.match(rule, /margin:0 0 0 2px;padding:0 0 0 16px;[^}]*border-left:1px solid var\(--line\)\}/);
  assert.ok(page(dir).includes(rule), 'the page carries it');
});

// Owner, 2026-10-05: "şu an çalışan bir şey var mı anlamıyorum hepsi beni bekliyor galiba". The strip
// is only what is running now: a crew entry working on it, or a run row. Waiting on the owner shows in
// the owner section only; a line with any working entry reads as running; nothing running says so.
const trWs = (t) => { const dir = devWs(t); fs.writeFileSync(path.join(dir, 'index.html'), page(dir).replace('<html lang="en">', '<html lang="tr">')); return dir; };
test('strip: only running work, never what waits on the owner or an idle entry', (t) => {
  const dir = trWs(t);
  setRows(dir, [
    { state: 'you', title: 'Peplink planı', small: 'plan hazır', time: '09:00' },
    { state: 'run', title: 'Trail', time: '09:10' },
  ]);
  crew(dir, ['--role', 'lead', '--job', 'Peplink', '--state', 'owner', '--reason', 'approval', '--row', 'Peplink planı']);
  crew(dir, ['--role', 'builder', '--job', 'Trail kodu', '--state', 'work', '--row', 'Trail']);
  crew(dir, ['--role', 'scout', '--job', 'Bitti', '--state', 'idle']);
  crew(dir, ['--role', 'sentry', '--job', 'Onay', '--state', 'owner', '--reason', 'decision', '--url', 'https://example.com/d']);
  const html = page(dir);
  const ls = linesOf(html);
  assert.deepStrictEqual(ls.map((l) => l.match(/class="crew-line (\w+)"/)[1]), ['work'], 'one running line');
  assert.ok(ls[0].includes('Trail'));
  assert.deepStrictEqual(heads(html), ['Aktif çalışma 1', 'Sizde 2'], 'what waits on the owner is in the owner section, a row-less entry as its own line');
  const s = stripOf(html);
  assert.doesNotMatch(s, /Peplink|Onay|Bitti|<em>|crew-line owner|crew-line idle/, 'nothing waiting or idle in the strip');
  assert.doesNotMatch(s, /data-role="(lead|sentry|scout)"/, 'the summary counts only working roles (and Voice)');
  assert.match(html, /<li data-st="you"[\s\S]*?Peplink planı/, 'the waiting row is in the owner section');
});
test('strip: a line with a working entry reads as running, never as waiting on the owner', (t) => {
  const dir = trWs(t);
  setRows(dir, [{ state: 'run', title: 'Ortak iş', time: '09:00' }]);
  crew(dir, ['--role', 'lead', '--job', 'Karar', '--state', 'owner', '--reason', 'decision', '--row', 'Ortak iş']);
  crew(dir, ['--role', 'builder', '--job', 'Kod', '--state', 'work', '--row', 'Ortak iş']);
  const ls = linesOf(page(dir));
  assert.strictEqual(ls.length, 1);
  assert.match(ls[0], /^<li class="crew-line work"/);
  assert.doesNotMatch(ls[0], /<em>/, 'no waiting reason on a running line');
  const since = store(dir).crew.find((e) => e.role === 'builder').since;
  assert.match(ls[0], new RegExp(`<time data-since="${since}">`), 'it counts from the working entry');
});
test('strip: nothing running says so, in both languages', (t) => {
  for (const [lang, head, text] of [['tr', 'Aktif çalışma 0', 'Şu an çalışan iş yok'], ['en', 'Active work 0', 'Nothing running right now']]) {
    const dir = tmpdir(t); init(dir, ['--lang', lang]);
    setRows(dir, [{ state: 'you', title: 'Y', time: '09:00' }]);
    crew(dir, ['--role', 'lead', '--job', 'Karar', '--state', 'owner', '--reason', 'approval', '--row', 'Y']);
    let html = page(dir);
    assert.strictEqual(heads(html)[0], head, lang);
    assert.match(stripOf(html), new RegExp(`<ul>\\n  <li class="crew-none">${text}</li>\\n</ul>`), lang);
    assert.doesNotMatch(stripOf(html), /<script id="panel">|crew-line/, `${lang}: no line, no panel script`);
    // a page with no crew at all says it too
    const bare = tmpdir(t); init(bare, ['--lang', lang]);
    setRows(bare, [{ state: 'ok', title: 'B', time: '09:00' }]);
    render(bare);
    html = page(bare);
    assert.match(stripOf(html), new RegExp(`<li class="crew-none">${text}</li>`), `${lang}: no crew`);
  }
});

// Owner, 2026-10-05: "ikonların üstüne gelince planning gibi anlaşılır şeyler yazsın". Every role icon
// says, on hover and to a screen reader, what that role is doing; the summary icons add the count.
test('strip icons say what each role is doing (title and aria-label)', (t) => {
  const tip = (s) => `role="img" title="${s}" aria-label="${s}"`;
  // developer mode on, Turkish: the role, then the activity
  const on = trWs(t);
  crew(on, ['--role', 'builder', '--job', 'A', '--state', 'work']);
  crew(on, ['--role', 'builder', '--job', 'B', '--state', 'work']);
  crew(on, ['--role', 'scout', '--job', 'C', '--state', 'work']);
  let html = page(on);
  const want = { lead: 'Lead · yönetiyor', architect: 'Architect · planlıyor', builder: 'Builder · kod yazıyor', scout: 'Scout · araştırıyor', sentry: 'Sentry · izliyor' };
  assert.ok(stripOf(html).includes(`<span class="ic"><span ${tip(want.builder)}><svg`), 'a line icon');
  assert.ok(stripOf(html).includes(`<span ${tip(want.scout)}><svg`));
  assert.ok(stripOf(html).includes(`<span class="work" data-role="builder" data-count="2" ${tip('2 · Builder · kod yazıyor')}><svg`), 'the summary icon with its count');
  assert.ok(stripOf(html).includes(`<span class="work" data-role="scout" ${tip('1 · Scout · araştırıyor')}><svg`));
  for (const [r, s] of Object.entries(want)) {
    const d = trWs(t); crew(d, ['--role', r, '--job', 'X', '--state', 'work']);
    assert.ok(stripOf(page(d)).includes(`<span class="ic"><span ${tip(s)}><svg`), r);
  }
  // developer mode off: the activity only, no role name
  const off = tmpdir(t); init(off, ['--lang', 'tr']);
  crew(off, ['--role', 'builder', '--job', 'A', '--state', 'work']);
  crew(off, ['--role', 'builder', '--job', 'B', '--state', 'work']);
  crew(off, ['--role', 'sentry', '--job', 'C', '--state', 'work']);
  html = page(off);
  assert.ok(stripOf(html).includes(`<span class="ic"><span ${tip('Kod yazıyor')}><svg`));
  assert.ok(stripOf(html).includes(`<span class="ic"><span ${tip('İzliyor')}><svg`));
  assert.ok(stripOf(html).includes(`<span class="work" data-count="2" ${tip('2 · kod yazıyor')}><svg`));
  assert.doesNotMatch(html, ROLE_WORDS);
  // English
  const en = tmpdir(t); init(en);
  for (const r of ['lead', 'architect', 'builder', 'scout', 'sentry']) crew(en, ['--role', r, '--job', r, '--state', 'work']);
  const s = stripOf(page(en));
  for (const a of ['Managing', 'Planning', 'Writing code', 'Researching', 'Watching']) assert.ok(s.includes(`<span class="ic"><span ${tip(a)}><svg`), a);
  assert.ok(s.includes(tip('1 · writing code')));
});

// Owner, 2026-10-05, "Tracker yeni düzen" (Architect's build note, design-note.md): one board above —
// Active work, Owner, Waiting, Done today (one closed fold) — every row in the Active work line shape,
// lines of one category under one category line; Plans alone below. Each line's detail opens right under it.
const boardRows = [
  { state: 'run', title: 'R', parent: 'Alpha', time: '09:00' },
  { state: 'you', title: 'Y', small: 'karar lazım · sonraki: evet deyin', url: 'https://example.com/y', time: '09:05' },
  { state: 'wait', title: 'A1', parent: 'Alpha', time: '09:10' },
  { state: 'wait', title: 'A2', parent: 'Alpha', time: '09:20' },
  { state: 'wait', title: 'B1', parent: 'Beta', time: '09:15' },
  { state: 'ok', title: 'Alpha', time: '08:00' },
  { state: 'ok', title: 'Beta', time: '10:00' },
  { state: 'plan', title: 'P1', group: 'Later', time: '08:30' },
];
test('board: run, owner, waiting, done today, plans in that order; done is one closed fold with count and last time', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, boardRows);
  render(dir);
  const html = page(dir);
  assert.deepStrictEqual(heads(html), ['Active work 1', 'Owner 1', 'Waiting 3', 'Done today 2', 'Plans 1']);
  const ok = secOf(html, 'ok');
  assert.match(ok, /^<div class="blk" data-k="ok"><details name="trk" id="f-ok"><summary class="hd">Done today <span>2<\/span><span class="lt">10:00<\/span><\/summary>/, 'closed, count and last finish time');
  assert.ok(html.indexOf('data-k="ok"') < html.indexOf('data-k="plan"'), 'plans after done');
  assert.match(html, /<li class="sec pl"><div class="blk" data-k="plan">/, 'plans below their rule');
  assert.match(secOf(html, 'plan'), /<details name="trk" id="f-plan-later-[0-9a-z]+"><summary class="jh"><span class="jt">Later<\/span><span>1<\/span><\/summary>/, 'one closed fold per group');
  assert.doesNotMatch(html, /<details[^>]* open/, 'every fold starts closed');
});
test('board: empty owner, waiting and done render nothing; an empty strip keeps its none line', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [{ state: 'plan', title: 'P', time: '08:00' }]);
  render(dir);
  const html = page(dir);
  assert.deepStrictEqual(heads(html), ['Aktif çalışma 0', 'Planlar 1']);
  assert.match(stripOf(html), /<li class="crew-none">Şu an çalışan iş yok<\/li>/);
});
test('board: two rows of one category gather under a category line; a single one is prefixed', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, boardRows);
  render(dir);
  const w = secOf(page(dir), 'wait');
  assert.match(w, /<li class="cat"><div class="jh"><span class="jt">Alpha <em>running<\/em><\/span><span>2<\/span><\/div><ol>/, 'Alpha: a category line that says running (R runs)');
  const alpha = w.match(/<li class="cat">[\s\S]*?<\/ol><\/li>/)[0];
  for (const x of ['A1', 'A2']) assert.match(alpha, new RegExp(`aria-controls="[^"]+">${x}</button>`), `${x} under Alpha, no prefix`);
  assert.match(w, /aria-controls="[^"]+"><span class="ct">Beta ·<\/span> B1<\/button>/, 'one row of Beta: prefixed');
  assert.ok(w.indexOf('Alpha') < w.indexOf('B1'), 'newest first: Alpha (A2 09:20) before B1 (09:15)');
  // a parent in the same group is the category line itself
  const d2 = tmpdir(t); init(d2);
  setRows(d2, [{ state: 'you', title: 'Main', time: '09:00' }, { state: 'you', title: 'Sub', parent: 'Main', time: '09:10' }]);
  render(d2);
  const you = secOf(page(d2), 'you');
  assert.match(you, /<li class="cat"><ul class="ch">\n  <li data-st="you" class="crew-line you"><span class="ic"><span class="sq"><\/span><\/span><button type="button" class="tx" aria-expanded="false" aria-controls="d-you-main-[0-9a-z]+">Main <span class="n">1<\/span><\/button>/);
  assert.match(you, /<\/ul><ol>\n  <li data-st="you" class="crew-line you">[^\n]*>Sub<\/button>/);
});
test('board: every line opens its own detail, the next item, with an id made from its title', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, boardRows);
  render(dir);
  const html = page(dir);
  const ids = [...html.matchAll(/aria-controls="(d-[^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(ids.length, 8, 'one control per line');
  for (const id of ids) {
    assert.strictEqual(html.split(`id="${id}"`).length, 2, `${id} once`);
    assert.match(html, new RegExp(`aria-controls="${id}">[^\\n]*</li>\\n\\s*<li class="crew-dl"><div class="cd[^"]*" id="${id}">`), `${id} right under its line`);
  }
  assert.match(html, /aria-controls="d-you-y-[0-9a-z]+">Y<\/button>/, 'the id comes from the title');
  // the same titles in another order keep their ids
  setRows(dir, [...boardRows].reverse());
  render(dir);
  assert.deepStrictEqual([...page(dir).matchAll(/aria-controls="(d-[^"]+)"/g)].map((m) => m[1]).sort(), ids.sort());
  // the detail: text, then the next step on its own line
  assert.match(html, /<div class="cd" id="d-you-y-[0-9a-z]+"><b>Y<\/b><p class="dl"><a href="https:\/\/example\.com\/y" target="_blank" rel="noopener">karar sayfası<\/a><\/p><p>karar lazım<\/p><p class="nx"><span>sonraki<\/span> evet deyin<\/p><\/div>/);
});
test('board: a row url is a link label on the line (label, else page); a non-http url is dropped', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [
    { state: 'wait', title: 'L1', url: 'https://example.com/a', label: 'İş akışı', time: '09:00' },
    { state: 'wait', title: 'L2', url: 'https://example.com/b', time: '09:01' },
    { state: 'wait', title: 'L3', url: 'javascript:alert(1)', time: '09:02' },
  ]);
  render(dir);
  const ls = lis(dir);
  const of = (x) => ls.find((l) => l.includes(`>${x}</button>`));
  assert.match(of('L1'), /<\/button><a class="lk" href="https:\/\/example\.com\/a" target="_blank" rel="noopener">İş akışı<\/a><time>09:00<\/time><\/li>$/);
  assert.match(of('L2'), /<a class="lk" href="https:\/\/example\.com\/b" target="_blank" rel="noopener">sayfa<\/a>/);
  assert.doesNotMatch(page(dir), /javascript:/);
});
test('board: owner lines lead their detail with the decision link and the reason; an owner entry without a you row is its own line', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [{ state: 'you', title: 'Plan onayı', url: 'https://example.com/plan', label: 'plan', time: '09:00' }, { state: 'ok', title: 'Eski', time: '08:00' }]);
  crew(dir, ['--role', 'lead', '--job', 'Onay', '--state', 'owner', '--reason', 'approval', '--row', 'Plan onayı']);
  crew(dir, ['--role', 'scout', '--job', 'Kaynak seçimi', '--state', 'owner', '--reason', 'decision', '--url', 'https://example.com/pick']);
  const you = secOf(page(dir), 'you');
  assert.match(you, /<div class="hd">Sizde <span>2<\/span><\/div>/);
  assert.match(you, /<div class="cd" id="d-you-plan-onay[^"]*"><b>Plan onayı<\/b><p class="dl"><a href="https:\/\/example\.com\/plan" target="_blank" rel="noopener">plan<\/a> <em>onay<\/em><\/p><\/div>/);
  assert.match(you, /aria-controls="d-you-[^"]+">Kaynak seçimi<\/button>/);
  assert.match(you, /<p class="dl"><a href="https:\/\/example\.com\/pick" target="_blank" rel="noopener">karar sayfası<\/a> <em>karar<\/em><\/p>/);
});
test('board: in developer mode the model tail is in the detail, never on the line', (t) => {
  const dir = devWs(t);
  setRows(dir, [{ state: 'run', title: 'Kod', time: '09:00' }]);
  crew(dir, ['--role', 'builder', '--job', 'Kod', '--state', 'work', '--row', 'Kod', '--model', 'opus', '--effort', 'high']);
  const s = stripOf(page(dir));
  assert.doesNotMatch(linesOf(page(dir))[0], /class="cm"|opus/);
  assert.match(s, /<div class="cd" id="d-run-kod-[0-9a-z]+"><b>Kod<\/b><p class="cm">opus · high<\/p><\/div>/);
});
test('board: phone width puts the link under the text; only the time and the link label never wrap', () => {
  const { CONSOLE_CSS } = require('../tools/tracker.js');
  assert.match(CONSOLE_CSS, /@media \(max-width:560px\)\{[^\n]*li\.crew-line\{[^}]*grid-template-areas:"m x t" "\. l \."/);
  for (const rule of CONSOLE_CSS.split(/(?<=\})/)) {
    if (!rule.includes('white-space:nowrap')) continue;
    assert.match(rule.replace(/^@media[^{]*\{/, ''), /^[^{]*(time|\.lk)[^{]*\{/, `nowrap only on the time and the link: ${rule.slice(0, 90)}`);
  }
});

// Owner, 2026-10-05: "sayfa güncellenince otomatik yenileniyor expandların durumu da değişmesin". What is
// open — a line's detail, a fold, an opened long list — and the scroll position survive a reload of the
// page (a republish reloads it). Kept per viewer in the browser's storage; every read and write guarded.
const stateDom = ({ saved, throwing } = {}) => {
  const store = new Map(saved ? [['trk:/p', JSON.stringify(saved)]] : []);
  const el = (a, extra) => ({ a: { ...a }, getAttribute(k) { return this.a[k]; }, setAttribute(k, v) { this.a[k] = String(v); }, ...extra });
  const panel = { hidden: true };
  const btn = el({ 'aria-controls': 'd-you-x', 'aria-expanded': 'false' });
  const more = el({ 'aria-controls': 'clip-ok', 'aria-expanded': 'false' }, { clicks: 0, click() { this.clicks++; this.a['aria-expanded'] = 'true'; } });
  const fOk = { id: 'f-ok', open: false, querySelector: () => null };
  const legacy = { id: '', open: false, querySelector: () => ({ textContent: '  Zenger  ' }) };
  const docL = {}; const winL = {}; const scrolls = [];
  const document = {
    readyState: 'complete',
    querySelectorAll: (s) => (s.startsWith('button.tx') ? [btn] : s === 'details' ? [fOk, legacy] : s.startsWith('button.more') ? [more] : []),
    getElementById: (id) => (id === 'd-you-x' ? panel : null),
    addEventListener: (ev, f) => { docL[ev] = f; },
  };
  const window = { scrollY: 0, scrollTo: (x, y) => { scrolls.push(y); window.scrollY = y; }, addEventListener: (ev, f) => { winL[ev] = f; } };
  const ctx = { document, window, location: { pathname: '/p' }, setTimeout: (f) => f(), clearTimeout: () => {}, JSON };
  if (throwing) Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('denied'); } });
  else ctx.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  return { ctx, store, panel, btn, more, fOk, legacy, docL, winL, scrolls };
};
test('expand state: a reload restores the open detail, folds, opened lists and the scroll position', () => {
  const vm = require('vm');
  const { STATE_JS } = require('../tools/tracker.js');
  const d = stateDom({ saved: { p: 'd-you-x', d: ['f-ok', 'S:Zenger'], c: ['clip-ok'], y: 300 } });
  vm.runInNewContext(STATE_JS, d.ctx);
  assert.deepStrictEqual([d.btn.getAttribute('aria-expanded'), d.panel.hidden], ['true', false], 'the detail is open again');
  assert.deepStrictEqual([d.fOk.open, d.legacy.open], [true, true], 'folds by id, and a fold without one by its summary');
  assert.strictEqual(d.more.clicks, 1, 'the opened long list opens again');
  assert.deepStrictEqual(d.scrolls, [300]);
});
test('expand state: what the viewer opens is saved under the page, the scroll position too', () => {
  const vm = require('vm');
  const { STATE_JS } = require('../tools/tracker.js');
  const d = stateDom();
  vm.runInNewContext(STATE_JS, d.ctx);
  assert.strictEqual(d.store.size, 0, 'nothing saved before the viewer acts');
  d.btn.setAttribute('aria-expanded', 'true'); d.fOk.open = true; d.ctx.window.scrollY = 120;
  d.docL.click({ target: d.btn });
  assert.deepStrictEqual(JSON.parse(d.store.get('trk:/p')), { p: 'd-you-x', d: ['f-ok'], c: [], y: 120 });
  d.fOk.open = false; d.ctx.window.scrollY = 40;
  d.winL.scroll();
  assert.deepStrictEqual(JSON.parse(d.store.get('trk:/p')), { p: 'd-you-x', d: [], c: [], y: 40 });
});
test('expand state: storage that throws changes nothing and throws nothing', () => {
  const vm = require('vm');
  const { STATE_JS } = require('../tools/tracker.js');
  const d = stateDom({ throwing: true });
  assert.doesNotThrow(() => vm.runInNewContext(STATE_JS, d.ctx));
  assert.deepStrictEqual([d.btn.getAttribute('aria-expanded'), d.fOk.open, d.more.clicks, d.scrolls.length], ['false', false, 0, 0]);
  d.btn.setAttribute('aria-expanded', 'true');
  assert.doesNotThrow(() => { d.docL.click({ target: d.btn }); d.winL.scroll(); d.winL.pagehide(); });
});
test('the page carries the panel and state scripts once, after the clamp script; the strip alone carries them for an outside page', (t) => {
  const { PANEL_JS, STATE_JS, activeStrip, LABELS } = require('../tools/tracker.js');
  const dir = tmpdir(t); init(dir);
  setRows(dir, boardRows);
  render(dir); render(dir);
  const html = page(dir);
  for (const id of ['panel', 'state']) assert.strictEqual(html.split(`<script id="${id}">`).length, 2, id);
  assert.ok(html.indexOf('<script id="clip">') < html.indexOf('<script id="panel">') && html.indexOf('<script id="panel">') < html.indexOf('<script id="state">'));
  assert.doesNotMatch(stripOf(html), /<script/, 'not inside the strip on a tracker page');
  const s = activeStrip([], [{ state: 'run', title: 'R', time: '09:00' }], LABELS.tr, false);
  assert.ok(s.includes(`<script id="panel">${PANEL_JS}</script><script id="state">${STATE_JS}</script>`), 'an outside page (its own updater) gets both with the strip');
  assert.doesNotMatch(activeStrip([], [{ state: 'run', title: 'R', time: '09:00' }], LABELS.tr, false, { script: false }), /<script/);
});

// An outside updater's rows may name a category that is not a row (the live Daily Tracker does): its
// lines still gather under one category line by that name, in the strip as in any group.
test('board: a category that is not a row gathers its lines by name', () => {
  const { activeStrip, LABELS } = require('../tools/tracker.js');
  const s = activeStrip([], [
    { state: 'run', title: 'One', parent: 'Joserah · crew', time: '09:00' },
    { state: 'run', title: 'Two', parent: 'joserah · crew ', time: '09:10' },
    { state: 'run', title: 'Solo', parent: 'Zenger', time: '09:05' },
  ], LABELS.tr, false, { script: false });
  assert.match(s, /<li class="cat"><div class="jh"><span class="jt">Joserah · crew <em>sürüyor<\/em><\/span><span>2<\/span><\/div><ol>\n[^\n]*>One<\/button>[\s\S]*>Two<\/button>/);
  assert.match(s, /<span class="ct">Zenger ·<\/span> Solo<\/button>/);
});
test('board: rows nested two levels (an outside updater): every line once; a line heading its own category is not also a member', () => {
  const { board, LABELS } = require('../tools/tracker.js');
  const { list } = board([
    { state: 'you', title: 'A', parent: 'Top', time: '09:00' },
    { state: 'you', title: 'A1', parent: 'A', time: '09:05' },
    { state: 'you', title: 'A2', parent: 'A', time: '09:06' },
    { state: 'you', title: 'B', parent: 'Top', time: '09:10' },
  ], [], LABELS.en, false);
  const you = list[0];
  for (const x of ['a', 'a1', 'a2', 'b']) assert.strictEqual(you.split(`aria-controls="d-you-${x}-`).length - 1, 1, `${x} once`);
  assert.match(you, /<li class="cat"><ul class="ch">\n[^\n]*>A <span class="n">2<\/span><\/button>/);
  assert.match(you, /<span class="ct">Top ·<\/span> B<\/button>/);
  const ids = [...you.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(ids.length, new Set(ids).size, 'no id twice');
});

// The live Daily Tracker moves onto the plugin board (Lead, 2026-10-05): its page keeps its own shell —
// a <main> with attributes and a heading inside it before the crew slot — and its plans carry their day
// as DD.MM, which must order by date, not by text.
test('render keeps a page\'s own <main> attributes and what stands before the crew slot', (t) => {
  const dir = tmpdir(t); init(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), page(dir).replace('<main>\n<!-- crew -->', '<main class="wrap">\n  <header><div class="eyebrow">Board · 05.10</div></header>\n<!-- crew -->'));
  setRows(dir, [{ state: 'ok', title: 'B', time: '09:05' }]);
  assert.strictEqual(render(dir).status, 0);
  const html = page(dir);
  assert.match(html, /<main class="wrap">\n  <header><div class="eyebrow">Board · 05\.10<\/div><\/header>\n<!-- crew -->\n<section class="crew">/);
  assert.strictEqual(html.split('<header><div class="eyebrow">').length, 2, 'once');
  render(dir);
  assert.strictEqual(page(dir).split('<header><div class="eyebrow">').length, 2, 'still once after a re-render');
  assert.match(page(dir), />B<\/button>/);
});
test('a day mark DD.MM orders by date, older than any time of today', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, [
    { state: 'plan', title: 'Sep', group: 'G', time: '30.09' },
    { state: 'plan', title: 'Oct', group: 'G', time: '05.10' },
    { state: 'plan', title: 'Aug', group: 'G', time: '28.08' },
    { state: 'ok', title: 'Carried', time: '04.10' },
    { state: 'ok', title: 'Today', time: '08:00' },
  ]);
  render(dir);
  const html = page(dir);
  assert.deepStrictEqual([...html.matchAll(/>(Sep|Oct|Aug)<\/button>/g)].map((m) => m[1]), ['Oct', 'Sep', 'Aug'], 'plans newest first by date');
  assert.deepStrictEqual([...html.matchAll(/>(Carried|Today)<\/button>/g)].map((m) => m[1]), ['Today', 'Carried'], 'a day mark is older than today');
  assert.match(html, /<summary class="hd">Done today <span>2<\/span><span class="lt">08:00<\/span>/, 'the last time is today\'s');
});

// Owner, 2026-10-05: a decision row named the question but not the options or a recommendation, so it
// could not be answered from the page ("hatırlamıyorum ve önerilerin dispatch de değil"). A row waiting
// on the owner's decision carries the question (`ask`), two or more options in plain words (`options`)
// and the one recommended (`rec`), and its detail shows them; an action row needs only the action and where.
const DEC = { state: 'you', title: 'Varsayılan yapı', ask: 'Yeni ekip varsayılan mı olsun?', options: ['Evet, varsayılan', 'Hayır, eski yapı kalsın', 'Sadece büyük işlerde'], rec: 'Sadece büyük işlerde', time: '09:00' };
test('decision rows: a you row with ask, options and rec renders the question, the options and the marked recommendation', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [DEC, { state: 'you', title: 'Eklentileri yeniden yükle', small: 'Claude Code: /reload-plugins', time: '09:05' }]);
  assert.strictEqual(render(dir).status, 0);
  const cd = (page(dir).match(/<div class="cd" id="d-you-varsayilan-yapi-[0-9a-z]+">([\s\S]*?)<\/div>/) || [])[1];
  assert.strictEqual(cd, '<b>Varsayılan yapı</b><p class="ask">Yeni ekip varsayılan mı olsun?</p><ol class="opt"><li>Evet, varsayılan</li><li>Hayır, eski yapı kalsın</li><li class="rec">Sadece büyük işlerde <em>önerim</em></li></ol>');
  assert.match(page(dir), />Eklentileri yeniden yükle<\/button>/, 'an action row needs only the action and where');
  const en = tmpdir(t); init(en);
  setRows(en, [{ ...DEC, rec: 'Evet, varsayılan' }]);
  render(en);
  assert.match(page(en), /<li class="rec">Evet, varsayılan <em>recommended<\/em><\/li>/);
  // the options stay readable on any page: list items, numbered, never a grid row
  const { STRIP_CSS } = require('../tools/tracker.js');
  assert.ok(STRIP_CSS.some((c) => c.includes('.cd ol.opt>li{display:list-item')));
});
test('decision rows: a decision without its question, two options or a recommendation among them is refused', (t) => {
  const dir = tmpdir(t); init(dir);
  const bad = [
    { ...DEC, ask: undefined },
    { ...DEC, options: ['Evet, varsayılan'], rec: 'Evet, varsayılan' },
    { ...DEC, options: ['Evet', ' '], rec: 'Evet' },
    { ...DEC, rec: undefined },
    { ...DEC, rec: 'Başka bir şey' },
    { state: 'you', title: 'Only rec', rec: 'x', time: '09:00' },
  ];
  for (const r of bad) {
    setRows(dir, [r]);
    const out = render(dir);
    assert.strictEqual(out.status, 1, JSON.stringify(r));
    assert.match(out.stderr, /waits on the owner's decision: it needs ask \(the question\), options \(two or more, in plain words\) and rec \(one of the options\)/);
  }
  // a decided row moved to done keeps its fields without being checked
  setRows(dir, [{ ...DEC, state: 'ok', rec: undefined }]);
  assert.strictEqual(render(dir).status, 0);
});
test('decision rows: an owner entry with reason decision makes its you row a decision', (t) => {
  const dir = tmpdir(t); init(dir);
  setRows(dir, [{ state: 'you', title: 'Seçim', time: '09:00' }]);
  const before = fs.readFileSync(path.join(dir, 'rows.json'), 'utf8');
  const r = crew(dir, ['--role', 'lead', '--job', 'Seçim', '--state', 'owner', '--reason', 'decision', '--row', 'Seçim']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /"Seçim" waits on the owner's decision/);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'), before, 'nothing written');
  assert.strictEqual(crew(dir, ['--role', 'lead', '--job', 'Seçim', '--state', 'owner', '--reason', 'approval', '--row', 'Seçim']).status, 0, 'an approval is an action');
  setRows(dir, [{ ...DEC, title: 'Seçim' }]);
  assert.strictEqual(crew(dir, ['--role', 'lead', '--job', 'Seçim', '--state', 'owner', '--reason', 'decision', '--row', 'Seçim']).status, 0);
});
test('decision rows: row --ask --option --rec writes them; a refused row is not written', (t) => {
  const dir = tmpdir(t); init(dir);
  assert.strictEqual(row(dir, ['--title', 'Seçim', '--state', 'you', '--ask', 'Hangisi?', '--option', 'A', '--option', 'B', '--rec', 'B']).status, 0);
  const r = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'))[0];
  assert.deepStrictEqual([r.ask, r.options, r.rec], ['Hangisi?', ['A', 'B'], 'B']);
  const out = row(dir, ['--title', 'Seçim 2', '--state', 'you', '--ask', 'Hangisi?', '--option', 'A']);
  assert.strictEqual(out.status, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8')).length, 1, 'not written');
});
test('decision rows: the rule is written in the orchestrate skill', () => {
  const skill = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'orchestrate', 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  for (const w of ['the question (`ask`)', 'two or more options in plain words (`options`)', 'the one recommended (`rec`)', 'An action row (a sign-in, a reload, an approval of one thing) needs only the action and where it is done'] ) assert.ok(skill.includes(w), w);
});
