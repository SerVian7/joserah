import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import { newAuthFile, writeAuth } from '../../src/auth.ts';
import { localDay } from '../../src/paths.ts';
import { REPO_ROOT, SERVER_ROOT, FAKE_CLAUDE } from '../helpers.ts';

const PW = 'pw-0123456789';
const free = () => new Promise<number>((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
const tool = (name: string, args: string[]) => { const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', name), ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout; };

let server: ChildProcess; let browser: Browser; let base = ''; let ws = ''; let page = ''; let tmp = '';

test.before(async () => {
  const root = tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'joserah-e2e-'));
  ws = path.join(root, 'ws'); const state = path.join(root, 'state');
  tool('scaffold.js', ['--target', ws, '--owner', 'O', '--workspace', 'w', '--language', 'en', '--role', 'r']);
  page = path.join(ws, '.joserah/desk/artifacts', localDay(), 'daily-tracker');
  tool('tracker.js', ['init', page, '--title', 'Daily Tracker', '--lang', 'en']);
  tool('tracker.js', ['row', page, '--title', 'Which cable?', '--state', 'you', '--option', 'A|Long cable', '--option', 'B|Short cable', '--recommend', 'B', '--why', 'fits the rack']);
  // a second, untouched row for the signed-out test: an answered choice hides its own form
  tool('tracker.js', ['row', page, '--title', 'Which colour?', '--state', 'you', '--option', 'A|Grey', '--option', 'B|Black', '--recommend', 'A', '--why', 'matches the rack']);
  writeAuth(state, newAuthFile(PW));
  const port = await free(); base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(SERVER_ROOT, 'main.ts'), '--workspace', ws, '--port', String(port)],
    { env: { ...process.env, JOSERAH_STATE_DIR: state, JOSERAH_CLAUDE_BIN: process.execPath, JOSERAH_CLAUDE_PREFIX: FAKE_CLAUDE }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((resolve, reject) => { server.stdout!.on('data', (d: Buffer) => { if (d.toString().includes('Joserah server:')) { server.stdout!.removeAllListeners('data'); server.stdout!.resume(); resolve(); } }); server.on('exit', (c) => reject(new Error(`server exit ${c}`))); });
  browser = await chromium.launch();
});
test.after(async () => {
  await browser?.close();
  if (server?.exitCode === null) { const gone = new Promise((r) => server.once('exit', r)); server.kill(); await gone; }
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
});

test('answer a row from the page and see the reply come back live', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  let loads = 0; p.on('load', () => { loads += 1; });
  await p.goto(`${base}/p/tracker`);
  assert.match(p.url(), /\/login\?next=/);
  await p.fill('input[name="password"]', PW);
  await Promise.all([p.waitForURL(/\/p\/\d{4}-\d{2}-\d{2}\/daily-tracker\/$/), p.click('form[action="/login"] button')]);
  await p.click('button.tx >> text=Which cable?');
  await p.click('li[data-k="B"]');
  await p.fill('form.ans[data-choice] input', 'the short one');
  await p.click('form.ans[data-choice] .send');
  await p.waitForSelector('[data-an]:has-text("answered: B")');
  const id = await p.getAttribute('form.ans[data-choice]', 'data-ans');
  const docs = JSON.parse(fs.readFileSync(path.join(page, 'answers.json'), 'utf8')).docs;
  assert.equal(docs[id!].key, 'B');
  loads = 0;
  tool('answers.js', ['reply', page, id!, '--note', 'Ordered the short one.']);
  await p.waitForSelector('ol.th li.as:has-text("Ordered the short one.")', { timeout: 10000 });
  assert.ok(loads <= 1, `no reload loop (${loads} loads)`);
  await ctx.close();
});

test('every server page fits a 390 px screen', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(`${base}/login`);
  await p.fill('input[name="password"]', PW);
  await Promise.all([p.waitForURL(`${base}/`), p.click('form[action="/login"] button')]);
  for (const u of ['/', '/p/tracker', '/tv', '/w/', '/w/claims', '/jobs']) {
    await p.goto(base + u);
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 390, `${u} is ${w}px wide`);
  }
  await ctx.close();
});

test('signed-out banner', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(`${base}/login?next=%2Fp%2Ftracker`);
  await p.fill('input[name="password"]', PW);
  await Promise.all([p.waitForURL(/daily-tracker\/$/), p.click('form[action="/login"] button')]);
  await ctx.clearCookies();
  const form = 'form.ans[data-row="Which colour?"]';
  await p.click('button.tx >> text=Which colour?');
  await p.click('li[data-k="A"]:visible');
  await p.fill(`${form} input`, 'after sign-out');
  await p.click(`${form} .send`);
  const banner = p.locator('#jh-out');
  await banner.waitFor();
  assert.match(await banner.innerText(), /Signed out/);
  assert.match((await banner.locator('a').getAttribute('href'))!, /^\/login\?next=%2Fp%2F/);
  await ctx.close();
});
