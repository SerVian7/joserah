'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');

// local clock readings (no offset): the tool stamps them with the machine's own offset
const D1 = '2026-10-04T09:30:00';
const D2 = '2026-10-05T10:12:00';
const D3 = '2026-10-05T11:40:00';

const trail = (args, { now = D2, input } = {}) => runTool('trail.js', args, { env: { JOSERAH_NOW: now }, input });
const make = (t, extra = []) => {
  const dir = path.join(tmpdir(t), 'trail');
  const r = trail(['new', dir, '--title', 'Sample case', ...extra]);
  assert.strictEqual(r.status, 0, r.stderr);
  return dir;
};
const add = (dir, type, obj, now = D2) => trail(['add', dir, '--type', type, '--json', JSON.stringify(obj)], { now });
const ok = (r) => { assert.strictEqual(r.status, 0, r.stderr); return r; };
const data = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'trail.json'), 'utf8'));
const page = (dir) => fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const noScript = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '');
// the timeline only (the Open block and the header left out)
const timeline = (h) => noScript(h).slice(noScript(h).indexOf('<section class="days"'));
const openBlock = (h) => (noScript(h).match(/<section class="open"[\s\S]*?<\/section>/) || [''])[0];
const entryHtml = (h, id) => (timeline(h).match(new RegExp(`<li class="ent[^"]*" id="${id}"[\\s\\S]*?<!--/${id}-->`)) || [''])[0];
const pixel = (dir, name) => { const f = path.join(dir, name); fs.writeFileSync(f, Buffer.from([0xff, 0xd8, 0xff, 0xd9])); return f; };

// one valid entry per type (refs filled in by the caller where needed)
const VALID = {
  'mail-in': { title: 'Quote request answered', from: 'Vendor A', subject: 'Re: quote', summary: 'They can deliver in two weeks', attachments: ['quote.pdf'] },
  'mail-out': { title: 'Asked for a quote', to: 'Vendor A', subject: 'Quote', text: 'Hello, could you quote two units?' },
  offer: { title: 'Vendor A offer', from: 'Vendor A', item: 'Unit X', price: 1200, currency: 'EUR', validUntil: '2026-10-20' },
  options: { title: 'Three options', items: [{ title: 'Unit X', status: 'ok', price: '1200 EUR' }, { title: 'Unit Y', status: 'no', note: 'too big' }], rec: 0 },
  decision: { title: 'Owner chose', choice: 'Unit X' },
  draft: { title: 'Reply to vendor', to: 'Vendor A', text: 'We take two units.' },
  note: { title: 'Phone call', text: 'Short call, nothing new.' },
  waiting: { title: 'Vendor to confirm stock', on: 'Vendor A', what: 'stock' },
};
const REQUIRED = { 'mail-in': 'from', 'mail-out': 'to', offer: 'from', options: 'items', decision: 'choice', draft: 'to', waiting: 'on', note: 'title' };

test('new writes trail.json and index.html; refuses an existing Trail without --force', (t) => {
  const dir = make(t, ['--lang', 'tr', '--research', 'https://example.com/research']);
  const d = data(dir);
  assert.strictEqual(d.kind, 'trail');
  assert.strictEqual(d.version, 1);
  assert.strictEqual(d.title, 'Sample case');
  assert.strictEqual(d.lang, 'tr');
  assert.strictEqual(d.research, 'https://example.com/research');
  assert.deepStrictEqual(d.entries, []);
  assert.match(page(dir), /<html lang="tr"/);
  assert.match(page(dir), /İş akışı/);
  assert.strictEqual(trail(['new', dir, '--title', 'Again']).status, 1);
  assert.strictEqual(data(dir).title, 'Sample case');
  ok(trail(['new', dir, '--title', 'Again', '--force']));
  assert.strictEqual(data(dir).title, 'Again');
});

