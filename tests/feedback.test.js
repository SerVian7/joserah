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

// Fix round 1 — the forbidden-word loop still used a plain \b...\b after the
// name pattern had already been fixed to not rely on it. \b is defined
// against ASCII \w only, so it never fires next to a non-ASCII letter: a
// forbidden word beginning or ending with a Turkish letter was invisible in
// every context, not just the name check. This is the case that matters
// most, since the caller passes the workspace's own vocabulary — the
// owner's name, the workspace name, host names — and this workspace's data
// is Turkish.
test('scanForIdentifiers catches a forbidden word that starts with a Turkish letter', () => {
  assert.ok(nf.scanForIdentifiers('İrem geldi', ['İrem']).length, 'forbidden word starting with İ');
  assert.ok(nf.scanForIdentifiers('mail from Şahin', ['Şahin']).length, 'forbidden word starting with Ş');
  assert.ok(nf.scanForIdentifiers('cc Özgür on this', ['Özgür']).length, 'forbidden word starting with Ö');
});

// Same boundary bug, different trigger: \b cannot fire between two
// non-word characters, so a forbidden word whose first or last character is
// a symbol never matches either, regardless of script.
test('scanForIdentifiers catches a forbidden word with a symbol at either edge', () => {
  assert.ok(nf.scanForIdentifiers('the c++ tool broke', ['c++']).length, 'symbol-suffixed forbidden word');
});

// Regression guard: fixing the boundary must not turn the forbidden-word
// check into a bare substring search — "Atayland" contains "atay" but is a
// different word and must not trip the scan.
test('scanForIdentifiers does not flag a forbidden word as a mere substring', () => {
  assert.strictEqual(nf.scanForIdentifiers('Atayland is a theme park', ['atay']).length, 0,
    'substring match must not count as a whole-word hit');
});

// A shouted name has no lowercase run for the old [A-Z][a-z]+-only word
// pattern to find — a quoted subject line or signature block is exactly
// where this shows up.
test('scanForIdentifiers catches a name written in ALL CAPS', () => {
  assert.ok(nf.scanForIdentifiers('mail from SEVGI AKKAYA about the file', []).length,
    'all-caps two-word name');
});

// Fix round 2 — the ALL-CAPS fix above (`{2,}` on a bare capital run) fired
// on any two adjacent all-caps words, and acronyms are the native vocabulary
// of a note type that is feedback about a piece of software's prompts and
// structure. These MUST NOT be read as a personal name.
test('scanForIdentifiers does not flag two adjacent acronyms as a personal name', () => {
  assert.strictEqual(nf.scanForIdentifiers('the API URL changed', []).length, 0, 'API URL');
  assert.strictEqual(nf.scanForIdentifiers('HTML CSS are both used', []).length, 0, 'HTML CSS');
  assert.strictEqual(nf.scanForIdentifiers('see README FAQ for details', []).length, 0, 'README FAQ');
  assert.strictEqual(nf.scanForIdentifiers('TODO LIST here', []).length, 0, 'TODO LIST');
  assert.strictEqual(nf.scanForIdentifiers('reads JSON YAML both', []).length, 0, 'JSON YAML');
  assert.strictEqual(nf.scanForIdentifiers('supports HTTP HTTPS both', []).length, 0, 'HTTP HTTPS');
});

// The tightening that keeps the acronym pairs above clean must not reopen
// the ALL-CAPS name gap it was built to close — a real all-caps name, in the
// owner's own working language, still has to be caught.
test('scanForIdentifiers still catches an ALL-CAPS Turkish name after the acronym fix', () => {
  assert.ok(nf.scanForIdentifiers('mail from DURMUŞ KABAK', []).length, 'all-caps Turkish name');
});

// A social/GitHub handle identifies a person as surely as their name does,
// and the address check only fires on a dotted email domain — a bare @handle
// needs its own check.
test('scanForIdentifiers catches a bare @handle', () => {
  assert.ok(nf.scanForIdentifiers('ping @sevgiakkaya about this', []).length, 'a handle, not an email');
});

// Scheme-less domains: a link check that only recognises http(s):// misses
// exactly the links people paste without a scheme.
test('scanForIdentifiers catches a scheme-less domain', () => {
  assert.ok(nf.scanForIdentifiers('see example.com/x for details', []).length, 'bare domain with a path');
  assert.ok(nf.scanForIdentifiers('see www.example.com for details', []).length, 'www.-prefixed domain');
});

// A long quotation delimited only by curly single quotes must be caught too
// — the fix for the double-quote/apostrophe conflict did not extend to this
// quote family.
test('scanForIdentifiers catches a long quotation in curly single quotes', () => {
  const quoted = '‘' + 'x'.repeat(130) + '’';
  assert.ok(nf.scanForIdentifiers(quoted, []).length, 'curly single-quoted long quote');
});

// forbidden is documented as optional in practice (a caller with no
// workspace vocabulary yet should still be able to render a clean note) —
// must not throw just because the second argument was never passed.
test('renderFeedbackNote works with forbidden left undefined', () => {
  assert.doesNotThrow(() => nf.renderFeedbackNote(GOOD, undefined));
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

// Task 19: tools/feedback.js — file it, or drop it without fuss.
const FEEDBACK_REPO = 'SerVian7/joserah';

function seedNote(root, area, name) {
  const dir = path.join(root, '.joserah', 'feedback', area);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, nf.renderFeedbackNote(GOOD, []));
  return p;
}

test('--list names only the notes that were never reported', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const a = seedNote(dir, 'prompt', '2026-08-30-a.md');
  const b = seedNote(dir, 'structure', '2026-08-30-b.md');
  fs.writeFileSync(b, fs.readFileSync(b, 'utf8')
    .replace('reported: null', 'reported: https://example.invalid/1'));
  const out = runTool('feedback.js', ['--list', dir]).stdout;
  assert.ok(out.includes(path.basename(a)), 'unreported note is listed');
  assert.ok(!out.includes(path.basename(b)), 'reported note is not listed again');
});

test('--report exits 3, not 1, when gh cannot be used', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const p = seedNote(dir, 'prompt', '2026-08-30-a.md');
  // PATH emptied: `gh` cannot resolve, which is exactly the give-up case.
  const r = runTool('feedback.js', ['--report', p, '--root', dir], { env: { PATH: '' } });
  assert.strictEqual(r.status, 3, r.stderr);
  assert.match(r.stderr + r.stdout, /gh|github/i);
  assert.match(fs.readFileSync(p, 'utf8'), /reported: null/, 'the note is left alone');
});

test('--report refuses a note that would leak, even if it is on disk', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'Ada Lovelace']);
  const p = seedNote(dir, 'prompt', '2026-08-30-a.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8')
    .replace('## Symptom\n\nThe', '## Symptom\n\nAda Lovelace saw the'));
  const r = runTool('feedback.js', ['--report', p, '--root', dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /redact/i);
});

test('the repository it reports to is the plugin repository, not the workspace', () => {
  const src = fs.readFileSync(path.join(PLUGIN_ROOT, 'tools', 'feedback.js'), 'utf8');
  assert.ok(src.includes(FEEDBACK_REPO), 'reports to ' + FEEDBACK_REPO);
});
