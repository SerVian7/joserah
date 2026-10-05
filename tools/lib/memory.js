'use strict';
/**
 * memory.js — the Joserah Memory kind (0.14.0): a git repository holding a
 * company's shared memory, and nothing else. A member's workspace carries its
 * clone at .joserah/shared/<name>/, named in config.json under `shared`.
 *
 * One place for the three things that must agree: what a memory is made of
 * (the template tree plus the plugin tools it carries), how a workspace names
 * one, and what doctor checks in one.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE = path.join(PLUGIN_ROOT, 'templates', 'memory');

// Every tool a memory carries → its source in the plugin. Doctor compares each.
// 0.15.3: the memory's tools stand alone (Node built-ins, nothing outside tools/),
// so all of them live in templates/memory/tools and the template walk copies them.
const TOOLS_DIR = path.join(TEMPLATE, 'tools');
const MEMORY_TOOLS = Object.fromEntries(['', 'lib/'].flatMap((sub) => fs.readdirSync(path.join(TOOLS_DIR, sub)).filter((f) => f.endsWith('.js'))
  .map((f) => ['tools/' + sub + f, 'templates/memory/tools/' + sub + f])));
const LAYOUT = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'members', 'inbox', 'knowledge/index.md',
  'desk/tasks/now.md', '.brand/README.md'];
const SHARED_DIR = '.joserah/shared';
const SHARED_IGNORE = '.joserah/shared/*';
const SWEEP_OVERDUE_DAYS = 14;

const { memberSlug } = require(path.join(TEMPLATE, 'tools', 'detect-member.js'));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
const eol = (s) => s.replace(/\r\n/g, '\n');

function isMemory(dir) {
  try { return readJson(path.join(dir, '.memory', 'config.json')).kind === 'memory'; } catch { return false; }
}

/** Name a memory in a workspace's config and keep its clone out of the workspace's own repo. */
function registerShared(ws, name) {
  const cfgPath = path.join(ws, '.joserah', 'config.json');
  const cfg = readJson(cfgPath);
  cfg.shared = [...(cfg.shared || []).filter((m) => m.name !== name), { name, path: `${SHARED_DIR}/${name}` }];
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  const gi = path.join(ws, '.gitignore');
  const text = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (!eol(text).split('\n').includes(SHARED_IGNORE)) {
    fs.writeFileSync(gi, `${text}${text && !text.endsWith('\n') ? '\n' : ''}` +
      `# Shared memories: each one is its own git repository\n${SHARED_IGNORE}\n`, 'utf8');
  }
}

/** The workspace a memory at <ws>/.joserah/shared/<name> belongs to, or null. */
function hostWorkspace(dir) {
  const shared = path.dirname(dir);
  if (path.basename(shared) !== 'shared' || path.basename(path.dirname(shared)) !== '.joserah') return null;
  const ws = path.dirname(path.dirname(shared));
  return fs.existsSync(path.join(ws, '.joserah', 'config.json')) ? ws : null;
}

function fail(msg) { const e = new Error(msg); e.userError = true; throw e; }

function substitutions({ company, members, sweeper, language }) {
  return { '{{COMPANY}}': company, '{{MEMBERS}}': members.join(', '), '{{SWEEPER}}': sweeper,
    '{{LANGUAGE}}': language || 'the language the members write in' };
}
function render(rel, cfg) {
  let text = fs.readFileSync(path.join(TEMPLATE, rel), 'utf8');
  for (const [k, v] of Object.entries(substitutions(cfg))) text = text.split(k).join(v);
  return text;
}
const refreshCmd = (dir) => 'node "${CLAUDE_PLUGIN_ROOT}/tools/scaffold.js" --refresh-memory ' + dir;

/**
 * scaffold.js --refresh-memory <dir>: bring an existing memory's AGENTS.md and tools/*.js
 * up to this plugin's templates, with the memory's own values. Writes only what differs;
 * never touches knowledge/, members/, inbox/, questions/, .memory/, .brand/.
 * Returns the changed files, relative to the memory.
 */