test('new --logo copies the logo beside the page; a bad research url refuses', (t) => {
  const base = tmpdir(t);
  const logo = path.join(base, 'l.svg');
  fs.writeFileSync(logo, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
  const dir = path.join(base, 'out');
  ok(trail(['new', dir, '--title', 'T', '--logo', logo]));
  assert.ok(fs.existsSync(path.join(dir, 'logo.svg')));
  assert.deepStrictEqual(data(dir).brand, { logo: 'logo.svg' });
  assert.match(page(dir), /<img[^>]+src="logo.svg"/);
  assert.strictEqual(trail(['new', path.join(base, 'x'), '--title', 'T', '--research', 'javascript:alert(1)']).status, 1);
});

test('add per type: a missing required field refuses; a valid entry gets eN, a stamped time and a re-render', (t) => {
  const dir = make(t);
  let n = 0;
  for (const [type, obj] of Object.entries(VALID)) {
    const bad = { ...obj };
    delete bad[REQUIRED[type]];
    const r = add(dir, type, bad);
    assert.strictEqual(r.status, 1, `${type} without ${REQUIRED[type]} must refuse`);
    assert.match(r.stderr, new RegExp(REQUIRED[type]));
    assert.strictEqual(data(dir).entries.length, n, 'a refused entry is not written');
    const q = ok(add(dir, type, obj));
    n += 1;
    assert.match(q.stdout, new RegExp(`^entry: e${n}$`, 'm'));
    const e = data(dir).entries[n - 1];
    assert.strictEqual(e.id, `e${n}`);
    assert.strictEqual(e.type, type);
    assert.match(e.time, /^2026-10-05T10:12:00[+-]\d\d:\d\d$/);
    assert.match(page(dir), new RegExp(`id="e${n}"`));
  }
});

test('add refuses an unknown type, an unknown field, a given id or time, a non-http link', (t) => {
  const dir = make(t);
  assert.strictEqual(add(dir, 'memo', { title: 'x' }).status, 1);
  assert.strictEqual(add(dir, 'note', { title: 'x', colour: 'red' }).status, 1);
  assert.strictEqual(add(dir, 'note', { title: 'x', id: 'e9' }).status, 1);
  assert.strictEqual(add(dir, 'note', { title: 'x', time: '2026-01-01T00:00:00Z' }).status, 1);
  assert.strictEqual(add(dir, 'note', { title: 'x', links: [{ label: 'bad', url: 'javascript:alert(1)' }] }).status, 1);
  assert.strictEqual(add(dir, 'note', { title: 'x', type: 'waiting' }).status, 1);
  assert.strictEqual(add(dir, 'options', { title: 'x', items: [{ title: 'a', status: 'maybe' }] }).status, 1);
  assert.strictEqual(add(dir, 'options', { title: 'x', items: [{ title: 'a', status: 'ok' }], rec: 3 }).status, 1);
  assert.deepStrictEqual(data(dir).entries, []);
});

test('add reads an entry from --file and from stdin', (t) => {
  const dir = make(t);
  const f = path.join(path.dirname(dir), 'entry.json');
  fs.writeFileSync(f, JSON.stringify(VALID.note));
  ok(trail(['add', dir, '--type', 'note', '--file', f]));
  ok(trail(['add', dir, '--type', 'waiting'], { input: JSON.stringify(VALID.waiting) }));
  assert.deepStrictEqual(data(dir).entries.map((e) => e.type), ['note', 'waiting']);
});

test('append-only: a second add leaves the earlier entries byte-identical in trail.json', (t) => {
  const dir = make(t);
  ok(add(dir, 'mail-in', VALID['mail-in']));
  ok(add(dir, 'waiting', VALID.waiting));
  const before = fs.readFileSync(path.join(dir, 'trail.json'), 'utf8');
  const cut = before.lastIndexOf('}', before.lastIndexOf(']'));
  ok(add(dir, 'note', VALID.note, D3));
  const after = fs.readFileSync(path.join(dir, 'trail.json'), 'utf8');
  assert.strictEqual(after.slice(0, cut + 1), before.slice(0, cut + 1));
  assert.strictEqual(data(dir).entries.length, 3);
});

test('images: a local path is copied to img/eN-k.ext and rewritten; files: lists it; a missing one refuses', (t) => {
  const dir = make(t);
  const src = path.dirname(dir);
  const a = pixel(src, 'a.jpg'); const b = pixel(src, 'b.png');
  const r = ok(add(dir, 'options', { title: 'Pick one', items: [{ title: 'A', status: 'ok', image: a }, { title: 'B', status: 'wait', image: b }] }));
  assert.match(r.stdout, /^files: img\/e1-1\.jpg img\/e1-2\.png$/m);
  const e = data(dir).entries[0];
  assert.strictEqual(e.items[0].image, 'img/e1-1.jpg');
  assert.strictEqual(e.items[1].image, 'img/e1-2.png');
  assert.ok(fs.existsSync(path.join(dir, 'img', 'e1-1.jpg')));
  assert.ok(fs.existsSync(path.join(dir, 'img', 'e1-2.png')));
  assert.match(page(dir), /<img[^>]+src="img\/e1-1\.jpg"/);
  // relative to the entry file's folder when given with --file
  fs.writeFileSync(path.join(src, 'offer.json'), JSON.stringify({ ...VALID.offer, image: 'a.jpg' }));
  assert.match(ok(trail(['add', dir, '--type', 'offer', '--file', path.join(src, 'offer.json')])).stdout, /^files: img\/e2-1\.jpg$/m);
  const miss = add(dir, 'offer', { ...VALID.offer, image: path.join(src, 'nope.jpg') });
  assert.strictEqual(miss.status, 1);
  assert.match(miss.stderr, /nope\.jpg/);
  assert.strictEqual(add(dir, 'offer', { ...VALID.offer, image: 'https://example.com/x.jpg' }).status, 1);
  assert.strictEqual(data(dir).entries.length, 2);
  assert.doesNotMatch(page(dir), /base64|data:image/);
});

test('ref, resolves and supersedes to an unknown id refuse', (t) => {
  const dir = make(t);
  ok(add(dir, 'mail-in', VALID['mail-in']));
  assert.strictEqual(add(dir, 'note', { title: 'x', resolves: ['e9'] }).status, 1);
  assert.strictEqual(add(dir, 'note', { title: 'x', supersedes: 'e9' }).status, 1);
  assert.strictEqual(add(dir, 'decision', { title: 'x', choice: 'A', ref: 'e9' }).status, 1);
  assert.strictEqual(add(dir, 'draft', { ...VALID.draft, ref: 'e9' }).status, 1);
  // a decision refers to an options or offer entry, and its choice must be one of the options
  assert.strictEqual(add(dir, 'decision', { title: 'x', choice: 'A', ref: 'e1' }).status, 1);
  ok(add(dir, 'options', VALID.options));
  assert.strictEqual(add(dir, 'decision', { title: 'x', choice: 'Unit Z', ref: 'e2' }).status, 1);
  assert.strictEqual(data(dir).entries.length, 2);
});

test('a resolved waiting leaves the Open block; a sent draft is marked sent; a superseded entry renders struck', (t) => {
  const dir = make(t);
  ok(add(dir, 'mail-in', VALID['mail-in']));
  ok(add(dir, 'waiting', VALID.waiting));
  ok(add(dir, 'draft', { ...VALID.draft, ref: 'e1' }));
  let open = openBlock(page(dir));
  assert.match(open, /Vendor to confirm stock/);
  assert.match(open, /Reply to vendor/);
  const r = ok(add(dir, 'mail-out', { ...VALID['mail-out'], resolves: ['e3'] }, D3));
  assert.match(r.stdout, /^small: "Mail out: Asked for a quote · next: Vendor to confirm stock"$/m);
  assert.match(r.stdout, /^state: wait$/m);
  open = openBlock(page(dir));
  assert.doesNotMatch(open, /Reply to vendor/);
  assert.match(entryHtml(page(dir), 'e3'), /class="tag sent"/);
  assert.doesNotMatch(entryHtml(page(dir), 'e3'), /class="copy"/);
  ok(add(dir, 'note', { title: 'Stock confirmed by phone', resolves: ['e2'] }, D3));
  assert.strictEqual(openBlock(page(dir)), '');
  // resolves only closes a waiting or a draft
  assert.strictEqual(add(dir, 'note', { title: 'x', resolves: ['e1'] }).status, 1);
  ok(add(dir, 'note', { title: 'Corrected summary', supersedes: 'e1' }, D3));
  assert.match(entryHtml(page(dir), 'e1'), /class="ent[^"]*\bsup\b/);
  assert.match(entryHtml(page(dir), 'e1'), /<s>Quote request answered<\/s>/);
  // the superseded entry is untouched in the data
  assert.deepStrictEqual(Object.keys(data(dir).entries[0]).sort(), ['attachments', 'from', 'id', 'subject', 'summary', 'time', 'title', 'type']);
});

