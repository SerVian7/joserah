'use strict';
// 0.16.0 (owner, 2026-09-30): on this machine a secret is typed into a small
// Joserah Vault window, not the assistant's terminal; over SSH it falls back.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { tmpdir, PLUGIN_ROOT } = require('./helpers');

const DIALOG = path.join(PLUGIN_ROOT, 'templates', 'memory', 'tools', 'lib', 'vault-dialog.js');
const { canShowDialog, askSecret } = require(DIALOG);
const fakeBrowser = () => ({ bin: 'C:\fake\msedge.exe', app: true });

test('vault dialog: canShowDialog is false over SSH, headless or off; true locally with a browser', () => {
  assert.strictEqual(canShowDialog({ SSH_CONNECTION: '1 2 3 4' }, 'win32', fakeBrowser), false);
  assert.strictEqual(canShowDialog({ SSH_TTY: '/dev/pts/0' }, 'darwin', fakeBrowser), false);
  assert.strictEqual(canShowDialog({}, 'linux', fakeBrowser), false, 'no DISPLAY');
  assert.strictEqual(canShowDialog({ DISPLAY: ':0' }, 'linux', fakeBrowser), true);
  assert.strictEqual(canShowDialog({ JOSERAH_VAULT_DIALOG: 'off' }, 'win32', fakeBrowser), false);
  assert.strictEqual(canShowDialog({}, 'win32', fakeBrowser), true);
  assert.strictEqual(canShowDialog({}, 'win32', () => null), false, 'no browser');
});

const NOOPEN = { JOSERAH_VAULT_OPENER: 'none' };
function open(opts = {}) {
  let url;
  const result = askSecret({ name: 'acme.api.token', lang: 'tr', env: NOOPEN, onReady: (u) => { url = u; }, ...opts });
  return new Promise((r) => { const tick = () => (url ? r({ url, result }) : setTimeout(tick, 5)); tick(); });
}
function request(url, { method = 'GET', body, type } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: type ? { 'content-type': type } : {} }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const pending = (p, ms = 150) => Promise.race([p.then(() => 'settled'), new Promise((r) => setTimeout(() => r('pending'), ms))]);

test('vault dialog: the page is local, strict, named and in Turkish', async () => {
  const { url, result } = await open();
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{64}$/);
  const page = await request(url);
  assert.strictEqual(page.status, 200);
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.match(page.headers['content-security-policy'], /connect-src 'self'/);
  assert.doesNotMatch(page.body, /<form/, 'no form: the browser offers no password save');
  assert.doesNotMatch(page.body, /type="password"/);
  assert.match(page.body, /overflow:hidden/, 'no scrollbar');
  assert.match(page.body, /autocomplete="off"/);
  assert.doesNotMatch(page.body, /https?:\/\//, 'no external resource');
  assert.match(page.body, /Joserah Vault/);
  assert.match(page.body, /acme\.api\.token/);
  assert.match(page.body, /Bu değer yalnız bu makinedeki kasaya yazılır\. AI görmez\./);
  assert.match(page.body, /Kaydet/);
  assert.match(page.body, /Vazgeç/);
  assert.match(page.body, />Kaydedildi</, 'shown in place after Save');
  await request(url, { method: 'POST', body: 'action=cancel', type: 'application/x-www-form-urlencoded' });
  assert.strictEqual(await result, null);
});

