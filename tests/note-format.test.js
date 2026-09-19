'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');
const nf = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'note-format'));

test('parseFrontmatter: no frontmatter yields empty data and untouched body', () => {
  const r = nf.parseFrontmatter('# Title\n\nbody\n');
  assert.strictEqual(r.hasFrontmatter, false);
  assert.deepStrictEqual(r.data, {});
  assert.strictEqual(r.body, '# Title\n\nbody\n');
});

test('parseFrontmatter: reads simple keys and a list', () => {
  const r = nf.parseFrontmatter('---\ntitle: Vektura Agency\ntype: company\ntags: [vektura, ops]\n---\n\nbody\n');
  assert.strictEqual(r.hasFrontmatter, true);
  assert.strictEqual(r.data.title, 'Vektura Agency');
  assert.strictEqual(r.data.type, 'company');
  assert.deepStrictEqual(r.data.tags, ['vektura', 'ops']);
  assert.strictEqual(r.body, '\nbody\n');
});

test('ensureFrontmatter: adds a block when there is none', () => {
  const r = nf.ensureFrontmatter('# Vektura Agency\n\nbody\n', { title: 'Vektura Agency', type: 'company' });
  assert.strictEqual(r.changed, true);
  assert.match(r.text, /^---\ntitle: Vektura Agency\ntype: company\n---\n\n# Vektura Agency/);
});

test('ensureFrontmatter: is idempotent and preserves unknown keys verbatim', () => {
  const first = nf.ensureFrontmatter('---\ncustom_field: keep me\n---\n\nbody\n',
    { title: 'Note', type: 'note' });
  assert.strictEqual(first.changed, true);
  assert.match(first.text, /custom_field: keep me/);
  const second = nf.ensureFrontmatter(first.text, { title: 'Note', type: 'note' });
  assert.strictEqual(second.changed, false);
  assert.strictEqual(second.text, first.text);
});

test('ensureFrontmatter: never overwrites an existing managed key', () => {
  const r = nf.ensureFrontmatter('---\ntitle: Owner Chosen\n---\n\nbody\n',
    { title: 'Derived', type: 'note' });
  assert.match(r.text, /title: Owner Chosen/);
  assert.doesNotMatch(r.text, /title: Derived/);
});

test('ensureFrontmatter: preserves CRLF byte-for-byte on an existing block', () => {
  const input = '---\r\ncustom_field: keep me\r\n---\r\n\r\nbody\r\n';
  const r = nf.ensureFrontmatter(input, { title: 'Note', type: 'note' });
  assert.strictEqual(r.changed, true);
  assert.strictEqual(
    r.text,
    '---\r\ncustom_field: keep me\r\ntitle: Note\r\ntype: note\r\n---\r\n\r\nbody\r\n'
  );
  // No lone LF (an LF not preceded by CR) anywhere — the whole file stays CRLF.
  assert.doesNotMatch(r.text, /[^\r]\n|^\n/);
});

test('ensureFrontmatter: is idempotent on CRLF input', () => {
  const input = '---\r\ncustom_field: keep me\r\n---\r\n\r\nbody\r\n';
  const first = nf.ensureFrontmatter(input, { title: 'Note', type: 'note' });
  const second = nf.ensureFrontmatter(first.text, { title: 'Note', type: 'note' });
  assert.strictEqual(second.changed, false);
  assert.strictEqual(second.text, first.text);
});

test('ensureFrontmatter: a new block on a CRLF document uses CRLF, not LF', () => {
  const r = nf.ensureFrontmatter('# Title\r\n\r\nbody\r\n', { title: 'Title', type: 'note' });
  assert.strictEqual(r.changed, true);
  assert.strictEqual(
    r.text,
    '---\r\ntitle: Title\r\ntype: note\r\n---\r\n\r\n# Title\r\n\r\nbody\r\n'
  );
});

test('ensureFrontmatter: leaves an unterminated frontmatter block untouched', () => {
  const input = '---\ntitle: X\nno closing delimiter\n';
  const r = nf.ensureFrontmatter(input, { title: 'Note', type: 'note' });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.text, input);
});