test('order: Open block above, newest entry first, past days fold', (t) => {
  const dir = make(t);
  ok(add(dir, 'mail-in', { ...VALID['mail-in'], title: 'First day mail' }, D1));
  ok(add(dir, 'waiting', VALID.waiting, D1));
  ok(add(dir, 'note', { title: 'Morning note' }, D2));
  ok(add(dir, 'note', { title: 'Later note' }, D3));
  const h = noScript(page(dir));
  assert.ok(h.indexOf('<section class="open"') < h.indexOf('<section class="days"'));
  const tl = timeline(page(dir));
  assert.ok(tl.indexOf('Later note') < tl.indexOf('Morning note'));
  assert.ok(tl.indexOf('Morning note') < tl.indexOf('First day mail'));
  // today's day is open, the past day is a closed fold, one open at a time
  assert.match(tl, /<div class="day"[^>]*><div class="hd">05\.10/);
  assert.match(tl, /<details class="day" name="trail-day"[^>]*><summary class="hd">04\.10/);
  assert.doesNotMatch(tl, /<details[^>]* open/);
});

test('a long day clamps after five entries', (t) => {
  const dir = make(t);
  for (let i = 1; i <= 7; i++) ok(add(dir, 'note', { title: `Note ${i}` }));
  assert.match(page(dir), /class="clip clamp"/);
  assert.match(page(dir), /class="more"/);
});