function refreshMemory(dir) {
  const root = path.resolve(dir);
  if (!isMemory(root)) fail(root + ' is not a Joserah Memory (no .memory/config.json of kind "memory")');
  const cfg = readJson(path.join(root, '.memory', 'config.json'));
  // exp/shared-assistant: RECORDING.md (continuous recording) travels with AGENTS.md.
  const wanted = { 'AGENTS.md': render('AGENTS.md', cfg), 'RECORDING.md': render('RECORDING.md', cfg) };
  for (const [rel, src] of Object.entries(MEMORY_TOOLS)) wanted[rel] = fs.readFileSync(path.join(PLUGIN_ROOT, src), 'utf8');
  const changed = [];
  for (const [rel, text] of Object.entries(wanted)) {
    const dst = path.join(root, rel);
    let cur = null;
    try { cur = fs.readFileSync(dst, 'utf8'); } catch { /* missing: written below */ }
    if (cur !== null && eol(cur) === eol(text)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, text, 'utf8');
    changed.push(rel);
  }
  // .gitignore: append template lines the memory lacks; never remove or reorder its own.
  const giPath = path.join(root, '.gitignore');
  const giCur = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
  const have = new Set(eol(giCur).split('\n'));
  const add = eol(fs.readFileSync(path.join(TEMPLATE, '.gitignore'), 'utf8')).split('\n').filter((l) => l && !have.has(l));
  if (add.length) {
    fs.writeFileSync(giPath, giCur + (giCur && !giCur.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n', 'utf8');
    changed.push('.gitignore');
  }
  return changed;
}

/** scaffold.js --kind memory. Returns { root, files, registered }. */
function scaffoldMemory({ target, company, members, sweeper, language, recording }) {
  if (recording !== undefined && !['sweep', 'continuous'].includes(recording)) fail('--recording is sweep or continuous');
  if (!target) fail('--kind memory needs --target DIR');
  if (!company) fail('--kind memory needs --company NAME');
  const list = String(members || '').split(',').map(memberSlug).filter(Boolean);
  if (!list.length) fail('--kind memory needs --members a,b,...');
  const sw = memberSlug(sweeper);
  if (!list.includes(sw)) fail(`--sweeper must be one of the members (${list.join(', ')})`);
  const root = path.resolve(target);
  if (fs.existsSync(root) && fs.readdirSync(root).length) fail(`${root} is not empty — nothing was written`);

  const subs = substitutions({ company, members: list, sweeper: sw, language });
  let files = 0;
  (function copy(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, e.name), dst = path.join(to, e.name);
      if (e.isDirectory()) { copy(src, dst); continue; }
      let text = fs.readFileSync(src, 'utf8');
      if (e.name.endsWith('.md')) for (const [k, v] of Object.entries(subs)) text = text.split(k).join(v);
      fs.writeFileSync(dst, text, 'utf8');
      files++;
    }
  })(TEMPLATE, root);
  fs.mkdirSync(path.join(root, '.memory'), { recursive: true });
  fs.writeFileSync(path.join(root, '.memory', 'config.json'), JSON.stringify({
    kind: 'memory', company, language: language || null, members: list, sweeper: sw, lastSweep: null,
    created: new Date().toISOString().slice(0, 10),
  }, null, 2) + '\n', 'utf8');

  // exp/shared-assistant: --recording continuous switches the new memory on before its first commit.
  if (recording === 'continuous') require(path.join(root, 'tools', 'ingest.js')).init(root, sw);

  git(root, 'init', '-q');
  git(root, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(root, 'add', '-A');
  // The owner's own identity when git has one; otherwise the sweeper's name, never an invented email.
  const who = git(root, 'var', 'GIT_COMMITTER_IDENT').status === 0 ? [] : ['-c', `user.name=${sw}`, '-c', `user.email=${sw}@memory.invalid`];
  const c = spawnSync('git', ['-C', root, ...who, 'commit', '-q', '-m', `${sw}: scaffold ${company} memory`], { encoding: 'utf8' });
  if (c.status !== 0) fail(`git commit failed — ${(c.stderr || c.stdout).trim()}`);

  const ws = hostWorkspace(root);
  if (ws) registerShared(ws, path.basename(root));
  return { root, files: files + 1, registered: !!ws };
}

/** scaffold.js --join-memory <url> --target <workspace>. Returns { name, path }. */
function joinMemory({ url, target }) {
  const ws = path.resolve(target || '.');
  if (!fs.existsSync(path.join(ws, '.joserah', 'config.json'))) fail(`${ws} is not a Joserah workspace`);
  const name = path.basename(String(url || '').replace(/[\\/]+$/, '')).replace(/\.git$/, '');
  if (!/^[A-Za-z0-9._-]+$/.test(name)) fail(`cannot take a folder name from "${url}"`);
  const dest = path.join(ws, '.joserah', 'shared', name);
  if (fs.existsSync(dest)) fail(`${SHARED_DIR}/${name} already exists — nothing was changed`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const r = spawnSync('git', ['clone', '-q', url, dest], { encoding: 'utf8' });
  if (r.status !== 0) { fs.rmSync(dest, { recursive: true, force: true }); fail(`clone failed — ${(r.stderr || '').trim()}`); }
  if (!isMemory(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
    fail(`${url} is not a Joserah Memory (no .memory/config.json of kind "memory") — nothing was kept`);
  }
  registerShared(ws, name);
  return { name, path: `${SHARED_DIR}/${name}` };
}

// ---- doctor ---------------------------------------------------------------------

function check(name, ok, detail) { return { name, ok, detail: detail || '' }; }
function warn(name, detail) { return { name, ok: true, warn: true, detail: detail || '' }; }

/** Doctor's checks for a memory repository itself. */
function memoryChecks(root) {
  const out = [];
  let cfg = null;
  try { cfg = readJson(path.join(root, '.memory', 'config.json')); } catch { /* reported below */ }
  const cfgOk = !!cfg && cfg.kind === 'memory' && Array.isArray(cfg.members) && cfg.members.includes(cfg.sweeper);
  out.push(check('memory config readable', cfgOk, cfgOk ? `${cfg.company}: ${cfg.members.join(', ')}; sweeper ${cfg.sweeper}` : 'kind, members and a sweeper among them'));
  if (!cfgOk) return out;
  for (const rel of LAYOUT) out.push(check(`exists: ${rel}`, fs.existsSync(path.join(root, rel)), ''));
  for (const [rel, src] of Object.entries(MEMORY_TOOLS)) {
    let same = false;
    try { same = eol(fs.readFileSync(path.join(root, rel), 'utf8')) === eol(fs.readFileSync(path.join(PLUGIN_ROOT, src), 'utf8')); } catch { /* missing */ }
    out.push(check(`memory tool current: ${rel}`, same, same ? '' : `differs from the plugin's ${src} — ${refreshCmd(root)}`));
  }
  let agentsSame = false;
  try { agentsSame = eol(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')) === eol(render('AGENTS.md', cfg)); } catch { /* missing: reported by the exists check */ }
  if (!agentsSame) out.push(warn('memory AGENTS.md current', 'differs from the template — ' + refreshCmd(root)));
  const gi = fs.existsSync(path.join(root, '.gitignore')) ? eol(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).split('\n') : [];
  out.push(check('.gitignore keeps .memory/me on this machine', gi.includes('.memory/me'), ''));
  const links = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'tools', 'verify-links.js'), root, '--exclude', 'knowledge/sources'], { encoding: 'utf8' });
  out.push(check('internal links resolve', links.status === 0, (links.stdout || '').trim().split('\n')[0]));
  const claims = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'tools', 'check-claims.js'), root, '--exclude', 'knowledge/sources'], { encoding: 'utf8' });
  out.push(check('typed claims consistent', claims.status === 0, (claims.stdout || '').trim().split('\n').pop()));

  const { sweepState } = require(path.join(TEMPLATE, 'tools', 'sweep-due.js'));
  const s = sweepState(root);
  if (s.inbox && (s.days === null || s.days > SWEEP_OVERDUE_DAYS)) {
    out.push(warn('memory sweep', `${s.days === null ? 'never swept' : `${s.days} days since last sweep`}, ${s.inbox} inbox file(s) — ${cfg.sweeper} runs the sweep`));
  }
  // Who wrote outside their own folder: a commit's subject names its member
  // ("<member>: ..."); only the sweeper's may touch anything else.
  const log = git(root, 'log', '-n', '500', '--format=%x00%s', '--name-status');
  const stray = [];
  if (log.status === 0) {
    for (const entry of log.stdout.split('\0').slice(1)) {
      const [subject, ...names] = entry.split('\n');
      const member = (/^([a-z0-9-]+):/.exec(subject) || [])[1];
      if (member === cfg.sweeper) continue;
      // exp/shared-assistant, continuous recording: a member writes knowledge/ by ingest, and that commit
      // carries a log entry; the generated index may move on its own.
      const logged = cfg.recording === 'continuous' && names.some((l) => l.split('\t')[1] === 'knowledge/log.md');
      for (const line of names.filter(Boolean)) {
        const [st, f] = line.split('\t');
        if (cfg.recording === 'continuous' && (f === 'knowledge/index.md' || (logged && f.startsWith('knowledge/')))) continue;
        // questions/<date>-<from>-<to>-<slug>.md: the asker adds or deletes, only the addressee modifies.
        const qm = /^questions\/\d{4}-\d{2}-\d{2}-(.+)\.md$/.exec(f);
        const pair = qm && cfg.members.flatMap((a) => cfg.members.map((b) => [a, b])).find(([a, b]) => qm[1].startsWith(`${a}-${b}-`));
        if (pair && (member === pair[1] || (member === pair[0] && st !== 'M'))) continue;
        if (pair) { stray.push(`${member || '?'} edited a question for ${pair[1]}: ${f}`); continue; }
        if (!(member && f.startsWith(`members/${member}/`)) && !f.startsWith('inbox/') && f !== 'questions/.gitkeep') stray.push(`${member || '?'}: ${f}`);
      }
    }
  }
  if (stray.length) out.push(warn('members write only their own folder and inbox/', [...new Set(stray)].slice(0, 5).join(', ')));
  return out;
}

