#!/usr/bin/env node
'use strict';
/** node tools/jobs-install.js [workspace]: the Tracker page (templates/jobs) into desk/artifacts/tracker/, and the desk/jobs folder. Safe to repeat: the page files are the plugin's, the jobs are never touched. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || process.cwd());
if (!fs.existsSync(path.join(root, '.joserah', 'config.json'))) { console.error('jobs-install: not a Joserah workspace: ' + root); process.exit(1); }
const from = path.join(__dirname, '..', 'templates', 'jobs');
const page = path.join(root, '.joserah', 'desk', 'artifacts', 'tracker');
fs.mkdirSync(page, { recursive: true });
fs.mkdirSync(path.join(root, '.joserah', 'desk', 'jobs'), { recursive: true });
for (const n of fs.readdirSync(from)) fs.copyFileSync(path.join(from, n), path.join(page, n));
console.log('jobs-install: page in ' + path.relative(root, page).split(path.sep).join('/') + ', jobs in .joserah/desk/jobs');
