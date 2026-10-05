'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');
const W = require('../tools/lib/wiki');

function kb(t, files) {
  const ws = tmpdir(t);
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(ws, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text);
  }
  return ws;
}
const K = '.joserah/knowledge/';

test('scan reads titles, links and wikilinks; backlinks follow them', (t) => {
  const ws = kb(t, {
    [K + 'wiki/topics/encoders.md']: '---\ntitle: Encoders\ntype: topic\n---\n\nSee [the unit](../entities/unit-a.md) and [[unit-a]].\n',
    [K + 'wiki/entities/unit-a.md']: '# Unit A\n\nA box.\n',
  });
  const pages = W.scan(ws);
  assert.deepEqual(pages.map((p) => p.rel).sort(), ['wiki/entities/unit-a.md', 'wiki/topics/encoders.md']);
  const enc = pages.find((p) => p.rel === 'wiki/topics/encoders.md');
  assert.equal(enc.title, 'Encoders'); assert.equal(enc.type, 'topic');
  assert.deepEqual(enc.links, ['wiki/entities/unit-a.md']);
  assert.equal(W.resolveWikilink(pages, 'unit-a'), 'wiki/entities/unit-a.md');
  assert.equal(W.resolveWikilink(pages, 'Unit A'), 'wiki/entities/unit-a.md');
  assert.deepEqual(W.backlinks(pages).get('wiki/entities/unit-a.md'), ['wiki/topics/encoders.md']);
});

test('resolveLink stays inside the workspace and names outside targets', () => {
  assert.deepEqual(W.resolveLink('wiki/topics/a.md', '../entities/b.md#x'), { kind: 'page', rel: 'wiki/entities/b.md' });
  assert.deepEqual(W.resolveLink('wiki/entities/a.md', '../../../../imports/2026-10-01-upload/x.pdf'), { kind: 'outside', rel: 'imports/2026-10-01-upload/x.pdf' });
  assert.equal(W.resolveLink('wiki/a.md', 'https://example.invalid'), null);
  assert.equal(W.resolveLink('wiki/a.md', '../../../../../etc/passwd'), null);
});

test('resolveLink refuses encoded, backslash and malformed traversal', () => {
  for (const href of [
    '..%2f..%2f..%2f..%2f..%2fetc%2fpasswd',
    '%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
    '..\\..\\..\\..\\..\\etc\\passwd',
    '..%5c..%5c..%5c..%5c..%5cetc%5cpasswd',
    'C:\\Windows\\win.ini',
    '//example.invalid/x.md',
    '/etc/passwd',
    'a%00.md',
    '%E0%A4%A',
    '../../../..',
  ]) assert.equal(W.resolveLink('wiki/a.md', href), null, href);
  assert.deepEqual(W.resolveLink('wiki/topics/a.md', '..\\entities\\b.md'), { kind: 'page', rel: 'wiki/entities/b.md' });
  assert.deepEqual(W.resolveLink('wiki/topics/a.md', '..%2fentities%2fb.md'), { kind: 'page', rel: 'wiki/entities/b.md' });
  assert.deepEqual(W.resolveLink('wiki/a.md', '../..'), { kind: 'outside', rel: '.joserah' });
  assert.equal(W.resolveLink('wiki/a.md', '..'), null);
  assert.deepEqual(W.resolveLink('wiki/a.md', '../../config.json'), { kind: 'outside', rel: '.joserah/config.json' });
});

test('scan never follows a link out of the knowledge folder', (t) => {
  const ws = kb(t, { [K + 'wiki/a.md']: '# A\n', 'outside/secret.md': '# Secret\n' });
  try {
    fs.symlinkSync(path.join(ws, 'outside'), path.join(ws, K, 'wiki', 'linked'), 'junction');
    fs.symlinkSync(path.join(ws, 'outside', 'secret.md'), path.join(ws, K, 'wiki', 'secret.md'), 'file');
  } catch (e) {
    if (!fs.existsSync(path.join(ws, K, 'wiki', 'linked'))) { t.skip(`no links on this machine: ${e.code}`); return; }
  }
  assert.deepEqual(W.scan(ws).map((p) => p.rel), ['wiki/a.md']);
});

