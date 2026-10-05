#!/usr/bin/env node
/**
 * trail.js — keeps a Trail: one page per Case showing the work's whole course as a timeline of typed
 * entries (mail in, mail out, offer, options, decision, draft, note, waiting). Entries are appended and
 * never rewritten; the page is rebuilt from trail.json and templates/trail on every change, so no HTML
 * is written per page. Spec: docs/specs/2026-10-05-trail-design.md.
 *
 *   node tools/trail.js new <dir> --title "<Case>" [--lang en|tr] [--logo f] [--research <url>] [--force]
 *       Writes <dir>/trail.json (no entries) and <dir>/index.html. Refuses, exit 1, if trail.json exists
 *       unless --force. --logo copies the file beside the page as logo.png|svg.
 *
 *   node tools/trail.js add <dir> --type <type> (--file entry.json | --json '<obj>' | stdin)
 *       Validates ONE entry against the type table (`types`), assigns its id (eN) and time (now, ISO with
 *       the local offset), copies every local image path into <dir>/img/eN-k.ext and rewrites it to that
 *       relative name, appends, renders. An image path is read relative to the entry file's folder with
 *       --file, else to the working directory. Prints
 *         entry: eN
 *         files: img/eN-1.jpg …   (what must be published with the page; "none" when nothing)
 *         small: "<type label>: <title> · next: <oldest open waiting>"   (a Daily Tracker line)
 *         state: you|wait          (only when an options entry awaits a decision, or a waiting is open)
 *       Refuses, exit 1, writing nothing: an unknown type or field, a missing required field, a given id
 *       or time, an unknown ref/resolves/supersedes id, a non-http link, a missing image, a value shaped
 *       like a credential (the SPECIFIC patterns of hooks/lib/redactions.js).
 *
 *   node tools/trail.js render <dir>
 *       Rebuilds <dir>/index.html from trail.json. Prints `entries: N open: M`.
 *
 *   node tools/trail.js types
 *       Prints the type table.
 *
 * The page: an Open block (every unresolved waiting and unsent draft) above the timeline; the timeline
 * newest first under day headings (DD.MM), the newest day open, past days closed folds, one open at a
 * time; a day of more than five entries clamps (the Tracker's clamp). A superseded entry is struck
 * through; a decision with ref to an options entry shows the chosen item large and marks it SELECTED in
 * the options strip (computed here; the options entry is never changed). Only http(s) links are kept.
 * Tests may fix the clock with JOSERAH_NOW=<ISO timestamp>. No dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { SPECIFIC } = require('../hooks/lib/redactions');
const theme = require('./lib/theme');

const LABELS = {
  en: {
    kind: 'Trail', open: 'Open', none: 'No entries yet', next: 'next', upd: 'updated', more: 'all', less: 'show less',
    types: { 'mail-in': 'Mail in', 'mail-out': 'Mail out', offer: 'Offer', options: 'Options', decision: 'Decision', draft: 'Draft', note: 'Note', waiting: 'Waiting' },
    status: { ok: 'Fits', wait: 'Open', no: 'Does not fit' },
    rec: 'Recommendation', selected: 'SELECTED', priceMissing: 'price missing', sent: 'Sent', resolved: 'resolved', openTag: 'open',
    copy: 'Copy', copied: 'Copied', text: 'Text', to: 'to', on: 'waiting on', by: 'by', validUntil: 'valid until',
    attachments: 'attachments', research: 'Case research', link: 'link', replaces: 'replaces', replacedBy: 'replaced by', closes: 'closes', answers: 'answers',
  },
  tr: {
    kind: 'İş akışı', open: 'Açık', none: 'Henüz kayıt yok', next: 'sonraki', upd: 'güncelleme', more: 'tümü', less: 'daralt',
    types: { 'mail-in': 'Gelen mail', 'mail-out': 'Giden mail', offer: 'Teklif', options: 'Seçenekler', decision: 'Karar', draft: 'Taslak', note: 'Not', waiting: 'Beklemede' },
    status: { ok: 'Uygun', wait: 'Açık', no: 'Uymuyor' },
    rec: 'Öneri', selected: 'SEÇİLDİ', priceMissing: 'fiyat yok', sent: 'Gönderildi', resolved: 'kapandı', openTag: 'açık',
    copy: 'Kopyala', copied: 'Kopyalandı', text: 'Metin', to: 'kime', on: 'beklenen', by: 'karar veren', validUntil: 'geçerlilik',
    attachments: 'ekler', research: 'Araştırma', link: 'bağlantı', replaces: 'yerine geçtiği', replacedBy: 'yerine geçen', closes: 'kapattığı', answers: 'yanıtladığı',
  },
};

// The type table: required and optional fields beyond the common ones (title, links, resolves, supersedes).
const TYPES = {
  'mail-in': { req: ['from'], opt: ['subject', 'summary', 'attachments'], shows: 'sender · subject, summary line, thread link' },
  'mail-out': { req: ['to'], opt: ['subject', 'summary', 'text'], shows: 'recipients · subject; sent text in a closed expandable' },
  offer: { req: ['from'], opt: ['item', 'price', 'currency', 'validUntil', 'image', 'note'], shows: 'vendor, item, price (or "price missing"), thumbnail' },
  options: { req: ['items'], opt: ['rec', 'research'], shows: 'items side by side: thumbnail, title, price, status; rec marked "Recommendation"' },
  decision: { req: ['choice'], opt: ['ref', 'why', 'by', 'image', 'price'], shows: 'the chosen item large (image, title, price, link), "SELECTED"' },
  draft: { req: ['to', 'text'], opt: ['subject', 'ref'], shows: 'text in a box with a Copy button; "sent" once a later entry resolves it' },
  note: { req: [], opt: ['text'], shows: 'one line, long text in an expandable' },
  waiting: { req: ['on'], opt: ['what'], shows: 'an open item until a later entry lists it in resolves' },
};
const COMMON = ['title', 'links', 'resolves', 'supersedes'];
const ITEM_KEYS = ['title', 'status', 'price', 'image', 'note', 'links'];
const STATUS = ['ok', 'wait', 'no'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];
const CLAMP = 5;

class Refused extends Error {}
const die = (msg) => { throw new Refused(msg); };
const now = () => (process.env.JOSERAH_NOW ? new Date(process.env.JOSERAH_NOW) : new Date());
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isUrl = (u) => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const isStr = (s) => typeof s === 'string' && s.trim() !== '';
const key = (t) => String(t ?? '').trim().toLowerCase();

// ISO with the local offset: 2026-10-05T10:12:00+03:00
function isoLocal(d) {
  const off = -d.getTimezoneOffset();
  const s = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') opt.force = true;
    else if (/^--(title|lang|logo|research|type|file|json)$/.test(a)) {
      if (i + 1 >= argv.length) die(`${a} needs a value`);
      opt[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) die(`unknown option ${a}`);
    else pos.push(a);
  }
  return { pos, opt };
}

// --- the data file ----------------------------------------------------------------------------------
// One entry per line, in append order, so an append never moves or reformats an earlier entry.
function serialize(d) {
  const { entries, ...head } = d;
  const lines = Object.entries(head).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  return `{\n${lines.join('\n')}\n"entries": [\n${entries.map((e) => JSON.stringify(e)).join(',\n')}${entries.length ? '\n' : ''}]\n}\n`;
}

function readTrail(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) die(`${dir} is not a directory`);
  const file = path.join(dir, 'trail.json');
  if (!fs.existsSync(file)) die(`${file} not found (run new first)`);
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { die(`trail.json is not valid JSON: ${e.message}`); }
  if (!isObj(d) || d.kind !== 'trail' || !Array.isArray(d.entries)) die('trail.json must be { "kind": "trail", ..., "entries": [...] }');
  if (d.lang !== undefined && !LABELS[d.lang]) die(`unknown language ${d.lang} (en or tr)`);
  if (d.brand && d.brand.logo && /^[a-z]+:|^\/|\.\./i.test(d.brand.logo)) die('brand.logo must be a relative file name');
  const seen = new Set();
  d.entries.forEach((e, i) => {
    if (!isObj(e) || !/^e\d+$/.test(String(e.id))) die(`entry ${i + 1}: needs an id eN`);
    if (seen.has(e.id)) die(`entry ${i + 1}: duplicate id ${e.id}`);
    seen.add(e.id);
    if (!TYPES[e.type]) die(`entry ${e.id}: unknown type "${e.type}"`);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(String(e.time))) die(`entry ${e.id}: time must be ISO`);
  });
  return d;
}

// --- validation ---------------------------------------------------------------------------------------
function checkLinks(links, where) {
  if (links === undefined) return;
  if (!Array.isArray(links)) die(`${where}: links must be a list of {label, url}`);
  links.forEach((l, i) => {
    if (!isObj(l) || Object.keys(l).some((k) => k !== 'label' && k !== 'url')) die(`${where}: link ${i + 1} must be {label, url}`);
    if (!isUrl(l.url)) die(`${where}: link ${i + 1} is not an http(s) url`);
    if (l.label !== undefined && typeof l.label !== 'string') die(`${where}: link ${i + 1} label must be text`);
  });
}

const STRINGS = ['from', 'subject', 'summary', 'text', 'item', 'currency', 'validUntil', 'note', 'why', 'by', 'on', 'what', 'image'];
function checkEntry(e, type, entries) {
  const T = TYPES[type];
  if (!T) die(`unknown type "${type}" (${Object.keys(TYPES).join('|')})`);
  if (!isObj(e)) die('an entry is one JSON object');
  if (e.type !== undefined && e.type !== type) die(`the entry says type "${e.type}" but --type is "${type}"`);
  if (e.id !== undefined || e.time !== undefined) die('id and time are assigned by the tool; leave them out');
  const allowed = new Set(['type', ...COMMON, ...T.req, ...T.opt]);
  for (const k of Object.keys(e)) if (!allowed.has(k)) die(`${type}: unknown field "${k}" (see: trail.js types)`);
  if (!isStr(e.title)) die(`${type}: title is required`);
  if (/[\r\n]/.test(e.title)) die(`${type}: title is one line`);
  for (const f of T.req) if (e[f] === undefined || e[f] === null || e[f] === '' || (Array.isArray(e[f]) && !e[f].length)) die(`${type}: ${f} is required`);
  for (const f of STRINGS) if (e[f] !== undefined && typeof e[f] !== 'string') die(`${type}: ${f} must be text`);
  if (e.to !== undefined && !(isStr(e.to) || (Array.isArray(e.to) && e.to.length && e.to.every(isStr)))) die(`${type}: to is a name or a list of names`);
  if (e.price !== undefined && !(typeof e.price === 'string' || Number.isFinite(e.price))) die(`${type}: price must be text or a number`);
  if (e.attachments !== undefined && !(Array.isArray(e.attachments) && e.attachments.every(isStr))) die(`${type}: attachments is a list of file names`);
  if (e.research !== undefined && !isUrl(e.research)) die(`${type}: research must be an http(s) url`);
  checkLinks(e.links, type);
  const byId = new Map(entries.map((x) => [x.id, x]));
  const known = (id, what) => { if (typeof id !== 'string' || !byId.has(id)) die(`${type}: ${what} "${id}" is not an entry of this Trail`); return byId.get(id); };
  if (e.resolves !== undefined) {
    if (!Array.isArray(e.resolves) || !e.resolves.length) die(`${type}: resolves is a list of entry ids`);
    for (const id of e.resolves) {
      const t = known(id, 'resolves');
      if (t.type !== 'waiting' && t.type !== 'draft') die(`${type}: resolves closes only a waiting or a draft (${id} is a ${t.type})`);
    }
  }
  if (e.supersedes !== undefined) known(e.supersedes, 'supersedes');
  if (type === 'options') {
    if (!Array.isArray(e.items)) die('options: items is a list');
    e.items.forEach((it, i) => {
      if (!isObj(it)) die(`options: item ${i + 1} is an object`);
      for (const k of Object.keys(it)) if (!ITEM_KEYS.includes(k)) die(`options: item ${i + 1} has an unknown field "${k}"`);
      if (!isStr(it.title)) die(`options: item ${i + 1} needs a title`);
      if (!STATUS.includes(it.status)) die(`options: item ${i + 1} status must be ok, wait or no`);
      if (it.price !== undefined && !(typeof it.price === 'string' || Number.isFinite(it.price))) die(`options: item ${i + 1} price must be text or a number`);
      for (const f of ['image', 'note']) if (it[f] !== undefined && typeof it[f] !== 'string') die(`options: item ${i + 1} ${f} must be text`);
      checkLinks(it.links, `options: item ${i + 1}`);
    });
    if (e.rec !== undefined && !(Number.isInteger(e.rec) && e.rec >= 0 && e.rec < e.items.length)) die('options: rec is the index of one of the items');
  }
  if (type === 'decision') {
    if (!(isStr(e.choice) || Number.isInteger(e.choice))) die('decision: choice is text, or an item index with ref to an options entry');
    if (e.ref !== undefined) {
      const t = known(e.ref, 'ref');
      if (t.type !== 'options' && t.type !== 'offer') die(`decision: ref points at an options or offer entry (${e.ref} is a ${t.type})`);
      if (t.type === 'options' && pickedIndex(t, e.choice) < 0) die(`decision: choice "${e.choice}" is not one of ${e.ref}'s items`);
    } else if (!isStr(e.choice)) die('decision: an item index needs ref to an options entry');
  }
  if (type === 'draft' && e.ref !== undefined) {
    const t = known(e.ref, 'ref');
    if (t.type !== 'mail-in') die(`draft: ref points at the mail-in it answers (${e.ref} is a ${t.type})`);
  }
  checkSecrets(e, type);
}

// No secret ever goes into an entry: every text value is checked against the credential patterns the
// redaction hook and secret-scan.js use. The message names the field, never the value.
function checkSecrets(v, where) {
  if (typeof v === 'string') {
    for (const [re] of SPECIFIC) {
      if (new RegExp(re.source, re.flags.replace('g', '')).test(v)) die(`${where} looks like it holds a secret (a credential pattern matched); put it in the vault and refer to it by name`);
    }
  } else if (Array.isArray(v)) v.forEach((x, i) => checkSecrets(x, `${where}[${i}]`));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) checkSecrets(x, `${where}.${k}`);
}

function pickedIndex(options, choice) {
  if (Number.isInteger(choice)) return choice >= 0 && choice < options.items.length ? choice : -1;
  return options.items.findIndex((it) => key(it.title) === key(choice));
}

// Every local image in the entry is copied to img/eN-k.ext and rewritten to that relative name.
function copyImages(e, dir, base) {
  const slots = [];
  if (e.image !== undefined) slots.push([e, 'image']);
  if (Array.isArray(e.items)) e.items.forEach((it) => { if (it.image !== undefined) slots.push([it, 'image']); });
  const plan = slots.map(([o, k], i) => {
    const v = o[k];
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^data:/i.test(v)) die(`image "${v}": give a local file; images are copied beside the page, never linked or embedded`);
    const ext = path.extname(v).toLowerCase();
    if (!IMAGE_EXT.includes(ext)) die(`image "${v}": not an image file (${IMAGE_EXT.join(' ')})`);
    const src = path.resolve(base, v);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) die(`image "${v}" not found`);
    return { o, k, src, rel: `img/${e.id}-${i + 1}${ext}` };
  });
  if (plan.length) fs.mkdirSync(path.join(dir, 'img'), { recursive: true });
  for (const p of plan) { fs.copyFileSync(p.src, path.join(dir, p.rel)); p.o[p.k] = p.rel; }
  return plan.map((p) => p.rel);
}

// --- what is open ------------------------------------------------------------------------------------
function analyse(entries) {
  const supersededBy = new Map();
  const resolvedBy = new Map();
  for (const e of entries) {
    if (e.supersedes) supersededBy.set(e.supersedes, e.id);
    for (const id of e.resolves || []) if (!resolvedBy.has(id)) resolvedBy.set(id, e.id);
  }
  const live = (e) => !supersededBy.has(e.id);
  // the latest live decision on an options entry selects one of its items
  const selected = new Map();
  const decided = new Set();
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const e of entries) {
    if (e.type !== 'decision' || !live(e) || !e.ref) continue;
    decided.add(e.ref);
    const t = byId.get(e.ref);
    if (t && t.type === 'options' && Array.isArray(t.items)) selected.set(t.id, pickedIndex(t, e.choice));
  }
  const open = entries.filter((e) => live(e) && (e.type === 'waiting' || e.type === 'draft') && !resolvedBy.has(e.id));
  const undecided = entries.filter((e) => live(e) && e.type === 'options' && !decided.has(e.id));
  return { supersededBy, resolvedBy, selected, open, undecided, byId };
}

// --- rendering ----------------------------------------------------------------------------------------
const day = (e) => String(e.time).slice(0, 10);
const dm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const hhmm = (e) => String(e.time).slice(11, 16);
const linkA = (l, L) => (isObj(l) && isUrl(l.url) ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || L.link)}</a>` : '');
const linksP = (links, L) => { const a = (Array.isArray(links) ? links : []).map((l) => linkA(l, L)).filter(Boolean); return a.length ? `<p class="ln">${a.join(' · ')}</p>` : ''; };
const relImg = (v) => typeof v === 'string' && v && !/^[a-z][a-z0-9+.-]*:|^\/|\.\./i.test(v);
const img = (v, alt, cls = '') => (relImg(v) ? `<img${cls ? ` class="${cls}"` : ''} src="${esc(v)}" alt="${esc(alt)}" loading="lazy">` : '');
const priceOf = (p, cur, L) => (p === undefined || p === null || p === '' ? `<span class="miss">${esc(L.priceMissing)}</span>` : `<span class="pr">${esc(cur ? `${p} ${cur}` : p)}</span>`);
const names = (v) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''));
const join = (...xs) => xs.filter((x) => x !== undefined && x !== null && String(x).trim() !== '').map(esc).join(' · ');
const LONG = 160;

function body(e, A, D, L) {
  const p = (cls, html) => (html ? `<p${cls ? ` class="${cls}"` : ''}>${html}</p>` : '');
  switch (e.type) {
    case 'mail-in':
      return p('meta', join(e.from, e.subject)) + p('', esc(e.summary || ''))
        + (Array.isArray(e.attachments) && e.attachments.length ? p('att', `${esc(L.attachments)}: ${esc(e.attachments.join(', '))}`) : '') + linksP(e.links, L);
    case 'mail-out':
      return p('meta', `${esc(L.to)}: ${join(names(e.to), e.subject)}`) + p('', esc(e.summary || ''))
        + (e.text ? `<details class="tx"><summary>${esc(L.text)}</summary><pre>${esc(e.text)}</pre></details>` : '') + linksP(e.links, L);
    case 'offer':
      return img(e.image, e.item || e.title, 'th') + p('meta', join(e.from, e.item)) + p('', priceOf(e.price, e.currency, L))
        + (e.validUntil ? p('', `${esc(L.validUntil)}: ${esc(e.validUntil)}`) : '') + p('', esc(e.note || '')) + linksP(e.links, L);
    case 'options': {
      const sel = A.selected.get(e.id);
      const items = (Array.isArray(e.items) ? e.items : []).map((it, i) => {
        const cls = ['opt', i === e.rec ? 'rec' : '', i === sel ? 'sel' : '', it.status === 'no' ? 'no' : ''].filter(Boolean).join(' ');
        const tags = `<span class="tag st-${esc(STATUS.includes(it.status) ? it.status : 'wait')}">${esc(L.status[it.status] || it.status)}</span>`
          + (i === e.rec ? `<span class="tag rec">${esc(L.rec)}</span>` : '')
          + (i === sel ? `<span class="tag sel">${esc(L.selected)}</span>` : '');
        return `<li class="${cls}"><div class="im">${img(it.image, it.title)}</div><b>${esc(it.title)}</b>${priceOf(it.price, '', L)}<div>${tags}</div>`
          + (it.note ? `<p>${esc(it.note)}</p>` : '') + linksP(it.links, L) + '</li>';
      }).join('');
      const research = isUrl(e.research) ? e.research : (isUrl(D.research) ? D.research : '');
      return `<ul class="opts">${items}</ul>` + (research ? p('ln', linkA({ label: L.research, url: research }, L)) : '') + linksP(e.links, L);
    }
    case 'decision': {
      const t = e.ref ? A.byId.get(e.ref) : null;
      let pick;
      if (t && t.type === 'options') {
        const it = (t.items || [])[pickedIndex(t, e.choice)] || { title: String(e.choice) };
        pick = { image: it.image, title: it.title, price: it.price, links: it.links };
      } else if (t && t.type === 'offer') {
        pick = { image: t.image, title: t.item || String(e.choice), price: t.price, currency: t.currency, links: t.links };
      } else pick = { image: e.image, title: String(e.choice), price: e.price, links: e.links };
      const meta = join(e.by ? `${L.by}: ${e.by}` : '', e.why);
      return p('meta', meta)
        + `<figure class="pick">${img(pick.image, pick.title)}<figcaption><b>${esc(pick.title)}</b>`
        + (pick.price !== undefined && pick.price !== '' ? priceOf(pick.price, pick.currency, L) : '')
        + (Array.isArray(pick.links) ? pick.links.map((l) => linkA(l, L)).filter(Boolean).join(' ') : '')
        + `<span class="tag sel">${esc(L.selected)}</span></figcaption></figure>`
        + (pick.links === e.links ? '' : linksP(e.links, L));
    }
    case 'draft': {
      const sent = A.resolvedBy.get(e.id);
      const tid = `tx-${e.id}`;
      return p('meta', `${esc(L.to)}: ${join(names(e.to), e.subject)}${sent ? `<span class="tag sent">${esc(L.sent)}</span>` : ''}`)
        + (e.ref ? p('sb', `${esc(L.answers)} <a href="#${esc(e.ref)}">${esc(e.ref)}</a>`) : '')
        + `<div class="dbox"><pre id="${tid}">${esc(e.text)}</pre></div>`
        + (sent ? '' : `<button type="button" class="copy" data-for="${tid}" data-label="${esc(L.copy)}" data-done="${esc(L.copied)}">${esc(L.copy)}</button>`)
        + linksP(e.links, L);
    }
    case 'note': {
      const t = String(e.text || '');
      return (t.length > LONG ? `<details class="tx"><summary>${esc(L.text)}</summary><pre>${esc(t)}</pre></details>` : p('', esc(t))) + linksP(e.links, L);
    }
    case 'waiting': {
      const by = A.resolvedBy.get(e.id);
      const tag = by ? `<span class="tag done">${esc(L.resolved)} · ${esc(by)}</span>` : `<span class="tag open">${esc(L.openTag)}</span>`;
      return p('meta', `${esc(L.on)}: ${join(e.on, e.what)}${tag}`) + linksP(e.links, L);
    }
    default: return '';
  }
}

function entryLi(e, A, D, L) {
  const by = A.supersededBy.get(e.id);
  const title = by ? `<s>${esc(e.title)}</s>` : esc(e.title);
  const refs = (e.supersedes ? `<p class="sb">${esc(L.replaces)} <a href="#${esc(e.supersedes)}">${esc(e.supersedes)}</a></p>` : '')
    + (Array.isArray(e.resolves) && e.resolves.length ? `<p class="sb">${esc(L.closes)} ${e.resolves.map((id) => `<a href="#${esc(id)}">${esc(id)}</a>`).join(', ')}</p>` : '')
    + (by ? `<p class="sb">${esc(L.replacedBy)} <a href="#${esc(by)}">${esc(by)}</a></p>` : '');
  return `<li class="ent t-${e.type}${by ? ' sup' : ''}" id="${esc(e.id)}"><div class="eh"><span class="ty">${esc(L.types[e.type])}</span>`
    + `<span class="et">${title}</span><time datetime="${esc(e.time)}">${esc(hhmm(e))}</time></div>`
    + `<div class="eb">${body(e, A, D, L)}${refs}</div><!--/${esc(e.id)}--></li>\n`;
}

function mainHtml(D, L) {
  const entries = D.entries;
  const A = analyse(entries);
  let open = '';
  if (A.open.length) {
    const lis = A.open.map((e) => {
      const m = e.type === 'waiting' ? `${L.on}: ${[e.on, e.what].filter(Boolean).join(' · ')}` : `${L.to}: ${names(e.to)}`;
      return `<li class="oi t-${e.type}"><span class="ty">${esc(L.types[e.type])}</span><a href="#${esc(e.id)}">${esc(e.title)}</a>`
        + `<time datetime="${esc(e.time)}">${esc(dm(day(e)))} ${esc(hhmm(e))}</time><span class="m">${esc(m)}</span></li>\n`;
    }).join('');
    open = `<section class="open"><div class="hd">${esc(L.open)} <span>${A.open.length}</span></div><ol>\n${lis}</ol></section>\n`;
  }
  // newest first, grouped by day; the newest day open, past days closed folds (one open at a time)
  const days = [];
  for (const e of [...entries].reverse()) {
    const d = day(e);
    if (!days.length || days[days.length - 1].d !== d) days.push({ d, es: [] });
    days[days.length - 1].es.push(e);
  }
  const list = (g) => {
    const long = g.es.length > CLAMP;
    const more = `${L.more} (${g.es.length})`;
    return `<div class="clip${long ? ' clamp' : ''}" id="clip-${g.d}"><ol>\n${g.es.map((e) => entryLi(e, A, D, L)).join('')}</ol></div>`
      + (long ? `<div class="fade" aria-hidden="true"></div><button type="button" class="more" aria-expanded="false" aria-controls="clip-${g.d}" data-label="${esc(more)}" data-less="${esc(L.less)}">${esc(more)}</button>` : '');
  };
  const dayHtml = days.map((g, i) => (i === 0
    ? `<div class="day" id="day-${g.d}"><div class="hd">${dm(g.d)} <span>${g.es.length}</span></div>${list(g)}</div>\n`
    : `<details class="day" name="trail-day" id="day-${g.d}"><summary class="hd">${dm(g.d)} <span>${g.es.length}</span></summary>${list(g)}</details>\n`)).join('');
  const days$ = `<section class="days">\n${dayHtml || `<p class="none">${esc(L.none)}</p>\n`}</section>\n`;
  return { html: open + days$, open: A.open.length, A };
}

function render(dir, { quiet = false } = {}) {
  const D = readTrail(dir);
  const L = LABELS[D.lang || 'en'];
  const { html: main, open } = mainHtml(D, L);
  const line = `${D.title || L.kind} · ${L.kind}`;
  const logo = D.brand && relImg(D.brand.logo) ? `<img alt="" src="${esc(D.brand.logo)}">` : '';
  const page = fs.readFileSync(path.join(__dirname, '..', 'templates', 'trail', 'index.html'), 'utf8')
    .replace('<html lang="en">', () => `<html lang="${D.lang || 'en'}">`)
    .replace('<!--trail:title-->', () => esc(line))
    .replace('<!--trail:theme-->', () => theme.css())
    .replace('<!--trail:logo-->', () => logo)
    .replace('<!--trail:line-->', () => esc(line))
    .replace('<!--trail:t-->', () => now().toISOString())
    .replace('<!--trail:main-->', () => main)
    .replace('<!--trail:clip-->', () => theme.CLIP_JS);
  fs.writeFileSync(path.join(dir, 'index.html'), page);
  if (!quiet) console.log(`entries: ${D.entries.length} open: ${open}`);
}

function create(dir, opt) {
  if (!dir) die('usage: trail.js new <dir> --title "<Case>" [--lang en|tr] [--logo f] [--research <url>] [--force]');
  if (!isStr(opt.title)) die('--title is required');
  const lang = opt.lang || 'en';
  if (!LABELS[lang]) die(`unknown language ${lang} (en or tr)`);
  if (opt.research !== undefined && !isUrl(opt.research)) die('--research must be an http(s) url');
  const file = path.join(dir, 'trail.json');
  if (fs.existsSync(file) && !opt.force) die(`${file} already exists (use --force to start it again)`);
  const D = { kind: 'trail', version: 1, title: opt.title, lang };
  if (opt.research) D.research = opt.research;
  fs.mkdirSync(dir, { recursive: true });
  if (opt.logo) {
    const ext = path.extname(opt.logo).toLowerCase();
    if (!['.png', '.svg'].includes(ext)) die('--logo must be a .png or .svg file');
    let buf;
    try { buf = fs.readFileSync(opt.logo); } catch (e) { die(`cannot read logo ${opt.logo}`); }
    fs.writeFileSync(path.join(dir, `logo${ext}`), buf);
    D.brand = { logo: `logo${ext}` };
  }
  D.entries = [];
  fs.writeFileSync(file, serialize(D));
  render(dir, { quiet: true });
  console.log(`trail: wrote ${path.join(dir, 'index.html')}`);
}

function readInput(opt) {
  let text; let base = process.cwd();
  if (opt.file !== undefined && opt.json !== undefined) die('give --file or --json, not both');
  if (opt.file !== undefined) {
    try { text = fs.readFileSync(opt.file, 'utf8'); } catch (e) { die(`cannot read ${opt.file}`); }
    base = path.dirname(path.resolve(opt.file));
  } else if (opt.json !== undefined) text = opt.json;
  else {
    try { text = fs.readFileSync(0, 'utf8'); } catch (e) { text = ''; }
    if (!text.trim()) die('no entry given (--file, --json or stdin)');
  }
  try { return { entry: JSON.parse(text), base }; } catch (e) { die(`the entry is not valid JSON: ${e.message}`); }
}

function append(dir, opt) {
  if (!dir || !opt.type) die('usage: trail.js add <dir> --type <type> (--file entry.json | --json \'<obj>\' | stdin)');
  const D = readTrail(dir);
  const L = LABELS[D.lang || 'en'];
  const { entry, base } = readInput(opt);
  checkEntry(entry, opt.type, D.entries);
  const n = D.entries.reduce((m, e) => Math.max(m, Number(String(e.id).slice(1)) || 0), 0) + 1;
  const { type: _t, ...fields } = entry;
  const e = { id: `e${n}`, type: opt.type, time: isoLocal(now()), ...fields };
  const files = copyImages(e, dir, base);
  D.entries.push(e);
  fs.writeFileSync(path.join(dir, 'trail.json'), serialize(D));
  render(dir, { quiet: true });
  const A = analyse(D.entries);
  const waiting = A.open.filter((x) => x.type === 'waiting');
  const next = waiting.length && waiting[0] !== e ? ` · ${L.next}: ${waiting[0].title}` : '';
  console.log(`entry: ${e.id}`);
  console.log(`files: ${files.length ? files.join(' ') : 'none'}`);
  console.log(`small: "${L.types[e.type]}: ${e.title}${next}"`);
  if (A.undecided.length) console.log('state: you');
  else if (waiting.length) console.log('state: wait');
}

function types() {
  const rows = Object.entries(TYPES).map(([t, T]) => [t, T.req.join(' ') || '-', T.opt.join(' ') || '-', T.shows]);
  const w = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length), ['type', 'required', 'optional'][i].length));
  const fmt = (r) => r.map((c, i) => (i < 3 ? c.padEnd(w[i]) : c)).join('  ');
  console.log(fmt(['type', 'required', 'optional', 'renders as']));
  for (const r of rows) console.log(fmt(r));
  console.log('');
  console.log('every entry: title (required, one line); links [{label, url}] (http(s) only); resolves [ids] (closes a waiting or a draft); supersedes id (the old entry renders struck)');
  console.log('options items: {title, status ok|wait|no, price?, image?, note?, links?}; rec is an item index; research a Case research url');
  console.log('decision: ref names an options or offer entry; with options, choice is an item title or index');
  console.log('draft: ref names the mail-in it answers; images are local files, copied to img/');
  console.log('id and time are assigned by the tool');
}

function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  if (pos[0] === 'new') create(pos[1], opt);
  else if (pos[0] === 'add') append(pos[1], opt);
  else if (pos[0] === 'render') render(pos[1]);
  else if (pos[0] === 'types') types();
  else die('usage: trail.js new <dir> --title "<Case>" [...]  |  add <dir> --type <type> (--file f | --json obj | stdin)  |  render <dir>  |  types');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    console.error(`trail: ${e.message}`);
    process.exit(1);
  }
}
module.exports = { TYPES, LABELS, analyse, serialize, Refused };
