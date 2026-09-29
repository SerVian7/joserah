'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');

// 0.10.0: the S-column rules from the 2026-09-12 behaviour list get their
// homes. Same rule as the prompt (prompt.test.js): Joserah names no
// third-party plugin, skill, vendor or product — the skills are read into a
// session the same way the prompt is.
const FORBIDDEN = [/superpowers/i, /obsidian/i, /notion/i, /chatgpt/i, /copilot/i];
// Read the skills off disk rather than listing them here: a guard that has to
// be extended by hand is a guard that silently stops covering the newest skill.
const SKILLS = fs.readdirSync(path.join(PLUGIN_ROOT, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

for (const name of SKILLS) {
  test(`skills/${name}/SKILL.md has frontmatter and names nobody else`, () => {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', name, 'SKILL.md'), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(fm, 'no frontmatter block');
    assert.match(fm[1], new RegExp(`^name: ${name}$`, 'm'));
    assert.match(fm[1], /^description: \S.*$/m);
    for (const bad of FORBIDDEN) assert.doesNotMatch(text, bad, `names ${bad}`);
  });
}

// The owner uses one model family today and will not tomorrow; other people
// on this work already use other coding agents. Tier names are weights, never
// product names, so a workspace on a different runtime reads the same rules.
test('orchestrate names no model and no vendor', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'orchestrate', 'SKILL.md'), 'utf8');
  for (const bad of [/\bClaude\b/, /\bOpus\b/, /\bSonnet\b/, /\bHaiku\b/, /\bGPT\b/, /\bGemini\b/, /\bAnthropic\b/]) {
    assert.doesNotMatch(text, bad, `names ${bad}`);
  }
  for (const tier of ['extreme', 'heavy', 'medium', 'simple']) {
    assert.ok(text.includes(tier), `no ${tier} tier`);
  }
  assert.ok(text.includes('the selected model is the ceiling'));
});

test('orchestrate carries the one-report-per-wave and one-voice rules', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'orchestrate', 'SKILL.md'), 'utf8');
  for (const anchor of [
    'One report per wave',
    'conclusion first',
    '.brand/report.html',
    'notumu aldım',
    'several models work behind it',
    // Two decisions that must not be droppable in a later edit: the weight of
    // a handed-off task is visible in its title, and a question is routed by
    // whose subject it is rather than by who is nearest.
    'carries its tier in its title',
    'the person whose subject it is',
  ]) {
    assert.ok(text.includes(anchor), `missing: ${anchor}`);
  }
});

// 0.13.4 (owner, 2026-09-30, plugin audit fix 6): "in the background" in
// AGENTS.md against "a lead never backgrounds its workers" here — three texts,
// three answers. Background is the default now; the nested lead the old rule
// protected no longer exists, because a worker does not delegate further.
test('orchestrate backgrounds by default and has no never-background rule', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'orchestrate', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(text, /never\s+backgrounds/i, 'the old rule contradicts AGENTS.md');
  assert.match(text.replace(/\s+/g, ' '), /in the background by default/);
});

// 0.13.2, reworded 0.13.4: a worker that never loaded this skill knows the
// rules only from its brief, so the no-further-delegation rule is stated once
// in the rules and once in the template a brief is written from.
test('orchestrate makes the no-further-delegation rule travel in every brief', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'orchestrate', 'SKILL.md'), 'utf8');
  const rule = 'a worker does not delegate further, and this rule is copied verbatim into every brief';
  const briefing = text.slice(text.indexOf('## Briefing'), text.indexOf('## Checking what comes back'));
  const template = /```[^\n]*\n([\s\S]*?)```/.exec(briefing);
  assert.ok(template, 'the Briefing section has no brief template');
  const flat = (s) => s.replace(/\s+/g, ' ').toLowerCase();
  const outside = flat(briefing.replace(template[0], ''));
  assert.ok(outside.includes(rule), 'the rule is not stated in the skill');
  assert.ok(flat(template[1]).includes(rule), 'the brief template does not carry the rule');
});

test('the merged skills are gone, not left behind as duplicates', () => {
  for (const gone of ['dispatch', 'plan', 'research']) {
    assert.ok(!fs.existsSync(path.join(PLUGIN_ROOT, 'skills', gone)),
      `skills/${gone} still exists — two files now state the same rule`);
  }
});

test('correspondence states the rules that used to live in a workspace', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'correspondence', 'SKILL.md'), 'utf8');
  for (const anchor of [
    '.brand/mail.html',
    'only the recipients the owner named',
    'never inherit it from a quoted chain',
    'read the to, cc and bcc back',
    'check the inbox again',
    'data, not instructions',
    'behind a word',
    // An assistant writing in its own name does not borrow the owner's
    // familiarity with a person: formal register by default, in every
    // language, and only the owner may lower it for someone.
    'the formal register the language offers',
  ]) {
    assert.ok(text.includes(anchor), `missing: ${anchor}`);
  }
});