test('the index has one line per page and skips the generated files', (t) => {
  const ws = kb(t, {
    [K + 'wiki/topics/a.md']: '---\ntitle: Alpha\ntype: topic\ndescription: First page\n---\n',
    [K + 'wiki/index.md']: 'old', [K + 'wiki/log.md']: '# Wiki log\n',
  });
  const text = W.buildIndex(W.scan(ws));
  assert.match(text, /^# Wiki index$/m);
  assert.match(text, /^- \[Alpha\]\(topics\/a\.md\) — topic · First page$/m);
  assert.ok(!/index\.md\)|log\.md\)/.test(text));
  assert.equal(W.logLine('ingest', 'x.pdf', '2026-10-06'), '## [2026-10-06] ingest | x.pdf\n');
});

test('claims carry their page; struck lines are marked', (t) => {
  const ws = kb(t, { [K + 'wiki/entities/enc.md']: '# Enc\n\n- [measurement] latency -> 120 ms\n  condition: 1080p50 · date: 2026-09-01 · source: imports/a.md\n- [calculation] ~~latency -> 90 ms~~\n  superseded: the measurement above\n' });
  const c = W.claims(W.scan(ws));
  assert.equal(c.length, 2);
  assert.equal(c[0].page, 'wiki/entities/enc.md');
  assert.equal(c[1].struck, true);
});

test('search folds Turkish letters and case', (t) => {
  const ws = kb(t, { [K + 'wiki/topics/i.md']: '# İç yayın\n\nSinyal ışığı.\n' });
  const pages = W.scan(ws);
  assert.equal(W.search(pages, 'ic yayin')[0].rel, 'wiki/topics/i.md');
  assert.equal(W.search(pages, 'ISIGI')[0].rel, 'wiki/topics/i.md');
  assert.deepEqual(W.search(pages, 'nothing here'), []);
});

test('lint finds each kind', (t) => {
  const big = '# Big\n\n' + 'x'.repeat(W.SIZE_LIMIT + 10) + '\n';
  const ws = kb(t, {
    [K + 'wiki/topics/a.md']: '# A\n\n[gone](missing.md) [b](../entities/b.md)\n- [measurement] fps -> 50\n  date: 2026-09-01\n- [decision] ~~use x~~\n  date: 2026-09-01\n',
    [K + 'wiki/entities/b.md']: '# B\n\nlinks back to [a](../topics/a.md)\n',
    [K + 'wiki/entities/lonely.md']: '# Lonely\n',
    [K + 'wiki/topics/lonely.md']: '---\ntitle: also lonely\n',
    [K + 'wiki/topics/big.md']: big,
    'imports/2026-09-01-upload/old.txt': 'raw',
  });
  const old = new Date('2026-09-01T00:00:00Z'); fs.utimesSync(path.join(ws, 'imports/2026-09-01-upload/old.txt'), old, old);
  const kinds = new Set(W.lint(ws, { now: new Date('2026-10-06T09:00:00Z') }).map((f) => `${f.kind}:${f.rel}`));
  for (const k of ['broken-link:wiki/topics/a.md', 'orphan:wiki/entities/lonely.md', 'frontmatter:wiki/topics/lonely.md', 'claim:wiki/topics/a.md',
    'superseded:wiki/topics/a.md', 'duplicate-slug:wiki/topics/lonely.md', 'size:wiki/topics/big.md', 'stale-raw:imports/2026-09-01-upload/old.txt']) assert.ok(kinds.has(k), k);
  assert.ok(!kinds.has('orphan:wiki/entities/b.md'));
});

