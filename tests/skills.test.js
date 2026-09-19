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

// 0.13.1: a worker's completion notice reaches the top session, not the lead
// that opened it, so a lead that backgrounds its workers polls or never learns
// they finished. Anchored on the meaning, not the exact sentence.
test('orchestrate says a lead waits on its workers and never backgrounds them', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'orchestrate', 'SKILL.md'), 'utf8');
  assert.match(text, /lead\s+waits\s+on\s+its\s+workers/i, 'no rule that a lead waits on its workers');
  assert.match(text, /never\s+(?:runs?\s+(?:them|its\s+workers)\s+in\s+the\s+background|backgrounds)/i,
    'no rule that a lead does not background its workers');
  assert.match(text, /completion\s+does\s+not\s+reach/i, 'the reason is missing');
});

// 0.13.2: a worker that never loaded this skill backgrounded its own workers,
// and their completion went to the top session. The rule has to travel in the
// brief itself, so it is stated once in the rules and once in the template a
// brief is written from.
test('orchestrate makes the never-background rule travel in every brief', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'orchestrate', 'SKILL.md'), 'utf8');
  const rule = 'a lead never backgrounds its workers, and copies this rule verbatim into every brief it writes';
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
