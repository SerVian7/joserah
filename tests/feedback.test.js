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

// Fix round 1 (controller review of eccc26d).
//
// CRITICAL 1 — feedback.js used to scan only the three extracted prose
// sections while handing `gh` the whole raw file via --body-file: anything
// added outside those sections (e.g. below the fixed Redaction-check
// heading) went unscanned yet was still published. Proven directly: append
// a P.S. line after the note's fixed sections and confirm it is still
// caught now that the scan runs over the raw file text.
test('--report scans the WHOLE file, not just the extracted sections', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const p = seedNote(dir, 'prompt', '2026-08-30-a.md');
  fs.appendFileSync(p, '\nP.S. contact Ada Lovelace at ada@example.com\n');
  const r = runTool('feedback.js', ['--report', p, '--root', dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /redact/i);
});

// The controller's ruling requires confirming a freshly rendered clean note
// still passes a whole-file scan (frontmatter, headings and the
// Redaction-check sentence included) before this could be trusted at all.
// It did not, the first time: see the scanForIdentifiers regression test
// below this one, in the same file, for the bug that caused it and the fix.
test('a freshly rendered, clean note passes a whole-file scan (frontmatter and headings included)', () => {
  const text = nf.renderFeedbackNote(GOOD, ['Serkan', 'atay', 'joserah']);
  assert.deepStrictEqual(nf.scanForIdentifiers(text, ['Serkan', 'atay', 'joserah']), []);
});

// Fix round 1: the personal-name check's word separator was a bare `\s+`,
// which matches `\n` — so scanning a WHOLE rendered note (as --report now
// must) always read a section heading and the next section's opening,
// capitalized, word as "two adjacent words" forming a name:
// "## Symptom\n\nThe assistant..." matched "Symptom" + "The". That made the
// whole-file re-scan reject every clean note there is, not just leaky ones.
// A real two-word name is always written on one line, so the separator is
// same-line whitespace only now (tools/lib/note-format.js).
test('scanForIdentifiers does not read a heading and the next paragraph\'s first word as a name', () => {
  const text = nf.renderFeedbackNote(GOOD, []);
  assert.deepStrictEqual(nf.scanForIdentifiers(text, []), [],
    'a freshly rendered, clean note must pass a whole-file scan');
});

// Fix round 2: narrowing the separator to same-line whitespace only closed
// the heading+paragraph false positive above, but reopened a real gap —
// hard-wrapped prose (a pasted email signature, an 80-column terminal copy)
// splits a real name across exactly one line break with no blank line in
// between, and that used to scan clean at 5518cae. Both reviewer-probed
// shapes must still be caught; a genuine paragraph break (a blank line, two
// line breaks) between two capitalized words must still NOT be — that is
// exactly the heading/paragraph shape fix round 1 exists to let through.
test('scanForIdentifiers still catches a name split by exactly one hard line-wrap, but not by a blank line', () => {
  assert.ok(nf.scanForIdentifiers('Kindest regards,\nSevgi\nAkkaya', []).length,
    'a signature wrapped onto its own two lines');
  assert.ok(nf.scanForIdentifiers('...written by Sevgi\nAkkaya during review.', []).length,
    'a name split by an ordinary hard line-wrap');
  assert.deepStrictEqual(nf.scanForIdentifiers('Sevgi\n\nAkkaya', []), [],
    'a blank line between two capitalized words is a paragraph break, not a wrapped name');
});

// CRITICAL 2 — --root used to be resolved with path.resolve() alone and
// handed to readConfig, which returns null on any failure; feedback.js then
// fell back to `|| {}`, silently emptying the forbidden-word vocabulary and
// reporting anyway. A wrong --root must be bad input, never a quiet
// downgrade to "no vocabulary".
test('--report exits 1 when --root is not a Joserah workspace, instead of reporting with an empty vocabulary', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const p = seedNote(dir, 'prompt', '2026-08-30-a.md');
  const notAWorkspace = tmpdir(t);
  const r = runTool('feedback.js', ['--report', p, '--root', notAWorkspace]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /workspace/i);
  assert.match(fs.readFileSync(p, 'utf8'), /reported: null/, 'the note is left alone');
});

