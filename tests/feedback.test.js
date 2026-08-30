'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT, tmpdir, runTool } = require('./helpers');

const nf = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'note-format'));

const GOOD = {
  area: 'prompt', created: '2026-08-30',
  symptom: 'The assistant restated a rule it had already been given, twice in one session.',
  cause: 'The rule is injected in two layers and neither knows the other ran.',
  suggestion: 'Inject the layer once and let the later layer reference it.',
};

test('a clean note renders with every fixed section', () => {
  const text = nf.renderFeedbackNote(GOOD, ['Serkan', 'atay']);
  assert.match(text, /^---\n/);
  assert.match(text, /^area: prompt$/m);
  assert.match(text, /^type: feedback$/m);
  assert.match(text, /^reported: null$/m);
  for (const h of ['## Symptom', '## Suspected cause', '## Suggestion', '## Redaction check']) {
    assert.ok(text.includes(h), 'missing ' + h);
  }
});

test('an unknown area is refused, not guessed', () => {
  assert.throws(() => nf.renderFeedbackNote({ ...GOOD, area: 'misc' }, []), /area/i);
});

test('an empty field is refused', () => {
  assert.throws(() => nf.renderFeedbackNote({ ...GOOD, cause: '   ' }, []), /cause/i);
});

test('scanForIdentifiers catches what a leak actually looks like', () => {
  assert.ok(nf.scanForIdentifiers('mail from Sevgi Akkaya', []).length, 'two capitalised words');
  assert.ok(nf.scanForIdentifiers('write to a@b.com', []).length, 'an address');
  assert.ok(nf.scanForIdentifiers('see https://example.com/x', []).length, 'a url');
  assert.ok(nf.scanForIdentifiers('the owner said it', ['owner']).length, 'a forbidden word');
  assert.ok(nf.scanForIdentifiers('he said "' + 'x'.repeat(130) + '"', []).length, 'a long quote');
  assert.strictEqual(nf.scanForIdentifiers(GOOD.symptom, ['Serkan', 'atay']).length, 0,
    'a clean sentence scans clean');
});

test('a note carrying real data cannot be rendered at all', () => {
  assert.throws(
    () => nf.renderFeedbackNote({ ...GOOD, symptom: 'Sevgi Akkaya got the wrong file.' }, []),
    /redact|identifier/i);
  assert.throws(
    () => nf.renderFeedbackNote({ ...GOOD, cause: 'the atay workspace' }, ['atay']),
    /redact|identifier/i);
});

test('the redaction check records what was scanned, not a bare claim', () => {
  const text = nf.renderFeedbackNote(GOOD, ['Serkan', 'atay']);
  assert.match(text, /scanned for: names, addresses, links, quotations, workspace words/i);
});

// A false negative here is worse than a false positive: a long quotation that
// happens to contain a contraction (extremely common in real English speech)
// must still be caught. A char class that excludes the apostrophe from the
// quoted content — as well as from the delimiter — breaks the 120-char run at
// the first "don't"/"it's" and lets the quote through unflagged.
test('scanForIdentifiers still catches a long quotation containing a contraction', () => {
  const quoted = '"' + "well I don't think it's going to work, she said, and then went on for quite a long while about why not, at some real length here" + '"';
  assert.ok(nf.scanForIdentifiers(quoted, []).length, 'quote with an apostrophe inside');
});

// Turkish orthography: ş, ğ, ı, İ fall outside the Latin-1 ranges the brief's
// regex drafts used (À-Þ / ß-ÿ). A name written in the owner's own working
// language must not slip past the scan just because of its letters.
test('scanForIdentifiers catches a Turkish name with letters outside Latin-1', () => {
  assert.ok(nf.scanForIdentifiers('mail from Durmuş Kabak', []).length, 'name with ş');
  assert.ok(nf.scanForIdentifiers('mail from İrem Yaşar', []).length, 'name starting with İ');
});

test('scaffold records the feedback choice', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js',
    ['--target', dir, '--workspace', 'w', '--feedback', 'auto', '--github', 'someuser']);
  assert.strictEqual(r.status, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.feedback.mode, 'auto');
  assert.strictEqual(cfg.feedback.github, 'someuser');
  assert.match(cfg.feedback.askedOn, /^\d{4}-\d{2}-\d{2}$/);
});

test('feedback without a github user is still a valid choice', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--feedback', 'manual']);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.feedback.mode, 'manual');
  assert.strictEqual(cfg.feedback.github, null);
});

test('scaffold omits the feedback block when it was never asked', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual('feedback' in cfg, false, 'absent, not a fabricated opt-in');
});

test('scaffold rejects an unknown feedback mode before writing anything', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--feedback', 'sometimes']);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /feedback/i);
  assert.strictEqual(fs.existsSync(dir), false, 'nothing written on a bad flag');
});

// R12: a second config block, same shape and same discipline as `feedback`,
// for whether .joserah/agent.md is allowed to keep itself up to date.
test('scaffold records the identity-mode choice', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js',
    ['--target', dir, '--workspace', 'w', '--identity-mode', 'manual']);
  assert.strictEqual(r.status, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.identity.mode, 'manual');
  assert.match(cfg.identity.askedOn, /^\d{4}-\d{2}-\d{2}$/);
});

test('scaffold omits the identity block when it was never asked', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual('identity' in cfg, false, 'absent, not a fabricated opt-in');
});

test('scaffold rejects an unknown identity-mode before writing anything', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--identity-mode', 'sometimes']);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /identity/i);
  assert.strictEqual(fs.existsSync(dir), false, 'nothing written on a bad flag');
});

// R13: an earlier task established that the install flow's create call runs
// before these questions are asked, so both blocks must also be reachable
// through --identity-only — the same entry point --consent-model already
// uses for exactly this reason.
test('scaffold --identity-only accepts --feedback and --identity-mode on an existing workspace', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const r = runTool('scaffold.js', ['--identity-only', '--target', dir,
    '--feedback', 'auto', '--github', 'someuser', '--identity-mode', 'off']);
  assert.strictEqual(r.status, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.feedback.mode, 'auto');
  assert.strictEqual(cfg.feedback.github, 'someuser');
  assert.strictEqual(cfg.identity.mode, 'off');
});

test('scaffold --identity-only rejects an unknown feedback or identity-mode before writing anything', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const before = fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8');
  const r1 = runTool('scaffold.js', ['--identity-only', '--target', dir, '--feedback', 'sometimes']);
  assert.notStrictEqual(r1.status, 0);
  assert.match(r1.stderr, /feedback/i);
  const r2 = runTool('scaffold.js', ['--identity-only', '--target', dir, '--identity-mode', 'sometimes']);
  assert.notStrictEqual(r2.status, 0);
  assert.match(r2.stderr, /identity/i);
  const after = fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8');
  assert.strictEqual(after, before, 'config.json untouched by a rejected --identity-only call');
});

// Non-destructive, like --consent-model: a later --identity-only run that
// does not repeat the flag must leave the existing block exactly as it was.
test('a later --identity-only call without --feedback/--identity-mode leaves existing blocks untouched', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w',
    '--feedback', 'auto', '--github', 'someuser', '--identity-mode', 'manual']);
  const r = runTool('scaffold.js', ['--identity-only', '--target', dir, '--owner', 'O', '--language', 'en']);
  assert.strictEqual(r.status, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.feedback.mode, 'auto');
  assert.strictEqual(cfg.feedback.github, 'someuser');
  assert.strictEqual(cfg.identity.mode, 'manual');
});
