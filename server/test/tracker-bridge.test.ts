import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cliTracker, slugOf } from '../src/tracker-bridge.ts';
import { tmpWorkspace, trackerRows } from './helpers.ts';

test.beforeEach(() => { process.env.JOSERAH_NOW = '2026-10-06T09:00:00'; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });

test('a row is one job file the checker accepts; the same title overwrites it and keeps its start', (t) => {
  const ws = tmpWorkspace(t);
  const tr = cliTracker(ws, 'en');
  assert.ok(tr.row({ title: 'Summarise the week · 09:00', state: 'run', small: 'Running.', url: 'http://x/jobs/1', label: 'job page' }));
  assert.equal(tr.rowState('Summarise the week · 09:00'), 'run');
  assert.equal(tr.dir(), path.join(ws, '.joserah', 'desk', 'jobs'));
  const f = path.join(tr.dir(), `${slugOf('Summarise the week · 09:00')}.json`);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepEqual([j.state, j.unattended, j.project, j.note, j.label], ['run', true, 'Server jobs', 'Running.', 'job page']);
  process.env.JOSERAH_NOW = '2026-10-06T09:30:00';
  assert.ok(tr.row({ title: 'Summarise the week · 09:00', state: 'ok', small: 'Done.' }));
  const k = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(k.state, 'done'); assert.equal(k.started, j.started); assert.match(k.finished, /^2026-10-06T09:30:00/);
  assert.equal(tr.rowState('Summarise the week · 09:00'), 'ok', 'done reads back as ok');
  assert.equal(trackerRows(ws).length, 1);
  assert.match(fs.readFileSync(path.join(ws, '.joserah/desk/daily/2026/2026-10-06.md'), 'utf8'), /Summarise the week · 09:00/, 'done adds the journal line');
});

test('a bad row returns false, never throws; two titles never share a file', (t) => {
  const tr = cliTracker(tmpWorkspace(t), 'tr');
  assert.equal(tr.row({ title: '  ', state: 'run' }), false);
  assert.notEqual(slugOf('Sürekli iş · 09:00'), slugOf('Sürekli iş · 09:01'));
  assert.match(slugOf('Çalışıyor'), /^calisiyor-[0-9a-f]{6}$/);
  assert.equal(tr.rowState('never written'), null);
});