// `hosts` is a real, populated field in at least one live workspace (an
// array of relative paths) — the `Array.isArray` guard on it is load-bearing,
// not a no-op, so a present-but-wrong-typed value must say something rather
// than silently collapsing to an empty list.
test('--report exits 1 when config.json\'s "hosts" field is present but not an array', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const p = seedNote(dir, 'prompt', '2026-08-30-a.md');
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.hosts = 'not-an-array';
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  const r = runTool('feedback.js', ['--report', p, '--root', dir]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /hosts/i);
  assert.match(fs.readFileSync(p, 'utf8'), /reported: null/);
});

// MINOR (fix round 2): this config file's own idiom uses `null` for "not
// yet set" (`lastBackup: null` is the shipped example) — a future writer of
// `hosts` following that same convention must not break --report for no
// reason. `null` is treated the same as absent; only a genuinely
// wrong-typed value (a string, a number, ...) is still refused.
test('--report treats "hosts": null the same as absent, not as a wrong-typed refusal', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.hosts = null;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  const p = seedNote(dir, 'prompt', '2026-08-30-a.md');
  const preload = makeGhShim(path.join(tmpdir(t), 'gh-shim'));
  const r = runTool('feedback.js', ['--report', p, '--root', dir], {
    env: ghShimEnv(preload, { stdout: 'https://github.com/SerVian7/joserah/issues/13\n', status: 0 }),
  });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

// The other side of the same guard: when `hosts` IS a proper array, each
// entry is real forbidden vocabulary, not decoration.
test('--report scans with each "hosts" entry from config.json as forbidden vocabulary', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.hosts = ['projects/acme-corp'];
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  const p = seedNote(dir, 'prompt', '2026-08-30-a.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8')
    .replace('## Symptom\n\nThe', '## Symptom\n\nSeen under projects/acme-corp while'));
  const r = runTool('feedback.js', ['--report', p, '--root', dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /redact/i);
});

// IMPORTANT — --report never checked whether a note was already reported;
// run twice, it filed a second public issue and the `reported: null` replace
// became a no-op, so the file kept the first URL while the tool printed the
// second and exited 0. Guarded now on the same predicate --list uses.
//
// A genuine `gh` is never invoked by any test in this file (hard
// requirement: no test may create a real issue or touch the network). This
// one instead resolves a stubbed `gh` — a copy of the current Node binary,
// named gh.exe so Windows can execute it directly with no shell, with a
// --require preload (loaded via NODE_OPTIONS) that recognizes the "issue
// create" invocation by its resolved argv and prints a canned response
// before real gh-lookup or module-loading logic ever runs. Nothing here
// spawns a network-capable process or a real `gh`.
function makeGhShim(shimDir) {
  fs.mkdirSync(shimDir, { recursive: true });
  fs.copyFileSync(process.execPath, path.join(shimDir, 'gh.exe'));
  const preload = path.join(shimDir, 'preload.js');
  fs.writeFileSync(preload, [
    "'use strict';",
    "const path = require('path');",
    "const base = path.basename(process.argv[1] || '');",
    "if (base === 'issue' && process.argv.includes('create')) {",
    "  let cfg = {};",
    "  try { cfg = JSON.parse(process.env.GH_SHIM_RESULT || '{}'); } catch (e) {}",
    "  if (cfg.stdout) process.stdout.write(cfg.stdout);",
    "  if (cfg.stderr) process.stderr.write(cfg.stderr);",
    "  process.exit(typeof cfg.status === 'number' ? cfg.status : 0);",
    "}",
  ].join('\n'));
  return preload;
}

