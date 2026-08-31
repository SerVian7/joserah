'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN_ROOT, tmpdir } = require('./helpers');
const { sameRepoPath, repoToplevel, isOwnRepoRoot } = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'git-root'));

test('sameRepoPath is case-insensitive on win32 only', () => {
  const a = path.win32.resolve('C:/Foo/Bar');
  const b = path.win32.resolve('c:/foo/bar');
  if (process.platform === 'win32') {
    assert.strictEqual(sameRepoPath(a, b), true);
  }
  assert.strictEqual(sameRepoPath('/a/b', '/a/b'), true);
  assert.strictEqual(sameRepoPath('/a/b', '/a/c'), false);
});

test('repoToplevel is null outside any git repository', (t) => {
  const dir = tmpdir(t);
  assert.strictEqual(repoToplevel(dir), null);
});

test('isOwnRepoRoot is true for a directory that is its own repo, false when nested inside another', (t) => {
  const outer = tmpdir(t);
  const g = (cwd, a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
  if (g(outer, ['--version']).status !== 0) return t.skip('git unavailable');
  g(outer, ['init']);
  assert.strictEqual(isOwnRepoRoot(outer), true);

  const nested = path.join(outer, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  assert.strictEqual(isOwnRepoRoot(nested), false, 'nested inside an ancestor repo is not its own root');
});