// 0.15.8: a project's page in a memory against its repo's HEAD. The workspace's own
// checkouts (projects/<x>/ or projects/<company>/<x>/, real repos only) are mapped into
// the memory's .memory/repos.json, written only when it changes and kept out of its
// commits; the memory's project-drift line is then reported.
const { normaliseRepo, driftLine } = require(path.join(TEMPLATE, 'tools', 'project-drift.js'));
function projectCheckouts(ws) {
  const out = {};
  (function visit(dir, depth) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.filter((x) => x.isDirectory() && !x.name.startsWith('.'))) {
      const p = path.join(dir, e.name);
      if (!fs.existsSync(path.join(p, '.git'))) { if (depth < 2) visit(p, depth + 1); continue; }
      const url = git(p, 'remote', 'get-url', 'origin');
      if (url.status === 0) out[normaliseRepo(url.stdout)] = p.split(path.sep).join('/');
    }
  })(path.join(ws, 'projects'), 1);
  return out;
}
function projectDrift(ws, mem, name) {
  const file = path.join(mem, '.memory', 'repos.json');
  let cur = {};
  try { cur = readJson(file); } catch { /* none yet */ }
  const next = { ...cur, ...projectCheckouts(ws) };
  if (JSON.stringify(next) !== JSON.stringify(cur)) {
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
    // A memory cloned before its .gitignore named the file keeps it out through info/exclude.
    if (git(mem, 'check-ignore', '-q', '.memory/repos.json').status !== 0) {
      const ex = path.resolve(mem, git(mem, 'rev-parse', '--git-path', 'info/exclude').stdout.trim());
      fs.mkdirSync(path.dirname(ex), { recursive: true });
      fs.appendFileSync(ex, '\n.memory/repos.json\n');
    }
  }
  const line = driftLine(mem);
  if (!line || /no local checkouts/.test(line)) return [];
  return [/all current/.test(line) ? check(`project pages in ${name}`, true, line) : warn(`project pages in ${name}`, line)];
}