test('parseObservations: category, tags and context', () => {
  const obs = nf.parseObservations('- [method] Pour over extracts floral notes #brewing (slow)\n- plain bullet\n');
  assert.strictEqual(obs.length, 1);
  assert.strictEqual(obs[0].category, 'method');
  assert.strictEqual(obs[0].content, 'Pour over extracts floral notes #brewing');
  assert.deepStrictEqual(obs[0].tags, ['brewing']);
  assert.strictEqual(obs[0].context, 'slow');
});

test('parseRelations: typed relation and context', () => {
  const rel = nf.parseRelations('- works_at [[Vektura Agency]] (since 2019)\n- [[Bare Link]]\n');
  assert.strictEqual(rel.length, 2);
  assert.deepStrictEqual(rel[0], { type: 'works_at', target: 'Vektura Agency', context: 'since 2019' });
  assert.deepStrictEqual(rel[1], { type: 'links_to', target: 'Bare Link', context: null });
});

test('extractWikilinks: unique and ordered', () => {
  assert.deepStrictEqual(nf.extractWikilinks('see [[A]] then [[B]] and [[A]] again'), ['A', 'B']);
});

test('renderRelations: emits a Relations block', () => {
  const out = nf.renderRelations([{ type: 'mentions', target: 'Meridyen', context: null }]);
  assert.strictEqual(out, '\n## Relations\n\n- mentions [[Meridyen]]\n');
});

test('stripCode: blanks fenced and inline code but preserves line count', () => {
  const input = 'see [[Meridyen]]\n```\n[[Meridyen]] inside a fence\n```\nand `[[Meridyen]]` inline\n';
  const out = nf.stripCode(input);
  assert.match(out, /see \[\[Meridyen\]\]/, 'prose outside code is untouched');
  assert.strictEqual(out.split('\n').length, input.split('\n').length, 'line count preserved');
  assert.doesNotMatch(out, /\[\[Meridyen\]\] inside a fence/, 'fenced content blanked');
  assert.doesNotMatch(out, /`\[\[Meridyen\]\]`/, 'inline code blanked');
});

test('parseClaims: reads type, subject, value and the indented field lines', () => {
  const body = [
    '# Page',
    '',
    '- [measurement] Gemma-4-26B VRAM @65536 -> 20009 MiB',
    '  condition: RTX 4090 24564 MiB · LM Studio · Q4_K_M',
    '  date: 2026-08-28 · by: owner · source: ../imports/2026-09-10-x/',
    '',
  ].join('\n');
  const claims = nf.parseClaims(body);
  assert.strictEqual(claims.length, 1);
  const c = claims[0];
  assert.strictEqual(c.type, 'measurement');
  assert.strictEqual(c.subject, 'Gemma-4-26B VRAM @65536');
  assert.strictEqual(c.value, '20009 MiB');
  assert.strictEqual(c.struck, false);
  assert.strictEqual(c.line, 3);
  assert.deepStrictEqual(c.fields, {
    condition: 'RTX 4090 24564 MiB · LM Studio · Q4_K_M',
    date: '2026-08-28', by: 'owner', source: '../imports/2026-09-10-x/',
  });
});

test('parseClaims: a struck line is superseded; the field carries what replaced it', () => {
  const body = [
    '- [calculation] ~~Gemma context cost -> ~14x per token~~',
    '  date: 2026-08-25 · by: assistant · superseded: measurement of 2026-08-28 — old line held only for FreeToken/NVFP4 @32768',
  ].join('\n');
  const [c] = nf.parseClaims(body);
  assert.strictEqual(c.struck, true);
  assert.strictEqual(c.text, 'Gemma context cost -> ~14x per token');
  assert.strictEqual(c.subject, 'Gemma context cost');
  assert.match(c.fields.superseded, /^measurement of 2026-08-28/);
});

test('parseClaims: ignores ordinary observations, relations and non-indented lines', () => {
  const body = [
    '- [fact] Works at Vektura',
    '- knows [[Someone]]',
    '- [decision] Storage stays markdown; SQLite is a disposable index',
    'condition: not a field — same indent as the dash, so this is prose',
    '  by: owner',
  ].join('\n');
  const claims = nf.parseClaims(body);
  assert.strictEqual(claims.length, 1);
  assert.strictEqual(claims[0].type, 'decision');
  assert.strictEqual(claims[0].value, null);
  assert.deepStrictEqual(claims[0].fields, {}); // the by: line is cut off by the prose line before it
});