// The env this stubbed `gh` needs: PATH so the shim resolves before any real
// `gh`, NODE_OPTIONS (forward slashes — NODE_OPTIONS strips backslashes on
// Windows) to preload the interceptor, and the canned result it should hand
// back as if it were `gh`'s own stdout/stderr/exit status.
function ghShimEnv(preload, result) {
  return {
    PATH: path.dirname(preload) + path.delimiter + process.env.PATH,
    NODE_OPTIONS: '--require "' + preload.split(path.sep).join('/') + '"',
    GH_SHIM_RESULT: JSON.stringify(result),
  };
}

test('--report succeeds through a stubbed gh: URL extracted from stdout, reported: rewritten, exit 0', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const p = seedNote(dir, 'prompt', '2026-08-30-a.md');
  const preload = makeGhShim(path.join(tmpdir(t), 'gh-shim'));
  const r = runTool('feedback.js', ['--report', p, '--root', dir], {
    env: ghShimEnv(preload, { stdout: 'https://github.com/SerVian7/joserah/issues/42\n', status: 0 }),
  });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(r.stdout.trim(), 'https://github.com/SerVian7/joserah/issues/42');
  assert.match(fs.readFileSync(p, 'utf8'),
    /^reported: https:\/\/github\.com\/SerVian7\/joserah\/issues\/42$/m);
});

// Nothing exercised a CRLF note through the rewrite path before this: the
// `reported:` line is matched (and replaced) with a regex, not a hardcoded
// literal string, precisely so a note's existing line endings elsewhere are
// never touched.
test('--report preserves CRLF line endings through the stubbed-gh success path', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const p = seedNote(dir, 'prompt', '2026-08-30-a.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\n/g, '\r\n'));
  const preload = makeGhShim(path.join(tmpdir(t), 'gh-shim'));
  const r = runTool('feedback.js', ['--report', p, '--root', dir], {
    env: ghShimEnv(preload, { stdout: 'https://github.com/SerVian7/joserah/issues/99\n', status: 0 }),
  });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const updated = fs.readFileSync(p, 'utf8');
  assert.match(updated, /reported: https:\/\/github\.com\/SerVian7\/joserah\/issues\/99\r\n/);
  assert.strictEqual(/(?<!\r)\n/.test(updated), false, 'no bare LF introduced by the rewrite');
});

test('a second --report on an already-reported note is refused, not a silent second issue', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const p = seedNote(dir, 'prompt', '2026-08-30-a.md');
  const preload = makeGhShim(path.join(tmpdir(t), 'gh-shim'));
  const first = runTool('feedback.js', ['--report', p, '--root', dir], {
    env: ghShimEnv(preload, { stdout: 'https://github.com/SerVian7/joserah/issues/7\n', status: 0 }),
  });
  assert.strictEqual(first.status, 0, first.stdout + first.stderr);
  const afterFirst = fs.readFileSync(p, 'utf8');

  // PATH emptied so a second, wrongly-permitted attempt could not possibly
  // reach a real (or even stubbed) gh — proving the refusal happens before
  // any second issue could be filed, not merely that the shim wasn't asked.
  const second = runTool('feedback.js', ['--report', p, '--root', dir], { env: { PATH: '' } });
  assert.strictEqual(second.status, 1, second.stdout + second.stderr);
  assert.match(second.stderr, /already reported/i);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), afterFirst,
    'the recorded URL from the first report is untouched by the refused second attempt');
});

// Task 20: the skill that turns config.json's feedback.mode into behaviour,
// and the install skill's questions in their agreed order.

test('the feedback skill exists and states the three modes', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'feedback', 'SKILL.md'), 'utf8');
  assert.match(text, /^---\nname: feedback\n/);
  // A bare includes() proved nothing: 'auto' is a substring of "automatic",
  // 'off' of "offer", 'manual' of "manually" — so the old assertion passed on
  // prose documenting none of the three modes. Anchored instead on the bullet
  // form the mode list is actually written in, which cannot occur by accident.
  assert.match(text, /^- \*\*auto\*\* —/m, 'documents the auto mode');
  assert.match(text, /^- \*\*manual\*\* —/m, 'documents the manual mode');
  assert.match(text, /^- \*\*off\*\*/m, 'documents the off mode');
});

