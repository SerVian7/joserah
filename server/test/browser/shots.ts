// Screenshots of the interface for review: node test/browser/shots.ts <out-dir> [tr|en]
// A throwaway workspace on a free 127.0.0.1 port, the fake engine (a job that hangs, so one stays running), Playwright.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { newAuthFile, writeAuth } from '../../src/auth.ts';
import { localDay } from '../../src/paths.ts';
import { REPO_ROOT, SERVER_ROOT } from '../helpers.ts';

const OUT = path.resolve(process.argv[2] ?? 'shots'); const LANG = process.argv[3] ?? 'tr';
const PW = 'pw-0123456789';
fs.mkdirSync(OUT, { recursive: true });
const free = () => new Promise<number>((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
const HERMETIC = fs.mkdtempSync(path.join(os.tmpdir(), 'joserah-shots-config-'));
const tool = (name: string, args: string[]) => { const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', name), ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: HERMETIC } }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout; };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'joserah-shots-'));
const ws = path.join(root, 'ws'); const state = path.join(root, 'state');
tool('scaffold.js', ['--target', ws, '--owner', 'Serkan', '--workspace', 'demo', '--language', LANG === 'tr' ? 'Turkish' : 'English', '--role', 'r', '--git']);
const page = path.join(ws, '.joserah/desk/artifacts', localDay(), 'daily-tracker');
tool('tracker.js', ['init', page, '--title', 'Daily Tracker', '--lang', LANG]);
writeAuth(state, newAuthFile(PW));
const port = await free(); const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(SERVER_ROOT, 'main.ts'), '--workspace', ws, '--port', String(port)],
  { env: { ...process.env, JOSERAH_STATE_DIR: state, JOSERAH_CLAUDE_BIN: process.execPath, JOSERAH_CLAUDE_PREFIX: path.join(SERVER_ROOT, 'test', 'fixtures', 'fake-claude-slow.mjs') }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise<void>((resolve, reject) => { server.stdout!.on('data', (d: Buffer) => { if (d.toString().includes('Joserah server:')) { server.stdout!.resume(); resolve(); } }); server.on('exit', (c) => reject(new Error(`server exit ${c}`))); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const sizes = { phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } } as const;
const times: Record<string, unknown> = {};

async function signIn(p: Page) {
  await p.goto(`${base}/login`); await p.fill('input[name="password"]', PW);
  await Promise.all([p.waitForURL(`${base}/`), p.click('form[action="/login"] button')]);
}
async function ctx(size: keyof typeof sizes, scheme: 'dark' | 'light', video = false): Promise<BrowserContext> {
  return browser.newContext({ viewport: sizes[size], deviceScaleFactor: size === 'phone' ? 2 : 1, colorScheme: scheme, ...(video ? { recordVideo: { dir: OUT, size: sizes[size] } } : {}) });
}
const shot = (p: Page, name: string) => p.screenshot({ path: path.join(OUT, `${name}.png`) });

try {
  // 1. The load sequence on home, as a first visit of the day would see it.
  for (const size of ['phone', 'desktop'] as const) {
    const c = await ctx(size, 'dark'); const p = await c.newPage();
    await signIn(p);
    await p.evaluate(() => { sessionStorage.clear(); });
    const t0 = Date.now();
    await p.goto(`${base}/`);
    await p.waitForTimeout(Math.max(0, 750 - (Date.now() - t0))); await shot(p, `load-${size}-a-assemble`);
    await p.waitForTimeout(800); await shot(p, `load-${size}-b-lit`);
    await p.waitForFunction(() => !document.documentElement.classList.contains('boot') && !document.querySelector('#boot.on'), null, { timeout: 8000 });
    await p.waitForTimeout(400); await shot(p, `home-${size}-idle-dark`);
    times[size] = await p.evaluate(() => { const paint: Record<string, number> = {}; for (const e of performance.getEntriesByType('paint')) paint[e.name] = Math.round(e.startTime);
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming; const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return { paint, domContentLoaded: Math.round(nav.domContentLoadedEventEnd), htmlBytes: nav.encodedBodySize, files: res.filter((r) => !r.name.includes('/events')).map((r) => [new URL(r.name).pathname, r.encodedBodySize, Math.round(r.responseEnd)]) }; });
    await c.close();
  }
  // 2. Something waits on the owner; then a job runs as well.
  const rows: Array<[string, string, string]> = LANG === 'tr'
    ? [['Rack için kablo seçimi', 'you', 'Uzun ve kısa kablo arasında karar sizde. Kısa olanı öneriyorum, rack derinliğine uyuyor.'], ['Yedek sunucu şifresi', 'you', 'Panele girmek için şifre lazım; bulunca bu satıra yazın.'], ['Kamera firmware güncellemesi', 'wait', 'Üreticinin cevabını bekliyoruz.'], ['Haftalık özet', 'ok', 'Gönderildi.']]
    : [['Which cable for the rack?', 'you', 'Long or short: your call. I recommend the short one; it fits the rack depth.'], ['Backup server password', 'you', 'Needed for the panel; write it on this row when you find it.'], ['Camera firmware update', 'wait', 'Waiting for the maker to reply.'], ['Weekly summary', 'ok', 'Sent.']];
  for (const [title, st, small] of rows) tool('tracker.js', ['row', page, '--title', title, '--state', st, '--small', small]);
  for (const size of ['phone', 'desktop'] as const) for (const scheme of ['dark', 'light'] as const) {
    const c = await ctx(size, scheme); const p = await c.newPage();
    await signIn(p); await p.waitForTimeout(1200);
    await shot(p, `home-${size}-waiting-${scheme}`);
    await c.close();
  }
  {
    const c = await ctx('desktop', 'dark'); const p = await c.newPage(); await signIn(p);
    await p.fill('#job textarea', LANG === 'tr' ? 'Bu haftanın notlarını topla ve özetle' : 'Gather this week\'s notes and summarise them');
    await Promise.all([p.waitForURL(/\/jobs\//), p.click('#job button')]);
    await p.waitForTimeout(5200); await shot(p, 'job-desktop-running-dark');
    await p.goto(`${base}/`); await p.waitForTimeout(2600);
    await shot(p, 'home-desktop-working-dark');
    for (const u of ['/jobs', '/w/']) { await p.goto(base + u); await p.waitForTimeout(500); await shot(p, `page${u.replace(/\W+/g, '-')}desktop-dark`); }
    await c.close();
    const c2 = await ctx('phone', 'dark'); const p2 = await c2.newPage(); await signIn(p2); await p2.waitForTimeout(1500);
    await shot(p2, 'home-phone-working-dark');
    await p2.screenshot({ path: path.join(OUT, 'home-phone-working-dark-full.png'), fullPage: true });
    await c2.close();
  }
  // 3. Sign-in, and a recording of the load sequence.
  for (const size of ['phone', 'desktop'] as const) {
    const c = await ctx(size, 'dark', true); const p = await c.newPage();
    await p.goto(`${base}/login`); await p.waitForTimeout(3600);
    await shot(p, `signin-${size}-dark`);
    await p.fill('input[name="password"]', PW);
    await Promise.all([p.waitForURL(`${base}/`), p.click('form[action="/login"] button')]);
    await p.waitForTimeout(1800);
    const v = p.video(); await c.close();
    if (v) fs.renameSync(await v.path(), path.join(OUT, `load-sequence-${size}.webm`));
  }
  fs.writeFileSync(path.join(OUT, 'timings.json'), JSON.stringify(times, null, 1));
  console.log(JSON.stringify(times));
} finally {
  await browser.close();
  const gone = new Promise((r) => server.once('exit', r)); server.kill(); await gone;
  for (const d of [root, HERMETIC]) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* a temp folder left behind is harmless */ } }
}
