#!/usr/bin/env node
/**
 * install-dev-hook.js — for the developer's own checkout of this plugin.
 * Usage: node tools/install-dev-hook.js [<checkout>]   (default: this plugin's root)
 *
 * Writes .git/hooks/post-merge and post-commit, each running
 * `claude plugin update joserah@<marketplace>`, so a pull or a commit in the
 * checkout re-copies the plugin into Claude Code's cache and one restart is
 * all that is left. Never installed automatically. Idempotent: a hook carrying
 * the marker is rewritten, any other hook of the same name is left alone and
 * reported as `foreign`. Prints { "<hook>": "created"|"current"|"refreshed"|"foreign" }.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { pluginCheckout } = require('./lib/prompt');

const MARKER = '# joserah:dev-hook';
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const hooksDir = path.join(root, '.git', 'hooks');
if (!fs.existsSync(path.join(root, '.git'))) {
  console.error(`install-dev-hook: ${root} is not a git checkout`);
  process.exit(1);
}
// The marketplace name the checkout is registered under, sanitised because it
// lands in a shell script; `joserah` when it is not registered (yet).
const co = pluginCheckout();
const marketplace = String((co && co.marketplace) || 'joserah').replace(/[^A-Za-z0-9._-]/g, '') || 'joserah';
const body = `#!/bin/sh\n${MARKER} — written by tools/install-dev-hook.js; delete this file to remove it.\n` +
  `claude plugin update joserah@${marketplace} >/dev/null 2>&1 || true\n`;

const result = {};
fs.mkdirSync(hooksDir, { recursive: true });
for (const name of ['post-merge', 'post-commit']) {
  const file = path.join(hooksDir, name);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current !== null && !current.includes(MARKER)) { result[name] = 'foreign'; continue; }
  if (current === body) { result[name] = 'current'; continue; }
  fs.writeFileSync(file, body, { encoding: 'utf8', mode: 0o755 });
  result[name] = current === null ? 'created' : 'refreshed';
}
console.log(JSON.stringify(result));