test('vault dialog: the right token resolves the value; a wrong one is 403 and waits', async () => {
  const { url, result } = await open();
  const wrong = await request(url.replace(/[0-9a-f]{64}$/, '0'.repeat(64)), { method: 'POST', body: 'value=x&action=save', type: 'application/x-www-form-urlencoded' });
  assert.strictEqual(wrong.status, 403);
  assert.strictEqual(await pending(result), 'pending');
  const ok = await request(url, { method: 'POST', body: 'value=fake%20s%C3%A9cret&action=save', type: 'application/x-www-form-urlencoded' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(await result, 'fake sécret');
});

test('vault dialog: JSON works; a timeout resolves null; the company brand reads .brand', async (t) => {
  const { url, result } = await open();
  await request(url, { method: 'POST', body: JSON.stringify({ value: 'fake-json' }), type: 'application/json' });
  assert.strictEqual(await result, 'fake-json');

  assert.strictEqual(await askSecret({ name: 'a.b', env: NOOPEN, timeoutMs: 50 }), null);

  const dir = tmpdir(t);
  fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(dir, 'zenger-mark.png'), Buffer.from('fake-square-mark'));
  fs.writeFileSync(path.join(dir, 'colours.md'), 'Accent: #123abc\n');
  const c = await open({ lang: 'en', brand: { kind: 'company', dir } });
  const page = await request(c.url);
  assert.ok(page.body.includes(`src="data:image/png;base64,${Buffer.from('fake-square-mark').toString('base64')}"`), 'the square mark, preferred');
  assert.match(page.body, /#123abc/);
  assert.match(page.body, /The AI never sees it\./);
  await request(c.url, { method: 'POST', body: 'action=cancel', type: 'application/x-www-form-urlencoded' });
  assert.strictEqual(await c.result, null);
});

test('secret.js --set opens the window when local, stores, prints only the name', async (t) => {
  const dir = tmpdir(t);
  fs.mkdirSync(path.join(dir, '.joserah'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.joserah', 'config.json'), '{"dialogueLanguage":"Turkish"}');
  const env = { ...process.env, JOSERAH_VAULT_DIALOG: '', JOSERAH_VAULT_OPENER: 'none', JOSERAH_VAULT_TEST_VALUE: 'fake-from-window', SSH_CONNECTION: '', SSH_CLIENT: '', SSH_TTY: '' };
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(PLUGIN_ROOT, 'tools', 'secret.js'), '--set', 'acme.win.password'], { cwd: dir, env });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.stdin.end();
    child.on('close', (status) => resolve({ status, out }));
  });
  assert.strictEqual(r.status, 0, r.out);
  assert.strictEqual(r.out.trim(), 'saved: acme.win.password');
  assert.doesNotMatch(r.out, /fake-from-window/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'keys', 'secrets.json'), 'utf8')).secrets['acme.win.password'], 'fake-from-window');

  // Over SSH --dialog cannot open, and says so.
  const ssh = require('child_process').spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'tools', 'secret.js'), '--set', 'acme.x.pin', '--dialog'],
    { cwd: dir, env: { ...env, SSH_CONNECTION: '1 2 3 4' }, input: '', encoding: 'utf8' });
  assert.strictEqual(ssh.status, 1);
  assert.match(ssh.stderr, /cannot open/);
});

test('memory secret.js --set opens the company window and stores', async (t) => {
  const dir = tmpdir(t);
  fs.mkdirSync(path.join(dir, 'tools', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.memory'));
  for (const f of ['secret.js', 'lib/vault-dialog.js']) fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'memory', 'tools', f), path.join(dir, 'tools', f));
  fs.writeFileSync(path.join(dir, '.memory', 'config.json'), '{"kind":"memory","language":"Türkçe"}');
  const env = { ...process.env, JOSERAH_VAULT_DIALOG: '', JOSERAH_VAULT_OPENER: 'none', JOSERAH_VAULT_TEST_VALUE: 'fake-mem', SSH_CONNECTION: '', SSH_CLIENT: '', SSH_TTY: '' };
  const r = require('child_process').spawnSync(process.execPath, [path.join(dir, 'tools', 'secret.js'), '--set', 'acme.m.pw'], { cwd: dir, env, input: '', encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), 'saved: acme.m.pw');
  assert.doesNotMatch(r.stdout + r.stderr, /fake-mem/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'keys', 'secrets.json'), 'utf8'))['acme.m.pw'], 'fake-mem');
});