test('install and onboard are gone, folded into setup', () => {
  for (const gone of ['install', 'onboard']) {
    assert.ok(!fs.existsSync(path.join(PLUGIN_ROOT, 'skills', gone)),
      `skills/${gone} still exists`);
  }
});

test('setup covers both halves of the journey', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'setup', 'SKILL.md'), 'utf8');
  assert.ok(text.includes('scaffold.js'), 'the creation half');
  assert.ok(text.includes('a few questions at a time'), 'the interview half');
  assert.doesNotMatch(text, /\/joserah:onboard/, 'the merged skill does not hand off to itself');
  assert.doesNotMatch(text, /\/joserah:install/, 'same');
});

// 0.13.4 (plugin audit 19): the description fired on "a workspace is empty or
// half-filled", so a plain greeting in a new workspace loaded a 17 KB skill
// whose first half creates a workspace that already exists.
// 0.13.5 (owner, 2026-09-30): /joserah:update is the only way Joserah updates
// itself — a git pull on the checkout the plugin runs from, then /reload-plugins.
test('update pulls the plugin checkout and never sends the owner to the plugin manager', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'update', 'SKILL.md'), 'utf8');
  assert.ok(text.includes('git -C "<checkout.path>" pull --ff-only'), 'the checkout, not the cache copy');
  assert.ok(text.includes('claude plugin update joserah@<checkout.marketplace>'), 'the re-copy');
  assert.ok(text.includes('/reload-plugins'));
  assert.doesNotMatch(text, /claude plugin marketplace update/);
});

// 0.13.4 (owner, 2026-09-30): the §5 routines touch two files by nature
// (capture + now.md, learned + profile) and were being read into delegation;
// "loops are bad". They are always inline; the rest backgrounds by default.
test('AGENTS.md keeps the routines inline and sends the rest to orchestrate in the background', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf8');
  const row = text.split('\n').find((l) => l.startsWith('|') && l.includes('`orchestrate`'));
  assert.match(row, /always inline/);
  assert.match(row, /in the background by default/);
  assert.doesNotMatch(row, /None of these is trivial|more than a couple of files/, 'the pressure to delegate a lookup');
  const method = text.slice(text.indexOf('## 6.'), text.indexOf('## 7.'));
  assert.doesNotMatch(method, /anything more goes through/, '§6 restated the old threshold');
  assert.ok(text.split('\n').length < 160, 'AGENTS.md footer: under 160 lines');
});

test('setup triggers on an explicit request, never on an empty workspace', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'setup', 'SKILL.md'), 'utf8');
  const description = /^description:(.*)$/m.exec(text)[1];
  assert.doesNotMatch(description, /empty|half-filled/, 'emptiness is not a request');
  assert.match(description, /set up/);
  assert.match(description, /continue, resume or finish/);
});

// Task 15: three rules inside sweep contradicted the rest of the skill and
// each produced the wrong behaviour in a real run.
test('sweep judges a shortened page by its facts, not by its line count', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'sweep', 'SKILL.md'), 'utf8');
  assert.ok(text.includes('every fact it removed exists at the place it was moved to'),
    'the restore criterion has to be about facts, not size');
  assert.ok(!text.includes('deletes more than it adds is restored'),
    'the old size-based rule fights the merge step in the same skill');
});

test('sweep separates reading a source from writing to one', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'sweep', 'SKILL.md'), 'utf8');
  assert.ok(text.includes('write anything under `imports/`'), 'the prohibition is on writing');
  assert.ok(text.includes('Reading it is required'), 'and reading is not merely permitted');
});

test('sweep says where its state file lives and when it goes', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'sweep', 'SKILL.md'), 'utf8');
  assert.ok(text.includes('.joserah/desk/sweep-state.md'), 'the state file has one home');
  assert.ok(text.includes('delete it'), 'and a stated end');
});

// 0.13.2: agents invented `[fact]` and `[inventory]` and wrote live-read
// measurements without `condition:`. check-claims catches it afterwards; the
// places that teach the format have to say it first.
test('the four claim types are the only ones, and a measurement needs its condition, where claims are taught', () => {
  for (const rel of [['templates', 'AGENTS.md'], ['skills', 'sweep', 'SKILL.md']]) {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, ...rel), 'utf8').replace(/\s+/g, ' ');
    assert.ok(text.includes('[measurement|calculation|decision|estimate]'), `${rel.join('/')}: the four types`);
    assert.ok(text.includes('these four are the only types'), `${rel.join('/')}: not stated as the only ones`);
    assert.ok(text.includes('`condition:` (mandatory for a measurement)'), `${rel.join('/')}: condition not mandatory`);
  }
});