test('a selection with a photo: decision with ref renders the chosen item large, SELECTED in the options strip', (t) => {
  const dir = make(t, ['--research', 'https://example.com/research']);
  const src = path.dirname(dir);
  const a = pixel(src, 'a.jpg'); const b = pixel(src, 'b.jpg');
  ok(add(dir, 'options', { title: 'Two units', items: [
    { title: 'Unit X', status: 'ok', price: '1200 EUR', image: a, links: [{ label: 'shop', url: 'https://example.com/x' }] },
    { title: 'Unit Y', status: 'wait', image: b }], rec: 0 }));
  let r = ok(add(dir, 'note', { title: 'Asked the owner' }));
  assert.match(r.stdout, /^state: you$/m, 'an options entry with no decision waits on the owner');
  let opts = entryHtml(page(dir), 'e1');
  assert.match(opts, /class="opt rec"/);
  assert.match(opts, /Recommendation/);
  assert.match(opts, /price missing/);
  assert.match(opts, /href="https:\/\/example.com\/research"/);
  assert.doesNotMatch(opts, /SELECTED/);
  r = ok(add(dir, 'decision', { title: 'Owner picked X', choice: 'Unit X', ref: 'e1', by: 'Owner', why: 'fits' }, D3));
  assert.doesNotMatch(r.stdout, /^state: you$/m);
  const dec = entryHtml(page(dir), 'e3');
  assert.match(dec, /<figure class="pick">[\s\S]*<img[^>]+src="img\/e1-1\.jpg"[\s\S]*Unit X[\s\S]*1200 EUR[\s\S]*SELECTED/);
  assert.match(dec, /href="https:\/\/example.com\/x"/);
  opts = entryHtml(page(dir), 'e1');
  assert.match(opts, /<li class="opt rec sel">[\s\S]*?SELECTED/);
  assert.strictEqual((opts.match(/SELECTED/g) || []).length, 1);
  // the options entry itself is not changed
  assert.strictEqual(data(dir).entries[0].selected, undefined);
});

test('a decision without ref renders its own choice and image', (t) => {
  const dir = make(t);
  const a = pixel(path.dirname(dir), 'a.jpg');
  ok(add(dir, 'decision', { title: 'Chosen', choice: 'Model Q', image: a, price: '99 EUR' }));
  assert.match(entryHtml(page(dir), 'e1'), /<figure class="pick">[\s\S]*src="img\/e1-1\.jpg"[\s\S]*Model Q[\s\S]*99 EUR/);
});

