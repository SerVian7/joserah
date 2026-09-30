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
const MEMORY_TOOLS = {
  'tools/verify-links.js': 'tools/verify-links.js',
  'tools/lib/untouchable.js': 'tools/lib/untouchable.js',
  'tools/claims.js': 'tools/check-claims.js',
  'tools/lib/workspace-scan.js': 'tools/lib/workspace-scan.js',
  'tools/lib/note-format.js': 'tools/lib/note-format.js',
  'tools/sync.js': 'templates/memory/tools/sync.js',
  'tools/sweep-due.js': 'templates/memory/tools/sweep-due.js',
  'tools/detect-member.js': 'templates/memory/tools/detect-member.js',
};
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

/** scaffold.js --kind memory. Returns { root, files, registered }. */
function scaffoldMemory({ target, company, members, sweeper, language }) {
  if (!target) fail('--kind memory needs --target DIR');
  if (!company) fail('--kind memory needs --company NAME');
  const list = String(members || '').split(',').map(memberSlug).filter(Boolean);
  if (!list.length) fail('--kind memory needs --members a,b,...');
  const sw = memberSlug(sweeper);
  if (!list.includes(sw)) fail(`--sweeper must be one of the members (${list.join(', ')})`);
  const root = path.resolve(target);
  if (fs.existsSync(root) && fs.readdirSync(root).length) fail(`${root} is not empty — nothing was written`);

  const subs = { '{{COMPANY}}': company, '{{MEMBERS}}': list.join(', '), '{{SWEEPER}}': sw,
    '{{LANGUAGE}}': language || 'the language the members write in' };
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
  for (const [rel, src] of Object.entries(MEMORY_TOOLS)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(PLUGIN_ROOT, src), path.join(root, rel));
  }
  fs.mkdirSync(path.join(root, '.memory'), { recursive: true });
  fs.writeFileSync(path.join(root, '.memory', 'config.json'), JSON.stringify({
    kind: 'memory', company, language: language || null, members: list, sweeper: sw, lastSweep: null,
    created: new Date().toISOString().slice(0, 10),
  }, null, 2) + '\n', 'utf8');

  git(root, 'init', '-q');
  git(root, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(root, 'add', '-A');
  // The owner's own identity when git has one; otherwise the sweeper's name, never an invented email.
  const who = git(root, 'var', 'GIT_COMMITTER_IDENT').status === 0 ? [] : ['-c', `user.name=${sw}`, '-c', `user.email=${sw}@memory.invalid`];
  const c = spawnSync('git', ['-C', root, ...who, 'commit', '-q', '-m', `${sw}: scaffold ${company} memory`], { encoding: 'utf8' });
  if (c.status !== 0) fail(`git commit failed — ${(c.stderr || c.stdout).trim()}`);

  const ws = hostWorkspace(root);
  if (ws) registerShared(ws, path.basename(root));
  return { root, files: files + Object.keys(MEMORY_TOOLS).length + 1, registered: !!ws };
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
    out.push(check(`memory tool current: ${rel}`, same, same ? '' : `differs from the plugin's ${src} — copy it over`));
  }
  const gi = fs.existsSync(path.join(root, '.gitignore')) ? eol(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).split('\n') : [];
  out.push(check('.gitignore keeps .memory/me on this machine', gi.includes('.memory/me'), ''));
  const links = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'tools', 'verify-links.js'), root], { encoding: 'utf8' });
  out.push(check('internal links resolve', links.status === 0, (links.stdout || '').trim().split('\n')[0]));
  const claims = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'tools', 'check-claims.js'), root], { encoding: 'utf8' });
  out.push(check('typed claims consistent', claims.status === 0, (claims.stdout || '').trim().split('\n').pop()));

  const { sweepState } = require(path.join(TEMPLATE, 'tools', 'sweep-due.js'));
  const s = sweepState(root);
  if (s.inbox && (s.days === null || s.days > SWEEP_OVERDUE_DAYS)) {
    out.push(warn('memory sweep', `${s.days === null ? 'never swept' : `${s.days} days since last sweep`}, ${s.inbox} inbox file(s) — ${cfg.sweeper} runs the sweep`));
  }
  // Who wrote outside their own folder: a commit's subject names its member
  // ("<member>: ..."); only the sweeper's may touch anything else.
  const log = git(root, 'log', '-n', '500', '--format=%x00%s', '--name-only');
  const stray = [];
  if (log.status === 0) {
    for (const entry of log.stdout.split('\0').slice(1)) {
      const [subject, ...names] = entry.split('\n');
      const member = (/^([a-z0-9-]+):/.exec(subject) || [])[1];
      if (member === cfg.sweeper) continue;
      for (const f of names.filter(Boolean)) {
        if (!(member && f.startsWith(`members/${member}/`)) && !f.startsWith('inbox/')) stray.push(`${member || '?'}: ${f}`);
      }
    }
  }
  if (stray.length) out.push(warn('members write only their own folder and inbox/', [...new Set(stray)].slice(0, 5).join(', ')));
  return out;
}

/** Doctor's line per shared memory a workspace names. */
function sharedChecks(root, cfg) {
  const list = (cfg && Array.isArray(cfg.shared)) ? cfg.shared : [];
  if (!list.length) return [];
  const out = list.map((m) => {
    const abs = path.resolve(root, m.path || '');
    if (!isMemory(abs)) return warn(`shared memory ${m.name}`, `no memory at ${m.path} — clone it again with scaffold.js --join-memory <url>, or remove the entry`);
    const bad = memoryChecks(abs).filter((c) => !c.ok);
    return bad.length ? warn(`shared memory ${m.name}`, `${bad.length} check(s) fail there — run doctor on ${m.path}`) : check(`shared memory ${m.name}`, true, m.path);
  });
  const gi = fs.existsSync(path.join(root, '.gitignore')) ? eol(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).split('\n') : [];
  if (!gi.includes(SHARED_IGNORE)) out.push(warn('.gitignore keeps shared memories out', `add the line ${SHARED_IGNORE}`));
  return out;
}

module.exports = { MEMORY_TOOLS, SHARED_DIR, SHARED_IGNORE, isMemory, registerShared, scaffoldMemory, joinMemory,
  memoryChecks, sharedChecks };
