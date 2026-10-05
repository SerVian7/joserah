import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cliTracker, roleFor } from '../src/tracker-bridge.ts';
import { tmpWorkspace } from './helpers.ts';

test.beforeEach(() => { process.env.JOSERAH_NOW = '2026-10-06T09:00:00'; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });

test('creates today\'s Daily Tracker, then upserts a row and a strip entry', (t) => {
  const ws = tmpWorkspace(t);
  const tr = cliTracker(ws, 'en');
  assert.ok(tr.row({ title: 'Summarise the week · 09:00', state: 'run', small: 'Running.' }));
  assert.ok(tr.crew({ role: 'builder', job: 'Summarise the week · 09:00', state: 'work', row: 'Summarise the week · 09:00' }));
  assert.equal(tr.rowState('Summarise the week · 09:00'), 'run');
  assert.equal(tr.dir(), path.join(ws, '.joserah', 'desk', 'artifacts', '2026-10-06', 'daily-tracker'));
  const store = JSON.parse(fs.readFileSync(path.join(tr.dir(), 'rows.json'), 'utf8'));
  assert.equal(store.crew[0].state, 'work');
  assert.ok(tr.crew({ role: 'builder', job: 'Summarise the week · 09:00', state: 'idle' }));
  assert.equal(JSON.parse(fs.readFileSync(path.join(tr.dir(), 'rows.json'), 'utf8')).crew[0].state, 'idle');
});

test('a Tracker failure returns false, never throws', (t) => {
  const tr = cliTracker(tmpWorkspace(t), 'en');
  assert.equal(tr.crew({ role: 'builder', job: 'x', state: 'work', row: 'no such row' }), false);
});

test('job types map to strip roles', () => {
  assert.equal(roleFor('research'), 'scout');
  assert.equal(roleFor('review'), 'architect');
  assert.equal(roleFor('code'), 'builder');
});