test('the feedback skill names no one and ships no real example', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'feedback', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(text, /Sevgi|Serkan|Akkaya|Zenger/i, 'no real people or workspaces');
});

// AMENDED 2026-08-30 (task-20-brief.md): "one person or an organisation" is
// not an install question — a company assistant can be fully encapsulated
// and a personal one can be handed the whole machine, so who the workspace
// serves is not a proxy for privilege and is never asked. Reach and the
// assistant's definition take its place in the order this test checks;
// written against the strings the amended skill text actually contains.
test('install asks its questions in the agreed order', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'install', 'SKILL.md'), 'utf8');
  const at = (s) => {
    const i = text.indexOf(s);
    assert.notStrictEqual(i, -1, 'missing: ' + s);
    return i;
  };
  // Fix round 2 (controller review of cb16d36): 'only inside this folder'
  // occurs twice — once in the reach question itself (step 3), once in step
  // 4's cross-reference back to it — so on its own it landed on the right
  // spot by luck (step 3 happens to sit before step 4), not by construction.
  // The longer phrase below is the question's own wording and appears only
  // once. Every anchor in this test is checked to occur exactly once in
  // skills/install/SKILL.md, verified with a plain occurrence count per
  // string (see task-20-report.md), so each `at(...)` can only resolve to
  // the real question it names, never to a mention of it in passing
  // elsewhere in the file.
  assert.ok(at('dialogue language') < at('owner name'), 'language before name');
  assert.ok(at('owner name') < at('act on this machine, or only inside this folder'),
    'name before reach');
  assert.ok(at('act on this machine, or only inside this folder') < at('what it is for here'),
    'reach before the assistant\'s definition');
  assert.ok(at('what it is for here') < at('Ask for consent'), 'definition before consent');
  assert.ok(at('Ask for consent') < at('Then offer feedback'), 'consent before the feedback question');
});

// --- IMPORTANT 4 -----------------------------------------------------------
// Every forbidden-word test above this line passes a SINGLE word, while
// production passes cfg.ownerName — a full name in every real workspace.
// Matched as one literal string, "Serkan Atay" fired on neither half, which
// is how this gap survived five review rounds.
test('scanForIdentifiers matches each word of a multi-word forbidden entry', () => {
  assert.ok(nf.scanForIdentifiers('telling Serkan the same thing', ['Serkan Atay']).length,
    'the first word of a two-word owner name');
  assert.ok(nf.scanForIdentifiers('the note Atay left behind', ['Serkan Atay']).length,
    'the second word of a two-word owner name');
});

// Turkish agglutination: the suffix attaches straight onto the word, so a
// whole-string match fails on every inflected form of the workspace's own
// vocabulary — on a workspace whose working language is Turkish, that is
// most occurrences of it.
test('scanForIdentifiers sees through a Turkish suffix on a forbidden word', () => {
  assert.ok(nf.scanForIdentifiers('Notlar atayda tutuluyor', ['atay']).length, 'joined -da');
  assert.ok(nf.scanForIdentifiers('Joserahin cevabi ayni oldu', ['Joserah']).length, 'joined -in');
  assert.ok(nf.scanForIdentifiers('Akkaya\u2019nın notu geldi', ['Akkaya']).length, 'curly-apostrophe suffix');
  assert.ok(nf.scanForIdentifiers("Akkaya'nın notu geldi", ['Akkaya']).length, 'straight-apostrophe suffix');
});

// The suffix allowance must not become a substring search: a compound word
// appends a whole further word, not a two- or three-letter inflection.
test('scanForIdentifiers still refuses to treat a compound as a suffixed forbidden word', () => {
  assert.strictEqual(nf.scanForIdentifiers('Atayland is a theme park', ['atay']).length, 0);
  assert.strictEqual(nf.scanForIdentifiers('the ownership model changed', ['owner']).length, 0);
});