test('wiki.js index writes once, lint prints findings, log appends', (t) => {
  const ws = kb(t, { [K + 'wiki/topics/a.md']: '# A\n' });
  let r = runTool('wiki.js', ['index', ws]);
  assert.match(r.stdout, /^index: 1 pages \(written\)$/m);
  r = runTool('wiki.js', ['index', ws]);
  assert.match(r.stdout, /^index: 1 pages \(unchanged\)$/m);
  r = runTool('wiki.js', ['lint', ws]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^findings: \d+$/m);
  r = runTool('wiki.js', ['log', ws, '--op', 'query', '--title', 'What is A?'], { env: { JOSERAH_NOW: '2026-10-06T09:00:00' } });
  assert.equal(fs.readFileSync(path.join(ws, K, 'wiki/log.md'), 'utf8'), '# Wiki log\n\n## [2026-10-06] query | What is A?\n');
});

test('resolveLink refuses a drive letter reached through a climb, and keeps a climb back into the knowledge folder a page', () => {
  assert.equal(W.resolveLink('wiki/a.md', '../C:/Windows/win.ini'), null);
  assert.equal(W.resolveLink('wiki/a.md', '../../../C:/Windows/win.ini'), null);
  assert.equal(W.resolveLink('wiki/a.md', '..\..\..\C:\Windows\win.ini'), null);
  assert.deepEqual(W.resolveLink('wiki/a.md', '../../knowledge/wiki/b.md'), { kind: 'page', rel: 'wiki/b.md' });
});

test('claim and lint line numbers count from the top of the file', (t) => {
  const ws = kb(t, { [K + 'wiki/entities/enc.md']: '---\ntitle: Enc\ntype: entity\n---\n\n# Enc\n\n- [measurement] fps -> 50\n  date: 2026-09-01\n' });
  const pages = W.scan(ws);
  assert.equal(W.claims(pages)[0].line, 8);
  const f = W.lint(ws, { now: new Date('2026-10-06T09:00:00Z') }).find((x) => x.kind === 'claim');
  assert.equal(f.line, 8);
});

test('lint checks links that leave the knowledge folder', (t) => {
  const ws = kb(t, {
    [K + 'wiki/a.md']: '# A\n\n[src](../../../imports/2026-10-01-upload/here.txt) [gone](../../../imports/2026-10-01-upload/gone.txt)\n',
    'imports/2026-10-01-upload/here.txt': 'x',
  });
  const broken = W.lint(ws, { now: new Date('2026-10-02T00:00:00Z') }).filter((f) => f.kind === 'broken-link').map((f) => f.detail);
  assert.equal(broken.length, 1);
  assert.match(broken[0], /gone\.txt/);
});

test('a search snippet holds the match even after characters that fold longer', (t) => {
  const ws = kb(t, { [K + 'wiki/a.md']: '# A\n\n' + '… ½ ﬁ '.repeat(40) + 'the encoder sits here' + ' tail'.repeat(40) + '\n' });
  const [hit] = W.search(W.scan(ws), 'encoder');
  assert.match(hit.snippet, /encoder/);
});

test('index links survive spaces and brackets', (t) => {
  const ws = kb(t, { [K + 'wiki/topics/my page.md']: '---\ntitle: A [draft] page\n---\n' });
  const text = W.buildIndex(W.scan(ws));
  assert.ok(text.split('\n').includes('- [A \\[draft\\] page](topics/my%20page.md) — page'), text);
});

test('wiki.js refuses a folder that is not a workspace and keeps log lines apart', (t) => {
  const missing = path.join(tmpdir(t), 'no-such');
  let r = runTool('wiki.js', ['index', missing]);
  assert.equal(r.status, 1);
  assert.ok(!fs.existsSync(missing));
  r = runTool('wiki.js', ['log', missing, '--op', 'lint', '--title', 'x']);
  assert.equal(r.status, 1);
  assert.ok(!fs.existsSync(missing));
  const ws = kb(t, { [K + 'wiki/log.md']: '# Wiki log\n\n## [2026-10-05] ingest | a' });
  runTool('wiki.js', ['log', ws, '--op', 'lint', '--title', 'b'], { env: { JOSERAH_NOW: '2026-10-06T09:00:00' } });
  assert.equal(fs.readFileSync(path.join(ws, K, 'wiki/log.md'), 'utf8'), '# Wiki log\n\n## [2026-10-05] ingest | a\n## [2026-10-06] lint | b\n');
});
