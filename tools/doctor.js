#!/usr/bin/env node
/** Health check for a Joserah workspace. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { findWorkspace, readConfig } = require('../hooks/lib/workspace');
const { PERMISSION_DENY } = require('./lib/permission-deny');

const root = findWorkspace(process.argv[2] || process.cwd());
const checks = [];
function check(name, ok, detail) { checks.push({ name, ok, detail: detail || '' }); }

if (!root) {
  console.log('FAIL  not inside a Joserah workspace (no .joserah/config.json found)');
  process.exit(1);
}

const cfg = readConfig(root);
check('workspace marker readable', !!cfg, root);
check('node version >= 18', Number(process.versions.node.split('.')[0]) >= 18, process.version);

for (const f of ['AGENTS.md', 'CLAUDE.md', '.joserah/desk/tasks/now.md', '.joserah/learned.md',
                 '.joserah/desk/inbox/captures.md', '.joserah/personal/profile.md', 'keys/AGENTS.md']) {
  check(`exists: ${f}`, fs.existsSync(path.join(root, f)));
}

// `.claude/` is not ours — Claude Code creates it on its own, and it must not
// be mandatory (owner: ".claude bu klasör otomatik oluşuyor ... zorunlu da
// olmamalı"). Its absence is fine; it only fails when the file is present
// and does not look like the deny rules scaffold.js writes.
{
  const settingsPath = path.join(root, '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    check('.claude/settings.json (optional)', true, 'absent — fine, .claude/ is not required');
  } else {
    let ok = false, detail = 'present but invalid';
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const deny = (parsed.permissions && parsed.permissions.deny) || [];
      const missing = PERMISSION_DENY.filter((r) => !deny.includes(r));
      ok = missing.length === 0;
      detail = ok ? 'present with the full deny set'
                 : `present but missing ${missing.length} deny rule(s): ${missing.join(', ')}`;
    } catch (err) {
      detail = `present but not valid JSON: ${err.message}`;
    }
    check('.claude/settings.json (present)', ok, detail);
  }
}

// I14: .joserah/keys was the pre-0.3.0 credentials location. Unlike the
// archive and link-check tools — which merely exclude it forever — doctor
// must fail here: this is the migration signal that tells an owner to move
// their credentials to keys/ at the workspace root.
check('no legacy .joserah/keys directory',
  !fs.existsSync(path.join(root, '.joserah', 'keys')),
  'legacy layout — credentials moved to keys/ in 0.3.0; see the doctor skill\'s Migrate section');

// Informational only: a workspace merely created by an older plugin version
// is not itself unhealthy. The behavioral drift that version could cause is
// caught by the two checks around this one (legacy keys dir, verify-links.js
// drift), not by this one.
const pluginVersion = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
check('workspace/plugin version', true,
  `workspace created by ${cfg && cfg.createdByPluginVersion || 'unknown'}, plugin is ${pluginVersion}`);

// G1/K4-mech: the workspace's own copy of verify-links.js is written once at
// scaffold time and never updated by anything after that. If it has drifted
// from the plugin's copy, it can silently stop checking what it claims to —
// which is exactly what happened before this check existed. This is name-
// based directory matching (see the placeholder walk below), not a
// substitute for the legacy-keys check above.
{
  const localPath = path.join(root, '.joserah', 'tools', 'verify-links.js');
  const canonical = fs.readFileSync(path.join(__dirname, 'verify-links.js'), 'utf8');
  let ok = false, detail;
  if (!fs.existsSync(localPath)) detail = 'missing — copy it from the plugin: tools/verify-links.js';
  else if (fs.readFileSync(localPath, 'utf8') !== canonical) detail = 'stale — differs from the plugin copy; re-copy it';
  else { ok = true; detail = 'matches the plugin copy'; }
  check('local verify-links.js current', ok, detail);
}

const leftover = spawnSync('node', ['-e', `
  const fs=require('fs'),path=require('path');let hits=0;
  (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
    if(e.isDirectory()){if(!['.git','node_modules','projects','docker-stack','keys','.venv','.superpowers'].includes(e.name))walk(path.join(d,e.name));}
    else if(e.name.endsWith('.md')&&/{{[A-Z_]+}}/.test(fs.readFileSync(path.join(d,e.name),'utf8')))hits++;}})(process.argv[1]);
  console.log(hits);`, root], { encoding: 'utf8' });
check('no unfilled {{placeholders}}', leftover.stdout.trim() === '0', `${leftover.stdout.trim()} file(s)`);

// M3/K4-mech: run the plugin's own copy, never the workspace's — a stale or
// missing workspace copy must never blind this check or get blamed for
// broken links it never looked for.
const links = spawnSync('node', [path.join(__dirname, 'verify-links.js'), root], { encoding: 'utf8' });
check('internal links resolve', links.status === 0, (links.stdout || '').trim().split('\n')[0]);

// G3/I12: the plugin's hooks are declared with shell:"bash". On Windows that
// silently never fires without Git for Windows on PATH — the single most
// common Windows failure mode, and nothing else in this tool would ever
// surface it.
if (process.platform === 'win32') {
  const bash = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  check('bash available for hooks', bash.status === 0,
    bash.status === 0 ? (bash.stdout.split('\n')[0] || '').trim()
      : 'not found — the plugin\'s hooks are declared with shell:"bash" and will NEVER fire; install Git for Windows');
}

let failed = 0;
for (const c of checks) {
  if (!c.ok) failed++;
  console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
}
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
