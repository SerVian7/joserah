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
// every row's detail ends with its (hidden) note form
const FORM = '<form class="ans"[^>]*>[\\s\\S]*?</form>';
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
  const order = [...page(dir).matchAll(/aria-controls="[^"]+">(\w+)<\/button>/g)].map((m) => m[1]);
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
  assert.ok(p.indexOf('>a</button>') < p.indexOf('>B</button>'));
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
// The Theme (Trail spec, 2026-10-05, option A): tokens and the base console rules live in tools/lib/theme.js,
// one source for the Tracker, the Trail and every later page.
test('theme: tokens and base console rules come from tools/lib/theme.js; every render puts the theme back', (t) => {
  const theme = require('../tools/lib/theme.js');
  assert.match(theme.TOKENS_CSS, /^:root\{color-scheme:light dark;--bg:/);
  assert.match(theme.TOKENS_CSS, /\n@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{/);
  assert.match(theme.TOKENS_CSS, /\n:root\[data-theme="dark"\]\{/);
  assert.ok(CONSOLE_CSS.startsWith(`${theme.BASE_CSS}\n`), 'the console style opens with the shared base');
  assert.strictEqual(CLIP_JS, theme.CLIP_JS);
  assert.strictEqual(theme.css(), `${theme.TOKENS_CSS}\n${theme.BASE_CSS}`);
  const f = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'tracker', 'index.html'), 'utf8');
  assert.ok(f.includes(`<style id="theme">\n${theme.TOKENS_CSS}\n</style>`), 'template and theme agree');
  assert.strictEqual(f.split(':root{color-scheme').length, 2, 'the tokens once, in the theme style');
  // a page made before the move gets the theme style once, before its own styles (a page's own tokens win,
  // owner's page palette, 2026-10-05: the links had turned blue), and the console last
  const dir = tmpdir(t); init(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), page(dir).replace(/<style id="theme">[\s\S]*?<\/style>\n/, ''));
  render(dir); render(dir);
  const h = page(dir);
  assert.strictEqual(h.split('<style id="theme">').length, 2, 'one theme style');
  assert.ok(h.indexOf('<style id="theme">') < h.indexOf('<style>') && h.indexOf('<style>') < h.indexOf('<style id="console">'));
  assert.ok(f.indexOf('<style id="theme">') < f.indexOf('<style>'), 'the template has it first too');
});
// Lead, 2026-10-05: today's Daily Tracker turned its links blue after the Theme moved out (ef85fca). The
// render put the shared tokens after the page's own styles, so they overrode the page's palette. A page's
// own tokens are the last word; the Theme only fills in what the page does not define.
test('a page\'s own colour tokens win over the Theme\'s', (t) => {
  const theme = require('../tools/lib/theme');
  const dir = tmpdir(t); init(dir);
  const own = ':root{--bg:#f5f3f2;--ink:#2a2326;--link:#8B0D32;--brand:#8B0D32}';
  fs.writeFileSync(path.join(dir, 'index.html'), page(dir).replace('<style>\n', `<style>\n${own}\n`));
  render(dir); render(dir);
  const h = page(dir);
  const last = (tok) => { const all = [...h.matchAll(new RegExp(`${tok}:([^;}]+)`, 'g'))]; return all[all.length - 1][1]; };
  assert.deepStrictEqual([last('--link'), last('--bg'), last('--ink')], ['#8B0D32', '#f5f3f2', '#2a2326'], 'in document order, the page has the last word');
  assert.ok(h.includes(theme.TOKENS_CSS), 'the Theme is still there, for what the page does not define');
  assert.match(last('--run'), /^#(2563a8|6ea8e6)$/, 'a token the page lacks comes from the Theme (its light or dark value)');
});
test('a main job with sub-jobs: a category line in each group; only a finished one folds; no running word', (t) => {
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
  assert.match(s, /<li class="cat"><ul class="ch">\n  <li class="crew-line run" data-key="[^"]+" data-sig="[^"]+">[^\n]*aria-controls="d-run-main-[0-9a-z]+">Main <span class="n">1<\/span><\/button>/);
  assert.doesNotMatch(html, /<em>running<\/em>|sürüyor<\/em>/, 'a category never says running: Active work says it once');
  assert.match(s, /<\/ul><ol>\n  <li class="crew-line run" data-key="[^"]+" data-sig="[^"]+">[^\n]*>Sub running<\/button>/);
  // one sub-job in a group: under its category line, like any other
  assert.match(secOf(html, 'you'), /<span class="jt">Main<\/span><span>1<\/span><\/div><ol>\n[^\n]*>Ask<\/button>/);
  // done: the category folds, closed, with its count and last time; newest first inside
  const ok = secOf(html, 'ok');
  assert.match(ok, /<li class="cat"><details name="trk-ok" id="f-ok-main-[0-9a-z]+"><summary class="jh"><span class="jt">Main<\/span><span>2 · 09:20<\/span><\/summary><ol>[\s\S]*Sub done 2[\s\S]*Sub done 1[\s\S]*<\/ol><\/details><\/li>/);
  assert.ok(ok.indexOf('Loose') < ok.indexOf('class="cat"'), 'a category stands where its newest member stands (done: newest first)');
  assert.doesNotMatch(secOf(html, 'you'), /<details/, 'the owner group never folds');
  assert.doesNotMatch(html, /<details[^>]*\sopen/, 'closed by default');
});
// Owner, 2026-10-05: "bunlardan biri joserah, biri zenger neden ayrı?" — a plan row with only a parent went
// to Other; "NEden joserah zenger gibi grup ismi değil?" — a lone row was prefixed instead of grouped.
test('plans fold by their group, else their parent; Other only for neither', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [
    { state: 'ok', title: 'Zenger', time: '07:00' },
    { state: 'plan', title: 'P parent', parent: 'Zenger', time: '08:00' },
    { state: 'plan', title: 'P group', group: 'Zenger', time: '08:10' },
    { state: 'plan', title: 'P none', time: '08:20' },
  ]);
  render(dir);
  const pl = secOf(page(dir), 'plan');
  assert.deepStrictEqual([...pl.matchAll(/<summary class="jh"><span class="jt">([^<]+)<\/span><span>(\d)<\/span>/g)].map((m) => `${m[1]} ${m[2]}`), ['Diğer 1', 'Zenger 2']);
  assert.match(pl, /<span class="jt">Zenger<\/span><span>2<\/span><\/summary><ol>\n[^\n]*>P group<\/button>[\s\S]*>P parent<\/button>/);
});
test('a row with only a group stands under that group\'s line in every section; no line repeats its group', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [
    { state: 'wait', title: 'Dell teklifi', group: 'Zenger', time: '09:00' },
    { state: 'wait', title: 'AWS testi', parent: 'Zenger', time: '09:10' },
    { state: 'ok', title: 'Zenger', time: '07:00' },
    { state: 'run', title: 'Arayüz', group: 'Joserah', time: '09:20' },
  ]);
  render(dir);
  const html = page(dir);
  assert.match(secOf(html, 'wait'), /<li class="cat"><div class="jh"><span class="jt">Zenger<\/span><span>2<\/span><\/div><ol>\n[^\n]*>AWS testi<\/button>[\s\S]*>Dell teklifi<\/button>/);
  assert.match(stripOf(html), /<li class="cat"><div class="jh"><span class="jt">Joserah<\/span><span>1<\/span><\/div><ol>\n[^\n]*>Arayüz<\/button>/, 'a group of one is still a group');
  assert.doesNotMatch(html, /class="ct"/, 'no "<group> ·" prefix anywhere');
});
// Owner, 2026-10-05: "neden başlık açıklama ile aynı" — a plan row from next.md (title only) opened onto its
// own title again.
test('a row with nothing more to show never repeats its title under itself', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [{ state: 'plan', title: 'Fatura adresini teyit et', group: 'Zenger', time: '30.08' }]);
  render(dir);
  const html = page(dir);
  assert.strictEqual(html.split('Fatura adresini teyit et<').length, 2, 'the title once: on its line');
  assert.match(html, /<div class="cd bare fm" id="d-plan-fatura[^"]*"><form class="ans"/);
  const { CONSOLE_CSS } = require('../tools/tracker.js');
  assert.match(CONSOLE_CSS, /\.cd\.bare\{display:none\}html\.js-ans \.cd\.bare\.fm:not\(\[hidden\]\)\{display:block\}/, 'no empty panel; with answers on, the note alone');
});
// Owner, 2026-10-05: "bu altı şeffaflık durumu saçma sapan yapılmış düşünülmemiş".
test('a clamped list has no fade: no fade element, no fade style, the clamp cuts where the next line starts', (t) => {
  const { CLIP_JS } = require('../tools/tracker.js');
  const theme = require('../tools/lib/theme.js');
  assert.doesNotMatch(theme.BASE_CSS, /\.fade|linear-gradient/);
  assert.doesNotMatch(CLIP_JS, /fade/);
  assert.match(CLIP_JS, /b=l\[N\]\.getBoundingClientRect\(\)\.top;c\.style\.maxHeight=Math\.round\(b-t\)\+"px"/);
  const dir = tmpdir(t); init(dir);
  setRows(dir, [...Array(7)].map((_, i) => ({ state: 'wait', title: `w${i}`, time: `08:0${i}` })));
  render(dir);
  assert.match(page(dir), /class="clip clamp"/);
  assert.doesNotMatch(page(dir), /class="fade"/);
});
// Owner, 2026-10-05: "font stilleri ayırt edici ve sade olmalı"; "Aktif çalışma gibi alanların ayrı
// gözükmesi lazım stilde … çocuklar için de geçerli". One order: section > project group > line > meta.
test('style: each section is its own area; the section title outweighs a group name, a group name stays calm, its lines indent', () => {
  const { CONSOLE_CSS } = require('../tools/tracker.js');
  const rule = (sel) => (CONSOLE_CSS.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')) || [])[1] || '';
  const weight = (r) => +((r.match(/font:(\d{3})/) || [])[1]);
  const size = (r) => +((r.match(/font:\d{3} ([\d.]+)px/) || [])[1]);
  const sec = rule('main .blk>.hd,main .blk>details>summary.hd,main .crew>.hd');
  const grp = rule('li.cat>.jh,li.cat>details>summary');
  const line = rule(':is(.crew,main) li.crew-line');
  assert.ok(weight(sec) > weight(grp), 'the section title is heavier than a group name');
  assert.match(sec, /color:var\(--ink\)/);
  assert.match(grp, /color:var\(--muted\)/, 'a group name is calm, not bright');
  assert.ok(weight(grp) > weight(line), 'a group name is still told apart from its lines');
  assert.ok(size(line) > size(grp), 'a line reads larger than its group name');
  assert.match(rule('section.crew,main .blk'), /background:var\(--card\);border:1px solid var\(--line\);border-top:3px solid/, 'a section is an area of its own');
  assert.match(rule('li.cat>ol,li.cat>details>ol'), /padding-left:14px;border-left:2px solid var\(--line\)/, 'a group\'s lines indent under it');
  assert.doesNotMatch(CONSOLE_CSS, /li\.cat \.jh em|li\.cat summary em/, 'no running word on a group');
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
  assert.match(w, /<li class="cat"><ul class="ch">\n  <li data-st="wait" class="crew-line wait" data-key="[^"]+" data-sig="[^"]+">[^\n]*>W main <span class="n">1<\/span><\/button>[\s\S]*<\/ul><ol>\n  <li data-st="wait" class="crew-line wait" data-key="[^"]+" data-sig="[^"]+">[^\n]*>W sub<\/button>/);
  assert.match(secOf(page(dir), 'plan'), /<details name="trk" id="f-plan-alpha-[0-9a-z]+"><summary class="jh"><span class="jt">Alpha<\/span><span>1<\/span><\/summary><ol>\n[^\n]*>P sub<\/button>/);
});
test('a long list shows its first lines: more than five units get a button, five do not; no fade', (t) => {
  const dir = tmpdir(t); init(dir);
  const n = (k, state) => [...Array(k)].map((_, i) => ({ state, title: `${state} ${i}`, time: `08:0${i}` }));
  setRows(dir, [...n(6, 'ok'), ...n(5, 'plan'), ...n(7, 'run'), ...n(7, 'you'), ...n(6, 'wait')]);
  render(dir);
  const html = page(dir);
  for (const k of ['ok', 'wait']) {
    assert.match(secOf(html, k), new RegExp(`<div class="clip clamp" id="clip-${k}">`), k);
    assert.match(secOf(html, k), new RegExp(`</ol></div><button type="button" class="more" aria-expanded="false" aria-controls="clip-${k}"[^>]*>all \\(\\d+\\)</button>`), k);
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
  const { ANSWER_JS } = require('../tools/tracker.js');
  assert.ok(f.includes(`<script id="clip">${CLIP_JS}</script>\n<script id="panel">${PANEL_JS}</script>\n<script id="state">${STATE_JS}</script>\n<script id="answer">${ANSWER_JS}</script>\n<script id="motion">${require('../tools/tracker.js').MOTION_JS}</script>\n</body>`), 'template and renderer agree (scripts)');
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
  assert.match(html, /<div class="cd bare" id="d-[a-z0-9-]+"><\/div>/, 'ctx alone: no tail, and no panel repeating the title');
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
  assert.match(ls[1], /^<li class="crew-line run" data-key="[^"]+" data-sig="[^"]+"><span class="ic"><span class="sq"><\/span><\/span><button type="button" class="tx" aria-expanded="false" aria-controls="(d-run-r-one-[0-9a-z]+)">R one<\/button><time>09:00<\/time><button type="button" class="rp"[^>]*hidden>[\s\S]*?<\/button><\/li>$/, 'a run row with no entry: the square mark');
  assert.match(stripOf(html), new RegExp('<div class="cd bare fm" id="d-run-r-one-[0-9a-z]+">' + FORM + '</div>'), 'nothing more to show: no title repeated, only the note form');
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
  assert.match(sinan, /^<li class="crew-line work" data-role="lead" data-key="[^"]+" data-sig="[^"]+"><span class="ic"><span role="img" title="Lead · yönetiyor" aria-label="Lead · yönetiyor"><svg[\s\S]*?<\/svg><\/span><span role="img" title="Builder · kod yazıyor" aria-label="Builder · kod yazıyor"><svg/);
  // Zenger runs too: it is the category line, Sinan under it without a prefix, the row's link on the line
  const sid = sinan.match(/aria-controls="(d-run-[^"]+)">Sinan Bey'e cevap<\/button><a class="lk" href="https:\/\/example\.com\/d" target="_blank" rel="noopener">taslak<\/a>/)[1];
  assert.match(stripOf(html), /<li class="cat"><ul class="ch">\n  <li class="crew-line run" data-key="[^"]+" data-sig="[^"]+">[^\n]*>Zenger <span class="n">1<\/span><\/button>/);
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
  assert.doesNotMatch(s, /<div class="cd[^"]*"[^>]*\shidden/, 'without script every detail shows');
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
  assert.match(stripOf(html), /class="jt">Dell[\s\S]*?>Fiyat/);
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
  assert.match(cdOf(pepLine), /^<b>Zenger · Peplink planı<\/b><p>plan hazır<\/p><p class="nx"><span>sonraki<\/span> tek evet<\/p><p class="ln"><a href="https:\/\/example\.com\/entry"[^>]*>sayfa<\/a><\/p><form class="ans"[^>]*>[\s\S]*<\/form>$/);
  assert.doesNotMatch(stripOf(html), /class="dl"|karar sayfası/, 'no decision link');
  // no row, a url: the url is in its detail (the build note: an entry's url shows in the detail, not on the line)
  const direct = ls.find((l) => l.includes('Row-less with url'));
  assert.doesNotMatch(direct, /example\.com\/direct/);
  assert.match(cdOf(direct), /<a href="https:\/\/example\.com\/direct"[^>]*>sayfa<\/a>/);
  // neither: nothing to show, so no panel of its own (it would only repeat the job)
  const bare = ls.find((l) => l.includes('Row-less, no url'));
  assert.match(stripOf(html), new RegExp('<div class="cd bare" id="' + id(bare) + '"></div>'));
  // a run row with nothing more to show: only its note form, never its title again
  assert.match(cdOf(ls.find((l) => l.includes('Bare run'))), new RegExp('^' + FORM + '$'));
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
  assert.match(w, /<li class="cat"><div class="jh"><span class="jt">Alpha<\/span><span>2<\/span><\/div><ol>/, 'Alpha: a category line; running is said only in Active work');
  const alpha = w.match(/<li class="cat">[\s\S]*?<\/ol><\/li>/)[0];
  for (const x of ['A1', 'A2']) assert.match(alpha, new RegExp(`aria-controls="[^"]+">${x}</button>`), `${x} under Alpha, no prefix`);
  assert.match(w, /<li class="cat"><div class="jh"><span class="jt">Beta<\/span><span>1<\/span><\/div><ol>\n[^\n]*aria-controls="[^"]+">B1<\/button>/, 'one row of Beta: under its own category line too');
  assert.ok(w.indexOf('Alpha') < w.indexOf('B1'), 'newest first: Alpha (A2 09:20) before B1 (09:15)');
  // a parent in the same group is the category line itself
  const d2 = tmpdir(t); init(d2);
  setRows(d2, [{ state: 'you', title: 'Main', time: '09:00' }, { state: 'you', title: 'Sub', parent: 'Main', time: '09:10' }]);
  render(d2);
  const you = secOf(page(d2), 'you');
  assert.match(you, /<li class="cat"><ul class="ch">\n  <li data-st="you" class="crew-line you" data-key="[^"]+" data-sig="[^"]+"><span class="ic"><span class="sq"><\/span><\/span><button type="button" class="tx" aria-expanded="false" aria-controls="d-you-main-[0-9a-z]+">Main <span class="n">1<\/span><\/button>/);
  assert.match(you, /<\/ul><ol>\n  <li data-st="you" class="crew-line you" data-key="[^"]+" data-sig="[^"]+">[^\n]*>Sub<\/button>/);
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
  assert.match(html, /<div class="cd" id="d-you-y-[0-9a-z]+"><b>Y<\/b><p class="dl"><a href="https:\/\/example\.com\/y" target="_blank" rel="noopener">karar sayfası<\/a><\/p><p>karar lazım<\/p><p class="nx"><span>sonraki<\/span> evet deyin<\/p><form class="ans"[^>]*>[\s\S]*?<\/form><\/div>/);
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
  assert.match(of('L1'), /<\/button><a class="lk" href="https:\/\/example\.com\/a" target="_blank" rel="noopener">İş akışı<\/a><time>09:00<\/time><button type="button" class="rp"[\s\S]*<\/button><\/li>$/);
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
  assert.match(you, /<div class="cd" id="d-you-plan-onay[^"]*"><b>Plan onayı<\/b><p class="dl"><a href="https:\/\/example\.com\/plan" target="_blank" rel="noopener">plan<\/a> <em>onay<\/em><\/p><form class="ans"[^>]*>[\s\S]*?<\/form><\/div>/);
  assert.match(you, /aria-controls="d-you-[^"]+">Kaynak seçimi<\/button>/);
  assert.match(you, /<p class="dl"><a href="https:\/\/example\.com\/pick" target="_blank" rel="noopener">karar sayfası<\/a> <em>karar<\/em><\/p>/);
});
test('board: in developer mode the model tail is in the detail, never on the line', (t) => {
  const dir = devWs(t);
  setRows(dir, [{ state: 'run', title: 'Kod', time: '09:00' }]);
  crew(dir, ['--role', 'builder', '--job', 'Kod', '--state', 'work', '--row', 'Kod', '--model', 'opus', '--effort', 'high']);
  const s = stripOf(page(dir));
  assert.doesNotMatch(linesOf(page(dir))[0], /class="cm"|opus/);
  assert.match(s, /<div class="cd" id="d-run-kod-[0-9a-z]+"><b>Kod<\/b><p class="cm">opus · high<\/p><form class="ans"[^>]*>[\s\S]*?<\/form><\/div>/);
});
test('board: phone width puts the link under the text; only the time and the link label never wrap', () => {
  const { CONSOLE_CSS } = require('../tools/tracker.js');
  assert.match(CONSOLE_CSS, /@media \(max-width:560px\)\{[^\n]*li\.crew-line\{[^}]*grid-template-areas:"m x r t" "\. l \. \."/);
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
  assert.match(s, /<li class="cat"><div class="jh"><span class="jt">Joserah · crew<\/span><span>2<\/span><\/div><ol>\n[^\n]*>One<\/button>[\s\S]*>Two<\/button>/);
  assert.match(s, /class="jt">Zenger[\s\S]*?>Solo<\/button>/);
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
  assert.match(you, /class="jt">Top[\s\S]*?>B<\/button>/);
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
// could not be answered from the page ("hatırlamıyorum ve önerilerin dispatch de değil"); and a question
// in one run-on line was hard to read ("bunu daha güzel formatlayamaz mısın?"). A row waiting on the
// owner's decision is the question (its title) with options [{key, label, text}], recommend (a key) and
// why (one line); its detail shows each option on its own line, the recommended one marked, the why
// under it. An action row needs only the action and where.
const DEC = {
  state: 'you', title: 'Soru: rapor nasıl kurulsun?', time: '09:00',
  options: [{ key: 'A', label: 'İki aşama', text: 'önce acil kapanacaklar, sonra taşıma' }, { key: 'B', label: 'Tek tasarım', text: 'hepsi birlikte' }],
  recommend: 'A', why: 'açıklar hemen kapanır',
};
test('decision rows: the detail shows each option on its own line, the recommendation marked with its why; the question is the line itself', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [DEC, { state: 'you', title: 'Eklentileri yeniden yükle', small: 'Claude Code: /reload-plugins', time: '09:05' }]);
  assert.strictEqual(render(dir).status, 0);
  const cd = (page(dir).match(/<div class="cd" id="d-you-soru-rapor-nasil-kurulsun-[0-9a-z]+">([\s\S]*?)<\/div>/) || [])[1];
  assert.ok(cd.startsWith('<b>Soru: rapor nasıl kurulsun?</b><ul class="opt">'
    + '<li class="rec" data-k="A" data-l="İki aşama"><span class="k">A</span><span class="ol">İki aşama</span> <em>önerim</em><span class="ot">önce acil kapanacaklar, sonra taşıma</span><span class="why">açıklar hemen kapanır</span></li>'
    + '<li data-k="B" data-l="Tek tasarım"><span class="k">B</span><span class="ol">Tek tasarım</span><span class="ot">hepsi birlikte</span></li></ul><form class="ans"'), cd);
  assert.doesNotMatch(cd, /cevap:/, 'no answer boilerplate');
  assert.doesNotMatch(cd, /class="ask"/, 'the question is not repeated under its own line');
  assert.match(page(dir), />Eklentileri yeniden yükle<\/button>/, 'an action row needs only the action and where');
  const en = tmpdir(t); init(en);
  setRows(en, [{ ...DEC, recommend: 'b' }]);
  render(en);
  assert.match(page(en), /<li class="rec" data-k="B" data-l="Tek tasarım"><span class="k">B<\/span><span class="ol">Tek tasarım<\/span> <em>recommended<\/em>/, 'the key matches case-blind');
  const { STRIP_CSS } = require('../tools/tracker.js');
  const css = STRIP_CSS.join('\n');
  assert.match(css, /\.cd ul\.opt>li\{display:block/, 'one option per line, never a grid row');
  assert.match(css, /\.cd ul\.opt em\{[^}]*color:var\(--you\)/, 'the recommendation tag in the owner colour (the page brand)');
});
test('decision rows: options, unique keys, a recommendation among them and its why are required', (t) => {
  const dir = tmpdir(t); init(dir);
  const bad = [
    { ...DEC, options: [DEC.options[0]] },
    { ...DEC, options: [DEC.options[0], { ...DEC.options[1], key: 'a' }] },
    { ...DEC, options: [DEC.options[0], { key: 'B' }] },
    { ...DEC, options: [DEC.options[0], { label: 'x' }] },
    { ...DEC, options: 'A or B' },
    { ...DEC, recommend: undefined },
    { ...DEC, recommend: 'C' },
    { ...DEC, why: ' ' },
    { state: 'you', title: 'Only why', why: 'x', time: '09:00' },
  ];
  for (const r of bad) {
    setRows(dir, [r]);
    const out = render(dir);
    assert.strictEqual(out.status, 1, JSON.stringify(r));
    assert.match(out.stderr, /waits on the owner's decision: it needs options \(two or more, each with its own key and a label or text\), recommend \(one of the keys\) and why \(one line\)/);
  }
  setRows(dir, [{ ...DEC, state: 'ok', recommend: undefined }]);
  assert.strictEqual(render(dir).status, 0, 'a decided row moved to done is not checked');
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
test('decision rows: row --option key|label|text --recommend --why writes them; a refused row is not written', (t) => {
  const dir = tmpdir(t); init(dir);
  assert.strictEqual(row(dir, ['--title', 'Hangisi?', '--state', 'you', '--option', 'A|Birinci|uzun açıklama', '--option', 'B|İkinci', '--recommend', 'B', '--why', 'daha kısa']).status, 0);
  const r = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'))[0];
  assert.deepStrictEqual([r.options, r.recommend, r.why], [[{ key: 'A', label: 'Birinci', text: 'uzun açıklama' }, { key: 'B', label: 'İkinci' }], 'B', 'daha kısa']);
  const out = row(dir, ['--title', 'Hangisi 2?', '--state', 'you', '--option', 'A|Tek', '--recommend', 'A', '--why', 'x']);
  assert.strictEqual(out.status, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8')).length, 1, 'not written');
});
test('decision rows: the rule is written in the orchestrate skill', () => {
  const skill = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'orchestrate', 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  for (const w of ['its title is the question', '`options` (two or more, each `{key, label, text}`)', '`recommend` (one of the keys)', '`why` (one line)', 'An action row (a sign-in, a reload, an approval of one thing) needs only the action and where it is done']) assert.ok(skill.includes(w), w);
});

// Owner, 2026-10-05: "hatta bunlara textbox ve seçim yetenekleri getirelim widgetlara yine tema ve
// fikirlerimize uyan cinsten ihtiyacı net karşılayan." An owner question row is answered on the page: one
// button per option (the recommended one marked), an optional short note and Send; the answer is kept in
// the artifact's own database (the `db` capability: collection `answers`, one document per question, its id
// made from the row's title), so the main session reads it; the row then says "cevaplandı: A · HH:MM",
// also after a reload. Without the capability the form stays hidden and the row reads as before.
const ANS = {
  state: 'you', title: 'Soru: rapor nasıl kurulsun?', time: '09:00',
  options: [{ key: 'A', label: 'İki aşama', text: 'önce acil kapanacaklar' }, { key: 'B', label: 'Tek tasarım' }],
  recommend: 'A', why: 'açıklar hemen kapanır',
};
// Owner, 2026-10-05: "şıklar direk seçilebilmeli altta niye ayrı buton var"; "her satıra cevap
// verebilmeliyim. aslında küçük bir ikonla". A question's option lines are the choice; every row's detail
// ends with a note form; every row's line has a small reply icon.
test('answers: every row\'s detail ends with a hidden note form; a question row\'s form is the choice, its option lines carry the keys', (t) => {
  const { slugId } = require('../tools/tracker.js');
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [ANS, { state: 'you', title: 'Eklentileri yeniden yükleyin', time: '09:05' }, { ...ANS, state: 'ok', title: 'Eski soru?' }]);
  render(dir);
  const html = page(dir);
  const id = slugId('a', ANS.title);
  assert.match(id, /^a-soru-rapor-nasil-kurulsun-[0-9a-z]+$/);
  assert.strictEqual(html.split('<form class="ans"').length, 4, 'one form per row');
  assert.strictEqual(html.split('data-choice="1"').length, 2, 'only the open question row chooses');
  const f = html.match(new RegExp(`<form class="ans" data-ans="${id}"[\\s\\S]*?</form>`))[0];
  assert.strictEqual(f, `<form class="ans" data-ans="${id}" data-row="Soru: rapor nasıl kurulsun?" data-choice="1" hidden>`
    + `<input type="text" id="n-${id}" name="note" maxlength="500" placeholder="not (isteğe bağlı)" aria-label="not (isteğe bağlı)">`
    + '<button type="submit" class="send" disabled>Gönder</button><span class="err" role="status" hidden></span></form>');
  assert.doesNotMatch(html, /class="ak"/, 'no separate key buttons');
  assert.match(html, /<ul class="opt"><li class="rec" data-k="A" data-l="İki aşama"><span class="k">A<\/span>[\s\S]*?<li data-k="B" data-l="Tek tasarım">/, 'each option line carries its key and label');
  const act = slugId('a', 'Eklentileri yeniden yükleyin');
  assert.match(html, new RegExp(`<form class="ans" data-ans="${act}" data-row="Eklentileri yeniden yükleyin" hidden><input [^>]*placeholder="not yazın" aria-label="not yazın">`), 'a row with no question: the note alone');
  assert.match(html, new RegExp(`>Soru: rapor nasıl kurulsun\\? <span class="an" data-an="${id}" hidden></span></button>`), 'the question line has a hidden answered tag');
  assert.doesNotMatch(html, />Eklentileri yeniden yükleyin <span class="an"/, 'only a question says answered');
  const en = tmpdir(t); init(en); setRows(en, [ANS]); render(en);
  assert.match(page(en), /placeholder="note \(optional\)"[\s\S]*>Send<\/button>/);
  assert.strictEqual(page(dir).split('<script id="answer">').length, 2, 'one answer script on the page');
});
test('answers: every row\'s line has a hidden reply icon that names its detail and its answer id; a crew entry with no row has none', (t) => {
  const { slugId } = require('../tools/tracker.js');
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [{ state: 'wait', title: 'Dell teklifi', url: 'https://example.com/d', time: '09:00' }]);
  crew(dir, ['--role', 'scout', '--job', 'Kendi işi', '--state', 'work']);
  const html = page(dir);
  const line = lis(dir).find((l) => l.includes('Dell teklifi'));
  const det = line.match(/aria-controls="([^"]+)"/)[1];
  assert.match(line, new RegExp(`<time>09:00</time><button type="button" class="rp" data-rp="${det}" data-nt="${slugId('a', 'Dell teklifi')}" title="not yazın" aria-label="not yazın" hidden><svg[^>]*aria-hidden="true">[\\s\\S]*?</svg></button></li>$`));
  assert.strictEqual(html.split('class="rp"').length, 2, 'the crew-only line has no reply icon');
  const { CONSOLE_CSS } = require('../tools/tracker.js');
  assert.match(CONSOLE_CSS, /li\.crew-line>\.rp\{position:relative;z-index:1/, 'above the line\'s own click area');
});

// a small DOM for the answer script: only what it touches
function answerDom(ids, { choice = true } = {}) {
  const el = (attrs = {}, extra = {}) => {
    const a = { ...attrs }; const ls = {}; const cls = new Set();
    return { a, hidden: !!extra.hidden, disabled: !!extra.disabled, textContent: '', value: '', ...extra,
      classList: { add(c) { cls.add(c); }, contains(c) { return cls.has(c); } },
      getAttribute(k) { return k in a ? a[k] : null; }, setAttribute(k, v) { a[k] = String(v); },
      addEventListener(ev, f) { (ls[ev] = ls[ev] || []).push(f); }, fire(ev, e = {}) { for (const f of ls[ev] || []) f({ preventDefault() {}, target: this, ...e }); } };
  };
  const forms = []; const tags = []; const rps = []; const byId = {};
  const root = el({}); root.lang = 'tr';
  for (const id of ids) {
    const keys = choice ? [el({ 'data-k': 'A', 'data-l': 'İki aşama' }), el({ 'data-k': 'B', 'data-l': 'Tek tasarım' })] : [];
    const input = el({}, { value: '', focused: 0, focus() { this.focused++; } }); const send = el({}, { disabled: true }); const err = el({}, { hidden: true });
    const f = el({ 'data-ans': id, 'data-row': `row ${id}`, ...(choice ? { 'data-choice': '1' } : {}) }, { hidden: true });
    f.querySelector = (s) => ({ input, '.send': send, '.err': err })[s] || null;
    const cd = el({ id: `d-${id}` }, { hidden: true });
    cd.querySelectorAll = (s) => (s === 'ul.opt li[data-k]' ? keys : []);
    cd.querySelector = (s) => (s === 'form.ans input' ? input : null);
    f.parentNode = cd; byId[`d-${id}`] = cd;
    const tx = el({ 'aria-expanded': 'false' }, { clicks: 0, click() { this.clicks++; this.a['aria-expanded'] = 'true'; cd.hidden = false; } });
    const rp = el({ 'data-rp': `d-${id}`, 'data-nt': id }, { hidden: true });
    rp.parentNode = { querySelector: (s) => (s === 'button.tx' ? tx : null) };
    f.keys = keys; f.input = input; f.send = send; f.err = err; f.tx = tx; f.rp = rp; f.cd = cd;
    forms.push(f); rps.push(rp); tags.push(el({ 'data-an': id }, { hidden: true }));
  }
  const document = { documentElement: root, getElementById: (i) => byId[i] || null,
    querySelectorAll: (s) => (s === 'form.ans[data-ans]' ? forms : s === '[data-an]' ? (choice ? tags : []) : s === 'button.rp[data-rp]' ? rps : []) };
  return { document, forms, tags, rps, root };
}
function fakeDb({ existing = {}, fail } = {}) {
  const writes = []; let listener = null;
  const db = { collection(c) {
    return {
      doc(id) { return { set(data) { writes.push([c, id, data]); return fail ? Promise.reject(fail) : Promise.resolve(); } }; },
      onSnapshot(next) { listener = next; next({ docs: Object.entries(existing).map(([id, d]) => ({ id, exists: true, data: () => d })) }); return () => {}; },
    };
  } };
  return { db, writes, listener: () => listener };
}
const flush = () => new Promise((r) => setImmediate(r));
const runAnswer = (dom, use) => {
  const vm = require('vm');
  const { ANSWER_JS } = require('../tools/tracker.js');
  vm.runInNewContext(ANSWER_JS, { document: dom.document, window: use === undefined ? {} : { claude: { use } }, Date, Promise, String });
};
test('answers: with the database, the option lines are the choice; a choice and Send store the answer and the row says it is answered', async () => {
  const dom = answerDom(['a-q1']);
  const fdb = fakeDb();
  runAnswer(dom, (n) => Promise.resolve(n === 'db' ? fdb.db : null));
  await flush();
  const f = dom.forms[0];
  assert.strictEqual(f.hidden, false, 'shown once the database answers');
  assert.ok(dom.root.classList.contains('js-ans'), 'the page knows it can take answers');
  assert.strictEqual(f.send.disabled, true, 'nothing chosen yet');
  assert.deepStrictEqual(f.keys.map((k) => [k.getAttribute('role'), k.getAttribute('tabindex'), k.getAttribute('aria-pressed'), k.classList.contains('pk')]), [['button', '0', 'false', true], ['button', '0', 'false', true]], 'each option line becomes a button');
  f.keys[1].fire('click');
  assert.deepStrictEqual(f.keys.map((k) => k.getAttribute('aria-pressed')), ['false', 'true'], 'one choice at a time');
  f.keys[0].fire('keydown', { key: 'Enter' });
  assert.deepStrictEqual(f.keys.map((k) => k.getAttribute('aria-pressed')), ['true', 'false'], 'Enter chooses too');
  assert.strictEqual(f.send.disabled, false);
  f.input.value = '  hemen başlayalım  ';
  f.fire('submit');
  await flush();
  assert.strictEqual(fdb.writes.length, 1);
  const [col, id, data] = fdb.writes[0];
  assert.deepStrictEqual([col, id, data.row, data.key, data.label, data.note, data.state], ['answers', 'a-q1', 'row a-q1', 'A', 'İki aşama', 'hemen başlayalım', 'new']);
  assert.ok(!Number.isNaN(Date.parse(data.at)), 'an ISO time');
  assert.strictEqual(f.hidden, true, 'the form gives way to the answer');
  assert.match(dom.tags[0].textContent, /^cevaplandı: A · \d\d:\d\d$/);
  assert.strictEqual(dom.tags[0].hidden, false);
});
test('answers: a note alone on any row is its own document; the reply icon opens the detail at the note and is marked once sent', async () => {
  const dom = answerDom(['a-dell-teklifi-nx1'], { choice: false });
  const fdb = fakeDb();
  runAnswer(dom, () => Promise.resolve(fdb.db));
  await flush();
  const f = dom.forms[0]; const rp = dom.rps[0];
  assert.deepStrictEqual([f.hidden, rp.hidden, f.send.disabled], [false, false, true], 'the form and the icon show; nothing to send yet');
  rp.fire('click');
  assert.deepStrictEqual([f.tx.clicks, f.cd.hidden, f.input.focused], [1, false, 1], 'the icon opens the detail and focuses the note');
  rp.fire('click');
  assert.strictEqual(f.tx.clicks, 1, 'an open detail is not closed by the icon');
  f.input.value = '   '; f.input.fire('input');
  assert.strictEqual(f.send.disabled, true, 'blank is nothing');
  f.input.value = 'Onur’a da sor'; f.input.fire('input');
  assert.strictEqual(f.send.disabled, false);
  f.fire('submit');
  await flush();
  const [, id, data] = fdb.writes[0];
  assert.match(id, /^a-dell-teklifi-nx1--n[0-9a-z]+$/, 'a note: the row id, "--n" and a time');
  assert.deepStrictEqual([data.key, data.label, data.note, data.state, data.row], ['', '', 'Onur’a da sor', 'new', 'row a-dell-teklifi-nx1']);
  assert.strictEqual(f.hidden, false, 'a note form stays for the next note');
  assert.strictEqual(f.input.value, '', 'and is emptied');
  assert.strictEqual(rp.getAttribute('data-done'), '1');
  assert.match(rp.getAttribute('title'), /^not gönderildi · \d\d:\d\d$/);
});
test('answers: an answer already stored shows on load; a stored note marks its row\'s icon, never another row whose id ends like a note', async () => {
  const dom = answerDom(['a-q1', 'a-q2', 'a-x-nab']);
  const fdb = fakeDb({ existing: {
    'a-q2': { key: 'B', at: '2026-10-05T11:42:00.000Z', state: 'new' },
    'a-q1--nk1': { key: '', note: 'bir not', at: '2026-10-05T10:00:00.000Z', state: 'new' },
    'a-x-nab': { key: 'A', at: '2026-10-05T09:00:00.000Z', state: 'new' },
  } });
  runAnswer(dom, () => Promise.resolve(fdb.db));
  await flush();
  assert.deepStrictEqual([dom.forms[0].hidden, dom.forms[1].hidden], [false, true]);
  assert.match(dom.tags[1].textContent, /^cevaplandı: B · \d\d:\d\d$/);
  assert.strictEqual(dom.tags[0].hidden, true, 'a note is not an answer');
  assert.strictEqual(dom.rps[0].getAttribute('data-done'), '1', 'the note marks its row');
  assert.match(dom.tags[2].textContent, /^cevaplandı: A/, 'an id ending in "-n…" is still a row\'s own answer');
});
test('answers: without the capability, or with no write right, the row reads as before; nothing throws', async () => {
  for (const use of [undefined, () => Promise.resolve(null), () => Promise.reject(new Error('x'))]) {
    const dom = answerDom(['a-q1']);
    assert.doesNotThrow(() => runAnswer(dom, use));
    await flush();
    assert.deepStrictEqual([dom.forms[0].hidden, dom.rps[0].hidden], [true, true]);
  }
  const dom = answerDom(['a-q1']);
  const denied = fakeDb({ fail: { code: 'invalid_argument', message: 'no' } });
  runAnswer(dom, () => Promise.resolve(denied.db));
  await flush();
  dom.forms[0].keys[0].fire('click'); dom.forms[0].fire('submit');
  await flush();
  assert.strictEqual(dom.forms[0].hidden, true, 'no right to write: the form goes away');
  assert.strictEqual(dom.rps[0].hidden, true, 'and the reply icon with it');
  assert.strictEqual(dom.tags[0].hidden, true, 'and nothing claims an answer');
  const dom2 = answerDom(['a-q1']);
  const busy = fakeDb({ fail: { code: 'unavailable', message: 'later' } });
  runAnswer(dom2, () => Promise.resolve(busy.db));
  await flush();
  dom2.forms[0].keys[0].fire('click'); dom2.forms[0].fire('submit');
  await flush();
  assert.deepStrictEqual([dom2.forms[0].hidden, dom2.forms[0].err.hidden, dom2.forms[0].send.disabled], [false, false, false], 'a passing failure: say so, keep the choice, Send again');
  assert.match(dom2.forms[0].err.textContent, /gönderilemedi/);
});

// Owner, 2026-10-05: "tracker da sayfayı sürekli yeniden çizme satırı güncelle güzelce. animatik düşün temiz
// neat." A publish reloads every open view (the artifact runtime, contract 0.2.67: "every open view
// live-reloads to it"; in-place edits are for live docs only), so the page cannot be patched without one.
// What the page does: each line carries a stable key (from its title) and a signature of what it shows;
// after a reload the motion script compares them with the last load and animates only what changed — a new
// line slides in, a changed one flashes once, one that finished flashes in Done today — and keeps scroll and
// open details (STATE_JS). Reduced motion: no animation.
const keyOf = (l) => (l.match(/data-key="([^"]+)"/) || [])[1];
const sigOf = (l) => (l.match(/data-sig="([^"]+)"/) || [])[1];
const allLines = (html) => html.match(/<li [^>]*class="crew-line[^"]*"[^>]*>/g) || [];
test('motion: every line has a stable key from its title and a signature of what it shows', (t) => {
  const { slugId } = require('../tools/tracker.js');
  const dir = tmpdir(t); init(dir);
  setRows(dir, [{ state: 'you', title: 'Y', small: 'a', time: '09:00' }, { state: 'run', title: 'R', time: '09:01' }, { state: 'ok', title: 'D', time: '08:00' }]);
  render(dir);
  let ls = allLines(page(dir));
  assert.strictEqual(ls.length, 3);
  for (const l of ls) assert.ok(keyOf(l) && sigOf(l), l);
  const y = ls.find((l) => l.includes('data-st="you"'));
  assert.strictEqual(keyOf(y), slugId('k', 'Y'), 'the key comes from the title alone');
  const before = Object.fromEntries(ls.map((l) => [keyOf(l), sigOf(l)]));
  render(dir, '2026-10-01T10:00:00');
  assert.deepStrictEqual(Object.fromEntries(allLines(page(dir)).map((l) => [keyOf(l), sigOf(l)])), before, 'a re-render with nothing new changes nothing');
  setRows(dir, [{ state: 'you', title: 'Y', small: 'b', time: '09:00' }, { state: 'ok', title: 'R', time: '09:30' }, { state: 'ok', title: 'D', time: '08:00' }]);
  render(dir);
  ls = allLines(page(dir));
  const now = Object.fromEntries(ls.map((l) => [keyOf(l), sigOf(l)]));
  assert.notStrictEqual(now[slugId('k', 'Y')], before[slugId('k', 'Y')], 'new small text, new signature');
  assert.ok(now[slugId('k', 'R')], 'the same key in another group');
  assert.strictEqual(now[slugId('k', 'D')], before[slugId('k', 'D')]);
  assert.ok(ls.find((l) => keyOf(l) === slugId('k', 'R')).includes('data-st="ok"'));
});

function motionDom(lines) {
  const els = lines.map(([key, sig, st, folded]) => {
    const cls = new Set(); const summary = { cls: new Set(), classList: null };
    summary.classList = { add: (c) => summary.cls.add(c), remove: (c) => summary.cls.delete(c) };
    return { key, cls, summary,
      getAttribute: (k) => ({ 'data-key': key, 'data-sig': sig, 'data-st': st })[k] ?? null,
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) },
      closest: (s) => (s === 'details' && folded ? { open: false, querySelector: () => summary } : null) };
  });
  return { els, document: { querySelectorAll: (s) => (s === 'li.crew-line[data-key]' ? els : []) } };
}
const runMotion = (dom, storage, timers = []) => {
  const vm = require('vm');
  const { MOTION_JS } = require('../tools/tracker.js');
  vm.runInNewContext(MOTION_JS, { document: dom.document, location: { pathname: '/p' }, localStorage: storage, setTimeout: (f, ms) => timers.push([f, ms]), JSON });
};
const memStore = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
test('motion: the first load animates nothing; the next marks new, changed and finished lines once', () => {
  const st = memStore();
  const first = motionDom([['k-a', 's1', 'you'], ['k-b', 's2', null], ['k-c', 's3', 'wait']]);
  runMotion(first, st);
  assert.ok(first.els.every((e) => e.cls.size === 0), 'nothing to compare with yet');
  const timers = [];
  const next = motionDom([['k-a', 's1', 'you'], ['k-b', 's2', 'ok', true], ['k-c', 's9', 'wait'], ['k-d', 's4', 'you']]);
  runMotion(next, st, timers);
  assert.deepStrictEqual(next.els.map((e) => [...e.cls]), [[], ['mv-done'], ['mv-changed'], ['mv-new']]);
  assert.deepStrictEqual([...next.els[1].summary.cls], ['mv-changed'], 'a closed Done fold says something landed in it');
  for (const [f] of timers) f();
  assert.ok(next.els.every((e) => e.cls.size === 0), 'each mark is cleared after its animation');
  const again = motionDom([['k-a', 's1', 'you'], ['k-b', 's2', 'ok', true], ['k-c', 's9', 'wait'], ['k-d', 's4', 'you']]);
  runMotion(again, st);
  assert.ok(again.els.every((e) => e.cls.size === 0), 'the same page again: nothing moves');
});
test('motion: no storage, or storage that throws, animates nothing and throws nothing', () => {
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const dom = motionDom([['k-a', 's1', 'you']]);
  assert.doesNotThrow(() => runMotion(dom, throwing));
  assert.strictEqual(dom.els[0].cls.size, 0);
  assert.doesNotThrow(() => runMotion(motionDom([['k-a', 's1', 'you']]), undefined));
});
test('motion: the page carries the script once; the animations run only without reduced motion', (t) => {
  const { STRIP_CSS } = require('../tools/tracker.js');
  const css = STRIP_CSS.join('\n');
  const m = css.match(/@media \(prefers-reduced-motion: no-preference\)\{([^@]*?)\}\}/g) || [];
  const motion = m.find((x) => x.includes('mv-new'));
  assert.ok(motion, 'the line animations sit inside a no-preference block');
  assert.match(motion, /li\.crew-line\.mv-new\{animation:mv-in/);
  assert.match(motion, /li\.crew-line\.mv-changed,[^{]*\.mv-done[^{]*\{animation:mv-flash/);
  assert.doesNotMatch(css.replace(motion, ''), /animation:mv-/, 'no motion animation outside it');
  const dir = tmpdir(t); init(dir); setRows(dir, [{ state: 'you', title: 'Y', time: '09:00' }]); render(dir); render(dir);
  assert.strictEqual(page(dir).split('<script id="motion">').length, 2);
});

// The viewer's own update hook (Artifact quickstart guidance, 2026-10-05: "published changes are delivered to
// [open viewers] automatically at their next quiet moment, with state preserved where possible. If your page
// has state a viewer would miss, register window.claude?.hot?.snapshot(...) and boot through
// window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {})"). The
// page registers its open detail, folds, opened lists, scroll and line signatures there, and boots from
// what the hook hands back; browser storage stays the fallback for a full reload.
test('hot: the state script registers a snapshot and restores from what the viewer hands back, before storage', () => {
  const vm = require('vm');
  const { STATE_JS } = require('../tools/tracker.js');
  const d = stateDom({ saved: { p: null, d: [], c: [], y: 0 } });
  let snapFn = null; let start = null;
  d.ctx.window.claude = { hot: { snapshot: (f) => { snapFn = f; }, ready: (f) => { start = f; } } };
  d.ctx.window.__trkSig = { 'k-a': { s: 'x', g: 'you' } };
  vm.runInNewContext(STATE_JS, d.ctx);
  assert.strictEqual(typeof snapFn, 'function', 'a snapshot function is registered');
  assert.strictEqual(typeof start, 'function', 'it boots through hot.ready');
  start({ state: { p: 'd-you-x', d: ['f-ok'], c: ['clip-ok'], y: 220 } });
  assert.deepStrictEqual([d.btn.getAttribute('aria-expanded'), d.panel.hidden, d.fOk.open, d.more.clicks, d.scrolls[0]], ['true', false, true, 1, 220], 'restored from the hook, not from storage');
  d.ctx.window.scrollY = 220;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(snapFn())), { state: { p: 'd-you-x', d: ['f-ok'], c: ['clip-ok'], y: 220 }, sig: { 'k-a': { s: 'x', g: 'you' } } }, 'what is open now, the reopened long list included');
});
test('hot: no ready, the data the hook holds; no hook data, storage as before', () => {
  const vm = require('vm');
  const { STATE_JS } = require('../tools/tracker.js');
  const d = stateDom({ saved: { p: null, d: ['f-ok'], c: [], y: 0 } });
  d.ctx.window.claude = { hot: { data: { state: { p: 'd-you-x', d: [], c: [], y: 0 } } } };
  vm.runInNewContext(STATE_JS, d.ctx);
  assert.deepStrictEqual([d.btn.getAttribute('aria-expanded'), d.fOk.open], ['true', false]);
  const e = stateDom({ saved: { p: null, d: ['f-ok'], c: [], y: 0 } });
  e.ctx.window.claude = { hot: { ready: (f) => f({}) } };
  vm.runInNewContext(STATE_JS, e.ctx);
  assert.strictEqual(e.fOk.open, true, 'the hook had nothing: storage');
});
test('hot: motion compares with the signatures the hook kept, and leaves this load\'s for the next snapshot', () => {
  const vm = require('vm');
  const { MOTION_JS } = require('../tools/tracker.js');
  const dom = motionDom([['k-a', 's2', 'you']]);
  const st = memStore(); st.setItem('trk-sig:/p', JSON.stringify({ 'k-a': { s: 's2', g: 'you' } }));
  const window = { claude: { hot: { data: { sig: { 'k-a': { s: 's1', g: 'you' } } } } } };
  vm.runInNewContext(MOTION_JS, { document: dom.document, location: { pathname: '/p' }, localStorage: st, setTimeout: () => {}, JSON, window });
  assert.deepStrictEqual([...dom.els[0].cls], ['mv-changed'], 'against the hook\'s s1, not storage\'s s2');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(window.__trkSig)), { 'k-a': { s: 's2', g: 'you' } });
});
test('hot: the answer note field has a stable id, so the viewer can keep what was typed', (t) => {
  const dir = tmpdir(t); init(dir, ['--lang', 'tr']);
  setRows(dir, [{ state: 'you', title: 'Hangisi?', options: [{ key: 'A', label: 'x' }, { key: 'B', label: 'y' }], recommend: 'A', why: 'z', time: '09:00' }]);
  render(dir);
  const { slugId } = require('../tools/tracker.js');
  assert.match(page(dir), new RegExp(`<input type="text" id="n-${slugId('a', 'Hangisi?')}" name="note"`));
});
