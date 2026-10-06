import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SERVER_ROOT, REPO_ROOT } from './helpers.ts';

const read = (p: string) => fs.readFileSync(path.join(SERVER_ROOT, p), 'utf8');

test('the image is non-root, pinned, self-contained and healthchecked', () => {
  const d = read('Dockerfile');
  assert.match(d, /^FROM node:24-slim$/m);
  assert.match(d, /^ARG CLAUDE_CODE_VERSION=2\.1\.289$/m);
  assert.match(d, /claude\.ai\/install\.sh \| bash -s "?\$\{CLAUDE_CODE_VERSION\}"?/);
  assert.match(d, /^USER joserah$/m);
  assert.match(d, /DISABLE_AUTOUPDATER=1/); assert.match(d, /JOSERAH_IN_DOCKER=1/); assert.match(d, /CLAUDE_CONFIG_DIR=\/home\/joserah\/\.claude/); assert.match(d, /JOSERAH_STATE_DIR=\/home\/joserah\/state/);
  assert.match(d, /^HEALTHCHECK /m);
  assert.match(d, /npm ci --omit=dev/);
});

test('compose publishes one port on 127.0.0.1 and shares nothing from the host', () => {
  const c = read('compose.yaml');
  assert.match(c, /"127\.0\.0\.1:\$\{JOSERAH_HOST_PORT:-4747\}:4747"/);
  assert.equal((c.match(/:4747"/g) ?? []).length, 1, 'one published port');
  for (const line of c.split('\n').filter((l) => /^\s+- .*:\/(workspace|home)/.test(l))) assert.match(line, /^\s+- (workspace|claude|state):\//, `named volume only: ${line}`);
  assert.doesNotMatch(c, /- \.\.?\//, 'no host bind mount');
  assert.match(read('compose.gpu.yaml'), /gpus: all/);
});

test('the claude wrapper loads the plugin for sessions and passes subcommands through', () => {
  const w = read('docker/claude');
  assert.match(w, /^#!\/usr\/bin\/env bash/);
  assert.match(w, /--plugin-dir \/opt\/joserah/);
  assert.match(w, /auth\|setup-token/);
  assert.ok(!w.includes('\r'));
});

test('.dockerignore keeps node_modules and git history out of the image', () => {
  const i = fs.readFileSync(path.join(REPO_ROOT, '.dockerignore'), 'utf8');
  for (const l of ['**/node_modules', '.git']) assert.ok(i.split('\n').includes(l), l);
});

test('the engine command comes from JOSERAH_CLAUDE_BIN and an optional JOSERAH_CLAUDE_PREFIX', () => {
  const m = read('main.ts');
  assert.match(m, /process\.env\.JOSERAH_CLAUDE_BIN \|\| 'claude'/);
  assert.match(m, /prefixArgs: process\.env\.JOSERAH_CLAUDE_PREFIX \? \[process\.env\.JOSERAH_CLAUDE_PREFIX\] : \[\]/);
});

test('the shell files keep LF endings', () => {
  assert.ok(!read('docker/smoke.sh').includes('\r'));
});