test('theme: shared token block (light, dark, data-theme); no radius but 0, no shadow', (t) => {
  const dir = make(t);
  ok(add(dir, 'options', VALID.options));
  const h = page(dir);
  assert.match(h, /:root\{color-scheme:light dark;--bg:/);
  assert.match(h, /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{--bg:/);
  assert.match(h, /:root\[data-theme="dark"\]\{--bg:/);
  for (const m of h.matchAll(/border-radius:([^;}]*)/g)) assert.strictEqual(m[1].trim(), '0');
  for (const m of h.matchAll(/box-shadow:([^;}]*)/g)) assert.strictEqual(m[1].trim(), 'none');
  // the same tokens as the Tracker's
  const tdir = path.join(path.dirname(dir), 'tracker');
  assert.strictEqual(runTool('tracker.js', ['init', tdir, '--title', 'T'], { env: { JOSERAH_NOW: D2 } }).status, 0);
  assert.strictEqual(runTool('tracker.js', [tdir], { env: { JOSERAH_NOW: D2 } }).status, 0);
  const tokens = (x) => (x.match(/:root\{color-scheme[^\n]*\n@media \(prefers-color-scheme: dark\)[^\n]*\n:root\[data-theme="dark"\][^\n]*/) || [null])[0];
  assert.ok(tokens(h));
  assert.strictEqual(tokens(h), tokens(fs.readFileSync(path.join(tdir, 'index.html'), 'utf8')));
});

test('escaping: <script> in a title renders as text; javascript: links in the data are dropped', (t) => {
  const dir = make(t);
  ok(add(dir, 'note', { title: '<script>alert(1)</script>', links: [{ label: 'ok', url: 'https://example.com/ok' }] }));
  // a hand-edited trail.json: render still drops the bad link
  const d = data(dir);
  d.entries[0].links.push({ label: 'evil', url: 'javascript:alert(2)' });
  fs.writeFileSync(path.join(dir, 'trail.json'), JSON.stringify(d));
  ok(trail(['render', dir]));
  const h = page(dir);
  assert.doesNotMatch(noScript(h), /<script>alert/);
  assert.match(h, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(h, /javascript:/);
  assert.match(h, /href="https:\/\/example.com\/ok"/);
});

test('secret scan: a token-shaped value in an entry refuses and names no value', (t) => {
  const dir = make(t);
  const tok = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0';
  const r = add(dir, 'note', { title: 'Access', text: `use ${tok}` });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /secret/i);
  assert.doesNotMatch(r.stderr, new RegExp(tok));
  assert.strictEqual(add(dir, 'mail-in', { title: 'x', from: 'y', summary: 'password: hunter2x' }).status, 1);
  assert.deepStrictEqual(data(dir).entries, []);
});

test('types prints the type table', (t) => {
  const r = ok(trail(['types']));
  for (const type of Object.keys(VALID)) assert.match(r.stdout, new RegExp(`^${type}\\b`, 'm'));
  assert.match(r.stdout, /supersedes/);
});

test('render refuses a broken trail.json; tr labels follow the data', (t) => {
  const dir = make(t, ['--lang', 'tr']);
  ok(add(dir, 'options', VALID.options));
  const h = noScript(page(dir));
  assert.match(h, /Seçenekler/);
  assert.match(h, /Öneri/);
  fs.writeFileSync(path.join(dir, 'trail.json'), '{bad');
  assert.strictEqual(trail(['render', dir]).status, 1);
  fs.writeFileSync(path.join(dir, 'trail.json'), JSON.stringify({ kind: 'trail', version: 1, title: 'x', entries: [{ id: 'e1', type: 'memo', time: D2, title: 'x' }] }));
  assert.strictEqual(trail(['render', dir]).status, 1);
});

// The skills text (spec "Skills text changes"; owner, 2026-10-05: name "Trail", tr "İş akışı"; Case research
// stays a separate page linked from the options entry). Old Decision flow pages are not migrated.
test('skills: the orchestrate skill and AGENTS.md send new work to a Trail', () => {
  const { PLUGIN_ROOT } = require('./helpers');
  const skill = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'orchestrate', 'SKILL.md'), 'utf8');
  const flat = skill.replace(/\s+/g, ' ');
  const description = /^description:(.*)$/m.exec(skill)[1];
  assert.match(description, /a Case research or a Trail/);
  assert.doesNotMatch(description, /Decision flow/);
  assert.match(skill, /^\| \*\*Trail\*\* \| /m);
  assert.match(skill, /^\| \*\*Decision flow\*\* \|.*older pages only; new work uses a Trail/m);
  assert.match(flat, /decided on two linked pages: its Case research and its Trail/);
  assert.match(flat, /tools\/trail\.js"` \(`new <dir>/);
  assert.match(flat, /An option moves from the research to the Trail only on the owner's word/);
  assert.match(flat, /links to the page where it is made \(Case research, Trail, a report\)/);
  assert.match(skill, /^\| \*\*Scout\*\* \| .*Case research, Trail,/m);
  const agents = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf8');
  const row = agents.split('\n').find((l) => l.startsWith('|') && l.includes('`orchestrate`'));
  assert.doesNotMatch(row, /Decision flow/);
  assert.match(row, /Case research and Trail/);
  assert.match(row, /\(Case, Case research, Trail, Tracker, Manager\)/);
  assert.match(fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'crew', 'scout.md'), 'utf8'), /Case research, Trail,/);
});
