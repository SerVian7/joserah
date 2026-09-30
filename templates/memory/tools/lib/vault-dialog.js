'use strict';
/**
 * vault-dialog.js — a Joserah Vault window for typing one secret on this machine.
 *   const { canShowDialog, askSecret } = require('./lib/vault-dialog');
 *   if (canShowDialog()) value = await askSecret({ name, lang: 'tr', brand: { kind: 'company', dir } });
 * A one-shot page on 127.0.0.1 behind a random token, opened as a small app window. The value goes
 * back to the caller only: never logged, never written by this module. null = cancelled or timed out.
 * Over SSH, headless, or with JOSERAH_VAULT_DIALOG=off there is no window: the caller asks in the terminal.
 * JOSERAH_VAULT_OPENER=none opens nothing (tests post to the URL from onReady). Node built-ins only.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const STRINGS = {
  en: { placeholder: 'Value', show: 'Show', hide: 'Hide', save: 'Save', cancel: 'Cancel', saved: 'Saved',
    warn: 'This value goes only into the vault on this machine. The AI never sees it.' },
  tr: { placeholder: 'Değer', show: 'Göster', hide: 'Gizle', save: 'Kaydet', cancel: 'Vazgeç', saved: 'Kaydedildi',
    warn: 'Bu değer yalnız bu makinedeki kasaya yazılır. AI görmez.' },
};
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'";
// Sized from the content (≈300 CSS px tall, checked at 100 % and 125 %) plus the title bar; Chromium
// windows are never narrower than 500 px, so the width is 520, not less.
const WINDOW = '520,370';

const onPath = (bin, env) => String(env.PATH || '').split(path.delimiter).filter(Boolean)
  .map((d) => path.join(d, bin)).find((p) => fs.existsSync(p)) || null;

// What opens the page: { bin, pre, app } — app: true takes --app=<url> (a small chromeless window).
function findBrowser(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
    for (const exe of [['Microsoft', 'Edge', 'Application', 'msedge.exe'], ['Google', 'Chrome', 'Application', 'chrome.exe']]) {
      for (const root of roots) { const p = path.join(root, ...exe); if (fs.existsSync(p)) return { bin: p, pre: [], app: true }; }
    }
    return { bin: 'cmd', pre: ['/c', 'start', '""'], app: false, verbatim: true };
  }
  if (platform === 'darwin') {
    return fs.existsSync('/Applications/Google Chrome.app')
      ? { bin: 'open', pre: ['-na', 'Google Chrome', '--args'], app: true } : { bin: 'open', pre: [], app: false };
  }
  for (const b of ['google-chrome', 'chromium', 'chromium-browser']) { const p = onPath(b, env); if (p) return { bin: p, pre: [], app: true }; }
  const xdg = onPath('xdg-open', env);
  return xdg ? { bin: xdg, pre: [], app: false } : null;
}

function canShowDialog(env = process.env, platform = process.platform, find = findBrowser) {
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return false;
  if (env.JOSERAH_VAULT_DIALOG === 'off') return false;
  if (env.JOSERAH_VAULT_OPENER === 'none') return true;
  if (platform !== 'win32' && platform !== 'darwin' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  return !!find(env, platform);
}

// Company: the memory's .brand/ (the square mark as data URI, an accent a token file names). Else Joserah.
function look(brand) {
  const base = { bg: '#1c1b1d', accent: '#7a1f2b', logo: null };
  if (!brand || brand.kind !== 'company') return base;
  const out = { ...base, bg: '#1e1e20', accent: '#E3161E' };
  let files = [];
  try { files = fs.readdirSync(brand.dir).sort(); } catch { return out; }
  const png = ['zenger-mark.png', 'zenger-tv-logo.png'].find((f) => files.includes(f)) || files.find((f) => /\.png$/i.test(f));
  if (png) {
    try { out.logo = 'data:image/png;base64,' + fs.readFileSync(path.join(brand.dir, png)).toString('base64'); } catch { /* no logo */ }
  }
  for (const f of files.filter((n) => /\.(md|css|json|txt)$/i.test(n))) {
    let text = '';
    try { text = fs.readFileSync(path.join(brand.dir, f), 'utf8'); } catch { continue; }
    const m = /accent[^#\n]*(#[0-9a-f]{6})\b/i.exec(text);
    if (m) { out.accent = m[1]; break; }
  }
  return out;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const js = (s) => JSON.stringify(String(s)).replace(/</g, '\\u003c');

// No <form> and no password field, so the browser never offers to save the value: a text input
// masked by CSS, sent with fetch, cleared as soon as it is sent.
function page(s, v, name, lang) {
  const field = 'v-' + crypto.randomBytes(4).toString('hex');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Joserah Vault</title><style>
:root{--bg:${v.bg};--sf:#1a1a1c;--ln:#323236;--tx:#e8e8ea;--mu:#a3a3a8;--ac:${v.accent}}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:var(--bg);color:var(--tx);font:15px/1.45 Geist,'Segoe UI',system-ui,sans-serif}
main{height:100%;display:flex;flex-direction:column;gap:12px;padding:20px 22px}
header{display:flex;align-items:center;gap:12px}
header img{width:36px;height:36px;border-radius:6px}
h1{margin:0;font-size:28px;font-weight:600;letter-spacing:-.01em;line-height:36px}
.name{font:14px/1.4 ui-monospace,Consolas,monospace;color:var(--mu);background:var(--sf);border:1px solid var(--ln);border-radius:8px;padding:8px 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:all}
.field{display:flex;align-items:center;background:var(--sf);border:1px solid var(--ln);border-radius:8px}
.field:focus-within{outline:2px solid var(--ac);outline-offset:1px}
input{flex:1;min-width:0;background:transparent;border:0;outline:0;color:var(--tx);font:16px/1.4 ui-monospace,Consolas,monospace;padding:10px 12px}
input.mask{-webkit-text-security:disc}
button{font:inherit;border-radius:8px;padding:7px 16px;border:1px solid var(--ln);background:transparent;color:var(--tx);cursor:pointer}
button:hover{border-color:var(--mu)}button:focus-visible{outline:2px solid var(--ac);outline-offset:1px}
#t{border:0;padding:6px 12px;color:var(--mu);font-size:13px}
.row{display:flex;justify-content:flex-end;align-items:center;gap:8px;min-height:38px}
.save{background:var(--ac);border-color:var(--ac);color:#fff}
#m{display:none;color:var(--tx)}.done #m{display:inline}.done .row button{display:none}
.note{margin:auto 0 0;padding-top:10px;border-top:1px solid var(--ln);color:var(--mu);font-size:13px}
</style></head><body><main>
<header>${v.logo ? `<img alt="" src="${v.logo}">` : ''}<h1>Joserah Vault</h1></header>
<div class="name">${esc(name)}</div>
<div class="field"><input id="v" class="mask" type="text" name="${field}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore placeholder="${esc(s.placeholder)}" autofocus><button type="button" id="t">${esc(s.show)}</button></div>
<div class="row"><span id="m">${esc(s.saved)}</span><button type="button" id="c">${esc(s.cancel)}</button><button type="button" id="s" class="save">${esc(s.save)}</button></div>
<p class="note">${esc(s.warn)}</p>
</main><script>
var v=document.getElementById('v'),t=document.getElementById('t'),busy=false;
function shut(){window.close();}
t.onclick=function(){var m=v.classList.toggle('mask');t.textContent=m?${js(s.show)}:${js(s.hide)};v.focus();};
function send(action){
  if(busy)return;
  if(action==='save'&&!v.value){v.focus();return;}
  busy=true;
  var body=JSON.stringify({action:action,value:action==='save'?v.value:''});
  v.value='';
  var p=fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:body});
  body=null;
  if(action!=='save'){p.then(shut,shut);return;}
  p.then(function(r){if(!r.ok){busy=false;return;}document.body.className='done';setTimeout(shut,700);},function(){busy=false;});
}
document.getElementById('s').onclick=function(){send('save');};
document.getElementById('c').onclick=function(){send('cancel');};
document.addEventListener('keydown',function(e){if(e.key==='Enter'&&e.target===v)send('save');if(e.key==='Escape')send('cancel');});
v.focus();
</script></body></html>`;
}

function openWindow(url, env) {
  const b = findBrowser(env);
  if (!b) return null;
  const args = b.pre.concat(b.app ? [`--app=${url}`, `--window-size=${WINDOW}`, '--new-window'] : [url]);
  try {
    const child = spawn(b.bin, args, { detached: true, stdio: 'ignore', windowsHide: !b.app, windowsVerbatimArguments: !!b.verbatim });
    child.on('error', () => {});
    child.unref();
    return b.app ? child : null;
  } catch { return null; /* nothing opened: the timeout answers */ }
}

function askSecret({ name, lang = 'en', brand = null, timeoutMs = 300000, onReady = null, env = process.env } = {}) {
  const code = STRINGS[lang] ? lang : 'en';
  const s = STRINGS[code];
  const v = look(brand);
  const token = crypto.randomBytes(32).toString('hex');
  return new Promise((resolve) => {
    let settled = false;
    let win = null;
    const server = http.createServer((req, res) => {
      const send = (status, type, text) => {
        res.writeHead(status, { 'Content-Type': type + '; charset=utf-8', 'Content-Security-Policy': CSP,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Connection: 'close' });
        res.end(text);
      };
      if (req.url !== '/' + token) { req.resume(); return send(req.method === 'POST' ? 403 : 404, 'text/plain', ''); }
      if (req.method === 'GET') return send(200, 'text/html', page(s, v, name, code));
      if (req.method !== 'POST' || settled) { req.resume(); return send(405, 'text/plain', ''); }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
      req.on('end', () => {
        let action;
        let value;
        try {
          if (/json/i.test(req.headers['content-type'] || '')) ({ value, action } = JSON.parse(body));
          else { const q = new URLSearchParams(body); value = q.get('value'); action = q.get('action'); }
        } catch { return send(400, 'text/plain', ''); }
        if (action === 'cancel') { send(200, 'text/plain', 'ok'); return finish(null); }
        if (typeof value !== 'string' || !value) return send(400, 'text/plain', '');
        send(200, 'text/plain', 'ok');
        finish(value);
      });
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      setImmediate(() => server.closeAllConnections && server.closeAllConnections());
      if (!win) return resolve(value);
      // The page closes itself after "Saved"; if it could not, the app window we started goes too.
      setTimeout(() => { try { win.kill(); } catch { /* already gone */ } resolve(value); }, 1000);
    }
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/${token}`;
      if (onReady) onReady(url);
      if (env.JOSERAH_VAULT_OPENER !== 'none') { win = openWindow(url, env); return; }
      // Test hook: with no opener, JOSERAH_VAULT_TEST_VALUE is posted as if it had been typed.
      if (env.JOSERAH_VAULT_TEST_VALUE) {
        const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, (r) => r.resume());
        req.on('error', () => {});
        req.end(JSON.stringify({ value: env.JOSERAH_VAULT_TEST_VALUE }));
      }
    });
  });
}

module.exports = { canShowDialog, askSecret, findBrowser };
