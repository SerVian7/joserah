#!/usr/bin/env node
/** Health check for a Joserah workspace. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { findWorkspace, readConfig } = require('../hooks/lib/workspace');

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
                 '.joserah/desk/inbox/captures.md', '.joserah/personal/profile.md']) {
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
      ok = Array.isArray(deny) && deny.some((r) => typeof r === 'string' && r.includes('.joserah/keys'));
      detail = ok ? 'present and covers .joserah/keys/**' : 'present but missing a .joserah/keys/** deny rule';
    } catch (err) {
      detail = `present but not valid JSON: ${err.message}`;
    }
    check('.claude/settings.json (present)', ok, detail);
  }
}

const leftover = spawnSync('node', ['-e', `
  const fs=require('fs'),path=require('path');let hits=0;
  (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
    if(e.isDirectory()){if(!['.git','node_modules','projects','docker-stack','keys','.venv'].includes(e.name))walk(path.join(d,e.name));}
    else if(e.name.endsWith('.md')&&/{{[A-Z_]+}}/.test(fs.readFileSync(path.join(d,e.name),'utf8')))hits++;}})(process.argv[1]);
  console.log(hits);`, root], { encoding: 'utf8' });
check('no unfilled {{placeholders}}', leftover.stdout.trim() === '0', `${leftover.stdout.trim()} file(s)`);

const links = spawnSync('node', [path.join(root, '.joserah', 'tools', 'verify-links.js'), root], { encoding: 'utf8' });
check('internal links resolve', links.status === 0, (links.stdout || '').trim().split('\n')[0]);

let failed = 0;
for (const c of checks) {
  if (!c.ok) failed++;
  console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
}
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