/** Doctor's line per shared memory a workspace names. */
function sharedChecks(root, cfg) {
  const list = (cfg && Array.isArray(cfg.shared)) ? cfg.shared : [];
  if (!list.length) return [];
  const out = list.map((m) => {
    const abs = path.resolve(root, m.path || '');
    if (!isMemory(abs)) return warn(`shared memory ${m.name}`, `no memory at ${m.path} — clone it again with scaffold.js --join-memory <url>, or remove the entry`);
    const bad = memoryChecks(abs).filter((c) => !c.ok);
    if (bad.length) return warn(`shared memory ${m.name}`, `${bad.length} check(s) fail there — run doctor on ${m.path}`);
    return [check(`shared memory ${m.name}`, true, m.path), ...projectDrift(root, abs, m.name)];
  }).flat();
  const gi = fs.existsSync(path.join(root, '.gitignore')) ? eol(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).split('\n') : [];
  if (!gi.includes(SHARED_IGNORE)) out.push(warn('.gitignore keeps shared memories out', `add the line ${SHARED_IGNORE}`));
  return out;
}

module.exports = { MEMORY_TOOLS, SHARED_DIR, SHARED_IGNORE, isMemory, registerShared, scaffoldMemory, joinMemory, refreshMemory,
  memoryChecks, sharedChecks };
