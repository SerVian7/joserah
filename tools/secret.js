#!/usr/bin/env node
/**
 * secret.js — the workspace vault: one secret, called by name.
 *
 * A password standing in a note is seen by everything that reads the note.
 * Values live in keys/secrets.json as name -> value and are called from here
 * one at a time; notes carry only the NAME. If a real vault replaces this file
 * one day, only its inside changes — the call shape and the names stay.
 *
 * Usage (scaffold copies this file to .joserah/tools/secret.js):
 *   node .joserah/tools/secret.js --list                  names only, never a value
 *   node .joserah/tools/secret.js --has <name>            present/absent, no value
 *   node .joserah/tools/secret.js <name>                  prints the value — only ever inside $(...)
 *   <value> | node .joserah/tools/secret.js --set <name> [--force]
 *                                                         value from stdin, never echoed
 *
 * Embed, never print:
 *   curl -H "Authorization: Bearer $(node .joserah/tools/secret.js acme.api.api-token)" ...
 *
 * Names: lowercase, dot-separated, at least two parts — <scope>.<system>[.<sub>].<field>,
 * field one of host|port|url|user|password|token|api-token|pin|ssid|serial|note ...
 *
 * Exit: 0 ok · 1 usage error · 2 no such name · 3 store unreadable / no workspace.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MARKER = path.join('.joserah', 'config.json');
const README = 'Vault. Values are read only through .joserah/tools/secret.js and only ever embedded in a command as $(...). Never print, copy or cite a value; notes carry the name.';
const NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function die(code, msg) { process.stderr.write(msg + '\n'); process.exit(code); }

function findWorkspace(start) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, MARKER))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

// The workspace copy (.joserah/tools/secret.js) belongs to the workspace two
// levels up, wherever it is called from; the plugin copy serves the cwd's.
const beside = path.resolve(__dirname, '..', '..');
const ROOT = fs.existsSync(path.join(beside, MARKER)) ? beside : findWorkspace(process.cwd());
if (!ROOT) die(3, 'secret: not inside a Joserah workspace (no .joserah/config.json found)');
const STORE = path.join(ROOT, 'keys', 'secrets.json');

const args = process.argv.slice(2);
if (!args.length) die(1, 'secret: give a name, or --list');

let doc = { _readme: README, secrets: {} };
if (fs.existsSync(STORE)) {
  try {
    doc = JSON.parse(fs.readFileSync(STORE, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    die(3, 'secret: store unreadable (' + err.message + ')');
  }
} else if (args[0] !== '--set') {
  die(3, 'secret: no store yet — keys/secrets.json is created by the first --set');
}
const secrets = (doc && doc.secrets) || {};
const has = (k) => Object.prototype.hasOwnProperty.call(secrets, k);

if (args[0] === '--list') {
  // Names only, on purpose. This mode never prints a value.
  Object.keys(secrets).sort().forEach((k) => console.log(k));
  process.exit(0);
}

if (args[0] === '--has') {
  if (!args[1]) die(1, 'secret: --has needs a name');
  console.log(has(args[1]) ? 'present' : 'absent');
  process.exit(has(args[1]) ? 0 : 2);
}

if (args[0] === '--set') {
  const name = args[1];
  if (!name || !NAME.test(name)) die(1, 'secret: name must be <scope>.<system>.<field> (lowercase letters, digits, hyphens)');
  if (has(name) && !args.includes('--force')) die(1, `secret: "${name}" already exists; --force to overwrite`);
  const value = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  if (!value) die(1, 'secret: stdin is empty');
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  if (fs.existsSync(STORE)) fs.copyFileSync(STORE, STORE + '.bak');
  doc.secrets = Object.assign(secrets, { [name]: value });
  fs.writeFileSync(STORE + '.tmp', JSON.stringify(doc, null, 2) + '\n');
  fs.renameSync(STORE + '.tmp', STORE);
  console.log('saved: ' + name);
  process.exit(0);
}

const key = args[0];
if (!has(key)) {
  // Suggesting names helps fix a typo without leaking a value.
  const near = Object.keys(secrets).filter((k) => k.startsWith(key.split('.')[0])).slice(0, 8);
  die(2, `secret: "${key}" not found.` + (near.length ? '\nclose names:\n  ' + near.join('\n  ') : ''));
}
process.stdout.write(String(secrets[key]));
