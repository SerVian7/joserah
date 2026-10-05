import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadServerConfig, modelFor, resolveListen, ConfigError, DEFAULT_CONFIG, JOB_TYPES } from '../src/config.ts';
import { stateDir, localDay } from '../src/paths.ts';
import { tmpdir } from './helpers.ts';

function ws(t: import('node:test').TestContext, server?: unknown): string {
  const d = tmpdir(t);
  fs.mkdirSync(path.join(d, '.joserah'), { recursive: true });
  fs.writeFileSync(path.join(d, '.joserah', 'config.json'), '{"dialogueLanguage":"Turkish"}');
  if (server !== undefined) fs.writeFileSync(path.join(d, '.joserah', 'server.json'), JSON.stringify(server));
  return d;
}

test('defaults when server.json is absent', (t) => {
  const c = loadServerConfig(ws(t));
  assert.equal(c.port, 4747);
  assert.equal(c.exposure, 'local');
  assert.equal(c.maxConcurrentJobs, 1);
  assert.equal(c.answerStartsJob, false);
  assert.equal(c.nightlyLlmLint, false);
});

test('model routing defaults and unknown types go to opus', () => {
  assert.equal(modelFor(DEFAULT_CONFIG, 'answers'), 'haiku');
  assert.equal(modelFor(DEFAULT_CONFIG, 'code'), 'sonnet');
  assert.equal(modelFor(DEFAULT_CONFIG, 'review'), 'opus');
  assert.equal(modelFor(DEFAULT_CONFIG, 'something-new'), 'opus');
  for (const j of JOB_TYPES) assert.ok(modelFor(DEFAULT_CONFIG, j));
});

test('haiku is refused for claim-touching job types', (t) => {
  assert.throws(() => loadServerConfig(ws(t, { models: { ingest: 'haiku' } })), (e: unknown) => e instanceof ConfigError && /models\.ingest/.test((e as Error).message));
  assert.throws(() => loadServerConfig(ws(t, { models: { review: 'claude-haiku-5' } })), ConfigError);
  assert.equal(loadServerConfig(ws(t, { models: { digest: 'haiku' } })).models.digest, 'haiku');
});

test('bad values name their key', (t) => {
  assert.throws(() => loadServerConfig(ws(t, { maxConcurrentJobs: 3 })), /maxConcurrentJobs/);
  assert.throws(() => loadServerConfig(ws(t, { exposure: 'everywhere' })), /exposure/);
  assert.throws(() => loadServerConfig(ws(t, { port: 'x' })), /port/);
  const bad = ws(t); fs.writeFileSync(path.join(bad, '.joserah', 'server.json'), '{oops');
  assert.throws(() => loadServerConfig(bad), /server\.json/);
});

test('exposure decides the bind address', () => {
  assert.equal(resolveListen(DEFAULT_CONFIG, {}).hostname, '127.0.0.1');
  assert.equal(resolveListen({ ...DEFAULT_CONFIG, exposure: 'tailnet', bind: '100.64.0.7' }, {}).hostname, '100.64.0.7');
  assert.throws(() => resolveListen({ ...DEFAULT_CONFIG, exposure: 'tailnet' }, {}), /bind/);
  assert.throws(() => resolveListen({ ...DEFAULT_CONFIG, exposure: 'internet' }, {}), /HTTPS/);
  const p = resolveListen({ ...DEFAULT_CONFIG, exposure: 'internet', proxy: true }, {});
  assert.equal(p.secure, true);
  assert.equal(resolveListen(DEFAULT_CONFIG, { JOSERAH_IN_DOCKER: '1' }).hostname, '0.0.0.0');
});

test('state dir is outside the workspace and stable', () => {
  const a = stateDir('/x/ws');
  assert.equal(a, stateDir('/x/ws'));
  assert.ok(!a.startsWith(path.resolve('/x/ws')));
  process.env.JOSERAH_STATE_DIR = '/tmp/s';
  assert.equal(stateDir('/x/ws'), '/tmp/s');
  delete process.env.JOSERAH_STATE_DIR;
});

test('localDay honours JOSERAH_NOW', () => {
  process.env.JOSERAH_NOW = '2026-10-06T08:00:00';
  assert.equal(localDay(), '2026-10-06');
  delete process.env.JOSERAH_NOW;
});
