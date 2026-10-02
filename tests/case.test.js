'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');

const SAMPLE = {
  title: 'Sample case', lang: 'en', eyebrow: 'Sample',
  brand: { logo: 'logo.svg', accent: '#12ab34' },
  update: { date: '02.10.2026', items: [{ state: 'no', text: 'Newest line', date: '02.10' }, { state: 'ok', text: 'Older line', date: '01.10' }], links: [{ label: 'Decisions', url: 'https://example.com/d' }, { label: 'bad', url: 'javascript:alert(1)' }] },
  groups: [
    { name: 'Newest group', note: 'NOTE-NEW', cases: [
      { title: 'Alpha', status: 'ok', why: 'Fits the need', image: 'a.jpg', specs: [['CPU', 'X']], links: [{ label: 'Shop', url: 'https://example.com/a' }] },
      { title: 'Beta', status: 'no', why: 'Wrong slot' }] },
    { name: 'Older group', note: 'NOTE-OLD', cases: [{ title: 'Gamma', status: 'wait', why: 'Unknown', specs: [['K', 'V']] }] },
  ],
};
const make = (t, data = SAMPLE, extra = []) => {
  const dir = tmpdir(t);
  const r = runTool('case.js', ['init', dir, '--title', 'Sample case', ...extra]);
  assert.strictEqual(r.status, 0, r.stderr);
  fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(data));
  const q = runTool('case.js', ['render', dir]);
  assert.strictEqual(q.status, 0, q.stderr);
  return { dir, out: q.stdout, html: fs.readFileSync(path.join(dir, 'index.html'), 'utf8') };
};
const noScript = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '');

test('init writes cases.json and a page; refuses to overwrite without --force', (t) => {
  const dir = tmpdir(t);
  assert.strictEqual(runTool('case.js', ['init', dir, '--title', 'T', '--lang', 'tr']).status, 0);
  assert.match(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /<html lang="tr"/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'cases.json'), 'utf8')).groups.length);
  assert.strictEqual(runTool('case.js', ['init', dir, '--title', 'T']).status, 1);
  assert.strictEqual(runTool('case.js', ['init', dir, '--title', 'T', '--force']).status, 0);
});

test('first group open, others closed; a closed group has no note, chips or card', (t) => {
  const { html, out } = make(t);
  assert.match(out, /groups: 2 cases: 3/);
  const page = noScript(html);
  assert.match(page, /aria-expanded="true"[^>]*><span class="car">[^<]*<\/span>Newest group/);
  assert.match(page, /aria-expanded="false"[^>]*><span class="car">[^<]*<\/span>Older group/);
  assert.strictEqual((page.match(/<article class="case"/g) || []).length, 1);
  assert.match(page, /NOTE-NEW/);
  assert.doesNotMatch(page, /NOTE-OLD|Gamma|Unknown/);
  assert.match(page, /Alpha/);
  assert.doesNotMatch(page, /<h2>Beta/);
});

test('card shows the status reason, specs in a closed details, source links', (t) => {
  const page = noScript(make(t).html);
  assert.match(page, /<p class="why okt"><i class="dot ok"[^>]*><\/i>Fits the need/);
  assert.match(page, /<details class="more"><summary>Details<\/summary>/);
  assert.doesNotMatch(page, /<details[^>]* open/);
  assert.match(page, /<a href="https:\/\/example.com\/a"/);
});

test('update section is always open, latest first, only http(s) links', (t) => {
  const page = noScript(make(t).html);
  assert.ok(page.indexOf('Newest line') < page.indexOf('Older line'));
  assert.match(page, /Decisions/);
  assert.doesNotMatch(page, /javascript:/);
  assert.doesNotMatch(page, /<section class="req"[^>]*>[\s\S]*<details/);
  assert.doesNotMatch(page, /class="job"/);
});

test('a job line appears only while the data carries one', (t) => {
  assert.match(noScript(make(t, { ...SAMPLE, job: 'Checking prices' }).html), /class="job">Checking prices/);
});

test('no base64 or data URIs; images and logo are relative files; no localStorage', (t) => {
  const { html } = make(t);
  assert.doesNotMatch(html, /base64|data:image/i);
  assert.doesNotMatch(html, /localStorage/);
  assert.match(html, /<img src="logo.svg"/);
  assert.match(html, /<img src="a.jpg"/);
  assert.match(html, /--brand:#12ab34/);
  assert.ok(html.length < 40000);
});

test('brand neutral by default; tr labels follow cases.json lang', (t) => {
  const en = make(t, { ...SAMPLE, brand: {} }).html;
  assert.doesNotMatch(en, /zenger|veliefendi|[ğşİı]/i);
  const tr = make(t, { ...SAMPLE, lang: 'tr' }).html;
  assert.match(noScript(tr), /Güncelleme/);
  assert.match(noScript(tr), /Ayrıntı/);
});

test('--logo is copied next to the page; bad input exits 1', (t) => {
  const dir = tmpdir(t);
  const logo = path.join(dir, 'l.svg');
  fs.writeFileSync(logo, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
  const out = path.join(dir, 'out');
  assert.strictEqual(runTool('case.js', ['init', out, '--title', 'T', '--logo', logo, '--accent', '#abcdef']).status, 0);
  assert.ok(fs.existsSync(path.join(out, 'logo.svg')));
  assert.match(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), /<img src="logo.svg"/);
  fs.writeFileSync(path.join(out, 'cases.json'), '{bad');
  assert.strictEqual(runTool('case.js', ['render', out]).status, 1);
  fs.writeFileSync(path.join(out, 'cases.json'), JSON.stringify({ groups: [{ name: 'g', cases: [{ title: 'x', status: 'zzz' }] }] }));
  assert.strictEqual(runTool('case.js', ['render', out]).status, 1);
});
