import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { SERVER_ROOT } from './helpers.ts';

test('tsc --noEmit is clean', () => {
  const r = spawnSync('npx', ['tsc', '-p', 'tsconfig.json'], { cwd: SERVER_ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