test('parseClaims: CRLF bodies and an arrow written as → parse the same', () => {
  const body = '- [estimate] harvest per session → 40 s\r\n  by: assistant · date: 2026-09-12\r\n';
  const [c] = nf.parseClaims(body);
  assert.strictEqual(c.subject, 'harvest per session');
  assert.strictEqual(c.value, '40 s');
  assert.strictEqual(c.fields.by, 'assistant');
});

test('CLAIM_TYPES is the closed list from the design', () => {
  assert.deepStrictEqual(nf.CLAIM_TYPES, ['measurement', 'calculation', 'decision', 'estimate']);
});

// ---- the three silent ways a claim falls out of the audit (0.8.0) ----------
// Each of these parsed clean and reported nothing: the type was wrong, the
// separator was wrong, or the claim's own sentence was wrapped. findClaimAnomalies
// is additive — parseClaims still returns exactly what it returned before.

test('findClaimAnomalies: a near-miss type with claim fields under it is reported', () => {
  const body = [
    '# Page', '',
    '- [claim] Widget throughput -> 40 per second',
    '  date: 2026-09-12 · by: assistant · source: ../imports/x/run.log',
    '',
  ].join('\n');
  const found = nf.findClaimAnomalies(body);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].kind, 'unknown-claim-type');
  assert.strictEqual(found[0].line, 3);
  assert.match(found[0].detail, /\[claim\]/);
  for (const t of nf.CLAIM_TYPES) assert.match(found[0].detail, new RegExp(t));
  assert.deepStrictEqual(nf.parseClaims(body), []);
});

test('findClaimAnomalies: an ordinary observation with no claim fields under it is left alone', () => {
  const body = [
    '- [fact] owner works on the widget line',
    '  a plain indented continuation, no field keys',
    '- [preference] assistant writes in English',
    '',
  ].join('\n');
  assert.deepStrictEqual(nf.findClaimAnomalies(body), []);
});

test('findClaimAnomalies: a field value that swallows the next key is reported', () => {
  const body = [
    '- [measurement] Widget weight -> 4 kg',
    '  condition: bench scale',
    '  date: 2026-09-12 - by: owner - source: ../imports/x/scale.log',
    '',
  ].join('\n');
  const found = nf.findClaimAnomalies(body);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].kind, 'swallowed-field');
  assert.strictEqual(found[0].line, 3);
  assert.match(found[0].detail, /by:/);
  assert.match(found[0].detail, /·/);
  // and the proof it matters: the audit only ever saw `date`
  const [c] = nf.parseClaims(body);
  assert.deepStrictEqual(Object.keys(c.fields), ['condition', 'date']);
});

test('findClaimAnomalies: a wrapped claim sentence that severs the fields is reported', () => {
  const body = [
    '- [decision] Widget ships on the later date because the earlier one',
    '  collided with a holiday',
    '  date: 2026-09-12 · by: owner',
    '',
  ].join('\n');
  const found = nf.findClaimAnomalies(body);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].kind, 'severed-claim');
  assert.strictEqual(found[0].line, 2);
  assert.match(found[0].detail, /line 1/);
  const [c] = nf.parseClaims(body);
  assert.deepStrictEqual(c.fields, {}); // exactly what the finding is about
});

test('findClaimAnomalies: well-formed claims, CRLF included, report nothing', () => {
  const body = [
    '- [measurement] Widget VRAM @65536 -> 20009 MiB',
    '  condition: bench rig · runtime · Q4_K_M',
    '  date: 2026-08-28 · by: owner · source: ../imports/x/server.log',
    '- [calculation] ~~Widget context cost -> ~14x per token~~',
    '  date: 2026-08-25 · by: assistant · superseded: the measurement above',
    '',
  ].join('\n');
  assert.deepStrictEqual(nf.findClaimAnomalies(body), []);
  assert.deepStrictEqual(nf.findClaimAnomalies(body.replace(/\n/g, '\r\n')), []);
});
