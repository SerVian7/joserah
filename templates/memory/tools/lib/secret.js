'use strict';
/**
 * secret.js — how a script under tools/<system>/ gets a secret without ever holding one.
 *   const { getSecret } = require('../lib/secret');
 *   const pw = await getSecret('PEPLINK_PASSWORD', '<company>.peplink.password');
 * Order: the environment variable; else the vault of the Joserah workspace this memory sits in
 * (<ws>/.joserah/shared/<name>/ -> <ws>/.joserah/tools/secret.js <vaultName>); else, in a terminal,
 * a prompt with echo off; else an error. Async because of the prompt. The value goes back to the
 * caller only: never printed, logged or written. Node built-ins only.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function workspaceVault(from) {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const tool = path.join(dir, '.joserah', 'tools', 'secret.js');
    if (fs.existsSync(tool)) return tool;
    if (path.dirname(dir) === dir) return null;
  }
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stderr.write(question); };
    rl.question(question, (typed) => { rl.close(); process.stderr.write('\n'); resolve(typed); });
  });
}

async function getSecret(envName, vaultName) {
  if (process.env[envName]) return process.env[envName];
  const tool = workspaceVault(path.resolve(__dirname, '..', '..'));
  if (tool) {
    const r = spawnSync(process.execPath, [tool, vaultName], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout) return r.stdout;
  }
  if (process.stdin.isTTY) {
    const typed = await prompt(`${vaultName}: `);
    if (typed) return typed;
  }
  throw new Error(`secret ${vaultName} not available: set ${envName} or run in a terminal`);
}

module.exports = { getSecret };