// skills/feedback/SKILL.md promises "no file paths" and nothing enforced it.
// Only rooted paths are flagged — a repo-relative path is what structure
// feedback is FOR, and flagging one would train people around the whole scan.
test('scanForIdentifiers catches a rooted file path but leaves a repo-relative one alone', () => {
  assert.ok(nf.scanForIdentifiers('It wrote to D:\\work\\clients\\somebody\\mail.md', []).length,
    'a Windows drive path');
  assert.ok(nf.scanForIdentifiers('it read /home/somebody/notes.md instead', []).length,
    'an absolute POSIX path');
  assert.ok(nf.scanForIdentifiers('it read ~/notes/things.md instead', []).length, 'a ~-rooted path');
  assert.deepStrictEqual(nf.scanForIdentifiers('the check lives in tools/lib/note-format.js', []), [],
    'naming a file in this repo is not a leak');
});

// The same promise, for numbers. None of these has an innocent reading in a
// note whose subject is a piece of software's prompts and structure.
test('scanForIdentifiers catches numeric identifiers', () => {
  assert.ok(nf.scanForIdentifiers('It echoed 0532 415 88 21 back', []).length, 'a spaced phone number');
  assert.ok(nf.scanForIdentifiers('the id 12345678901 showed up', []).length, 'a long digit run');
  assert.ok(nf.scanForIdentifiers('it printed TR330006100519786457841326 in full', []).length, 'an IBAN');
  assert.deepStrictEqual(nf.scanForIdentifiers('on 2026-08-30 it ran twice, in v2', []), [],
    'a date and a version number are not identifiers');
});

// The path check's first anchor ("not preceded by a path character") read a
// slash CONTINUING a token as the start of an absolute path, so every command
// the plugin's own skills document — `${CLAUDE_PLUGIN_ROOT}/tools/...`,
// `<root>/notes`, `$(pwd)/x` — read as a leak. It flagged 33 lines across
// skills/, including the feedback skill's own --report invocation, and a
// `prompt` or `structure` note is ABOUT commands and paths: a scan that fires
// on the subject matter of the note type it guards gets written around.
test('scanForIdentifiers does not read a variable expansion or a placeholder as a rooted path', () => {
  // Copied verbatim from skills/feedback/SKILL.md.
  const documented = 'node "${CLAUDE_PLUGIN_ROOT}/tools/feedback.js" --report <file> --root <root>';
  assert.deepStrictEqual(nf.scanForIdentifiers(documented, []), [],
    'the skill\'s own command line must render, not throw');
  assert.doesNotThrow(() => nf.renderFeedbackNote({
    area: 'structure', created: '2026-08-30',
    symptom: 'the documented command was refused when quoted back in a note.',
    cause: 'running ' + documented + ' is what the skill itself asks for.',
    suggestion: 'anchor the path check on the start of a token.',
  }, []));
  assert.deepStrictEqual(nf.scanForIdentifiers('write it to <path>/.joserah/agent.md', []), [],
    'a placeholder root is not a rooted path');
  assert.deepStrictEqual(nf.scanForIdentifiers('run $(pwd)/tools/doctor.js', []), [],
    'a command substitution is not a rooted path');
});

// ...and the real leak shapes must all still fire after that loosening.
test('scanForIdentifiers still catches every rooted path shape after the token-start anchor', () => {
  for (const t of [
    'It wrote to D:\\work\\clients\\sevgi-akkaya\\mail.md',
    'it opened \\\\fileserver\\share\\notes.md',
    'it read ~/notes/things.md instead',
    'it read /home/somebody/notes.md instead',
    'it quoted `~/notes/things.md` back',
    'it logged (\"D:\\work\\x.md\") verbatim',
  ]) {
    assert.ok(nf.scanForIdentifiers(t, []).includes('a file path'), 'missed: ' + t);
  }
});
