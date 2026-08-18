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

for (const f of ['AGENTS.md', 'CLAUDE.md', 'desk/tasks/now.md', '.joserah/learned.md',
                 'desk/inbox/captures.md', 'personal/profile.md', '.claude/settings.json']) {
  check(`exists: ${f}`, fs.existsSync(path.join(root, f)));
}

const leftover = spawnSync('node', ['-e', `
  const fs=require('fs'),path=require('path');let hits=0;
  (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
    if(e.isDirectory()){if(!['.git','node_modules','.joserah','projects','docker-stack','keys','.venv'].includes(e.name))walk(path.join(d,e.name));}
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
