#!/usr/bin/env node
/**
 * detect-member.js — which member of this memory is at the keyboard.
 * Usage: node tools/detect-member.js   → prints the member name, exit 0; nothing and exit 1 if unknown.
 *
 * In order: `.memory/me` (this machine only, gitignored); the owner of the
 * Joserah workspace this memory sits in (<workspace>/.joserah/shared/<name>/),
 * first name; the git user name, first name. Always lowercase ASCII, and always one of the
 * `members` in .memory/config.json — a name that is not one is no answer (exit 1).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TR = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
function memberSlug(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return first.toLocaleLowerCase('tr').replace(/[çğıöşü]/g, (c) => TR[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]/g, '');
}

function read(p) { try { return fs.readFileSync(p, 'utf8').replace(/^﻿/, ''); } catch { return ''; } }

function candidate(root) {
  const me = memberSlug(read(path.join(root, '.memory', 'me')));
  if (me) return me;
  // <workspace>/.joserah/shared/<name>/ → <workspace>/.joserah/config.json
  try {
    const owner = memberSlug(JSON.parse(read(path.join(root, '..', '..', 'config.json'))).ownerName);
    if (owner) return owner;
  } catch { /* not inside a Joserah workspace */ }
  const git = spawnSync('git', ['-C', root, 'config', 'user.name'], { encoding: 'utf8' });
  return memberSlug(git.stdout) || null;
}

// The members this memory names, or null when the config cannot be read.
function membersOf(root) {
  try { const m = JSON.parse(read(path.join(root, '.memory', 'config.json'))).members; return Array.isArray(m) ? m : null; } catch { return null; }
}

/** The member at the keyboard, or null — a guess that is not in the members list is no member. */
function detectMember(root) {
  const who = candidate(root);
  const members = membersOf(root);
  return who && (!members || members.includes(who)) ? who : null;
}

module.exports = { detectMember, memberSlug, candidate, membersOf };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const who = detectMember(root);
  if (!who) {
    const guess = candidate(root), members = membersOf(root);
    console.error(guess && members
      ? `detect-member: member '${guess}' is not in this memory's members (${members.join(', ')}); write .memory/me`
      : 'detect-member: unknown — ask the member once and write their first name into .memory/me');
    process.exit(1);
  }
  console.log(who);
}
