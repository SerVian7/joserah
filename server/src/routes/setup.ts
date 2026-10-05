import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { App, Env } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import type { JobRecord } from '../jobs.ts';
import { Refused, ensureJobIgnores } from '../jobs.ts';
import { jsonError } from '../app.ts';
import { setupToken, clearSetupToken, newAuthFile, writeAuth, signSession, COOKIE, MIN_PASSWORD } from '../auth.ts';
import { shell, esc } from '../layout.ts';
import { toolPath } from '../paths.ts';
import { workspaceLang } from '../config.ts';

/** The wizard's test job passes when it ended done and its answer says "ready" (B7: health proves work, not a 200). */
export function wizardPass(job: JobRecord): boolean { return job.state === 'done' && /\bready\b/i.test(job.resultText ?? ''); }
const TEST_TEXT = 'This is the setup check. Reply with the single word: ready';
const same = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const gitIn = (cwd: string, ...args: string[]) => spawnSync('git', ['-c', 'user.name=Joserah Server', '-c', 'user.email=server@joserah.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', windowsHide: true });
/** Whatever sits before the host of an http(s) address (a password, a token) and any query or fragment is never shown back. */
const maskUrl = (u: string) => u.replace(/^(https?:\/\/)[^/]*@/i, '$1').replace(/[?#].*$/, '');

const SETUP_JS = `(function(){function post(u,b){return fetch(u,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}).then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j})})}
document.querySelectorAll('form[data-step]').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();var b={};new FormData(f).forEach(function(v,k){b[k]=v});var err=f.querySelector('.err');if(err)err.textContent='';
post('/api/setup/'+f.getAttribute('data-step'),b).then(function(j){if(j.id){var t=setInterval(function(){fetch('/api/setup/test-job/'+j.id,{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(s){if(s.state!=='queued'&&s.state!=='running'){clearInterval(t);location.reload()}})},2000)}else location.href='/setup'},function(x){if(err)err.textContent=(x&&(x.message||x.error))||'error'})})})})();`;

export function register(app: App, deps: AppDeps): void {
  const tr = () => workspaceLang(deps.workspace) === 'tr';
  const ready = () => deps.auth.state.kind === 'ready';
  const hasWorkspace = () => fs.existsSync(path.join(deps.workspace, '.joserah', 'config.json'));
  // The workspace folder itself is the repository (a parent folder's history is not this workspace's backup).
  const hasHistory = () => fs.existsSync(path.join(deps.workspace, '.git'));
  let lastTest: string | null = null;

  app.get('/_/setup.js', (c) => c.body(SETUP_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }));

  app.get('/setup', async (c) => {
    if (!ready()) {
      const tok = setupToken(deps.stateDir);
      const given = c.req.query('token') ?? getCookie(c, 'jsetup') ?? '';
      if (!same(given, tok)) return c.html(shell({ title: 'Setup', lang: tr() ? 'tr' : 'en', nav: false, body: `<p>${tr() ? 'Kurulum bağlantısını sunucunun başlarken yazdığı satırdan açın.' : 'Open the setup link the server printed when it started.'}</p>` }), 403);
      setCookie(c, 'jsetup', tok, { httpOnly: true, sameSite: 'Strict', path: '/', secure: deps.secureCookies, maxAge: 3600 });
      return c.html(shell({ title: 'Setup', lang: tr() ? 'tr' : 'en', nav: false, body: `<h1>${tr() ? 'Kurulum' : 'Setup'} 1/5</h1>
<form data-step="password"><input type="hidden" name="token" value="${esc(tok)}"><p><label>${tr() ? 'Parola' : 'Password'} (≥ ${MIN_PASSWORD})<br><input type="password" name="password" minlength="${MIN_PASSWORD}" required autocomplete="new-password"></label></p>
<p><label>${tr() ? 'Tekrar' : 'Again'}<br><input type="password" name="confirm" required autocomplete="new-password"></label></p><p><button>OK</button> <span class="err"></span></p></form><script src="/_/setup.js"></script>` }));
    }
    const ws = deps.workspace;
    const hasWs = hasWorkspace();
    const isRepo = hasHistory();
    const remote = isRepo ? maskUrl(gitIn(ws, 'remote', 'get-url', 'origin').stdout.trim()) : '';
    const h = await deps.engine.health(); deps.engineHealth = h; deps.health.signedIn = h.signedIn;
    const test = lastTest ? deps.jobs.get(lastTest) : undefined;
    const ok = (b: boolean) => (b ? '✓' : '·');
    const docker = process.env.JOSERAH_IN_DOCKER === '1';
    const body = `<h1>${tr() ? 'Kurulum' : 'Setup'}</h1>
<h2>${ok(true)} 1. ${tr() ? 'Parola' : 'Password'}</h2>
<h2>${ok(hasWs)} 2. ${tr() ? 'Çalışma alanı' : 'Workspace'}</h2><p class="muted">${esc(ws)}</p>
${hasWs ? '' : `<form data-step="workspace"><input name="owner" required placeholder="${tr() ? 'Adınız' : 'Your name'}"> <input name="name" required placeholder="${tr() ? 'Çalışma alanı adı' : 'Workspace name'}"> <select name="language"><option>Turkish</option><option>English</option></select> <button>OK</button> <span class="err"></span></form>`}
<h2>${ok(isRepo && !!remote)} 3. ${tr() ? 'Yedek' : 'Backup'}</h2>
${isRepo || !hasWs ? '' : `<form data-step="git-init"><button>${tr() ? 'Yedek geçmişini başlat' : 'Start the backup history'}</button> <span class="err"></span></form>`}
${isRepo ? `<form data-step="remote"><input name="url" required value="${esc(remote)}" placeholder="https://…/workspace.git"> <button>OK</button> <span class="err"></span></form>` : ''}
<h2>${ok(h.installed && h.signedIn)} 4. Claude Code</h2><p>${esc(h.installed ? `${h.version} · ${h.detail}` : h.detail)}</p>
${h.signedIn ? '' : `<p>${tr() ? 'Bir terminalde bir kez çalıştırıp giriş yapın:' : 'Run once in a terminal and sign in:'} <code>${docker ? 'docker exec -it -w /workspace joserah claude' : 'claude'}</code> — ${tr() ? 'sonra bu sayfayı yenileyin.' : 'then reload this page.'}</p>`}
<h2>${ok(!!test && wizardPass(test))} 5. ${tr() ? 'Deneme işi' : 'Test job'}</h2>${test ? `<p>${esc(test.state)} · ${esc(test.resultText ?? test.error ?? '')}</p>` : ''}
${h.signedIn ? `<form data-step="test-job"><button>${tr() ? 'Deneme işini çalıştır' : 'Run the test job'}</button> <span class="err"></span></form>` : ''}
<p><a href="/">${tr() ? 'Ana sayfa' : 'Home'}</a></p><script src="/_/setup.js"></script>`;
    return c.html(shell({ title: 'Setup', lang: tr() ? 'tr' : 'en', body }));
  });

  app.post('/api/setup/password', async (c) => {
    const b = await c.req.json().catch(() => ({})) as { token?: string; password?: string; confirm?: string };
    // Checked after the body is read and nothing is awaited from here on: two posts at once cannot both write the file.
    if (ready()) return jsonError(c, 409, 'already-set');
    if (!same(String(b.token ?? ''), setupToken(deps.stateDir))) return jsonError(c, 403, 'token');
    const pw = String(b.password ?? '');
    if (pw.length < MIN_PASSWORD) return jsonError(c, 400, 'short', { message: `at least ${MIN_PASSWORD} characters` });
    if (pw !== String(b.confirm ?? '')) return jsonError(c, 400, 'mismatch');
    const file = newAuthFile(pw);
    writeAuth(deps.stateDir, file);
    clearSetupToken(deps.stateDir);
    deps.auth.state = { kind: 'ready', file };
    setCookie(c, COOKIE, signSession(file), { httpOnly: true, sameSite: 'Strict', path: '/', secure: deps.secureCookies, maxAge: 30 * 86400 });
    setCookie(c, 'jsetup', '', { path: '/', maxAge: 0 });
    return c.json({ next: '/setup' }, 201);
  });

  const signedOnly = (c: Context<Env>) => (ready() && c.get('signedIn') ? null : jsonError(c, 403, 'password-first'));

  app.post('/api/setup/workspace', async (c) => {
    const no = signedOnly(c); if (no) return no;
    const b = await c.req.json().catch(() => ({})) as { owner?: string; name?: string; language?: string };
    if (hasWorkspace()) return jsonError(c, 409, 'exists');
    const owner = String(b.owner ?? '').trim(); const name = String(b.name ?? '').trim(); const language = /^en/i.test(String(b.language ?? '')) ? 'English' : 'Turkish';
    if (!owner || !name) return jsonError(c, 400, 'missing');
    const r = spawnSync(process.execPath, [toolPath('scaffold.js'), '--target', deps.workspace, '--owner', owner, '--workspace', name, '--language', language, '--role', ''], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) return jsonError(c, 500, 'scaffold', { message: (r.stderr || r.stdout).trim().split('\n')[0] });
    ensureJobIgnores(deps.workspace); // now that the scaffold has written its .gitignore
    return c.json({ ok: true }, 201);
  });

  app.post('/api/setup/git-init', (c) => {
    const no = signedOnly(c); if (no) return no;
    if (hasHistory()) return jsonError(c, 409, 'exists');
    // The scaffold writes the secret rules of .gitignore; committing before it would put keys/ into the history.
    if (!hasWorkspace()) return jsonError(c, 409, 'no-workspace', { message: 'create the workspace first' });
    for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '--allow-empty', '-m', 'workspace: start', '-m', 'Joserah Server']]) {
      const r = gitIn(deps.workspace, ...args);
      if (r.status !== 0) {
        fs.rmSync(path.join(deps.workspace, '.git'), { recursive: true, force: true }); // no half-made history: the step can be run again
        return jsonError(c, 500, 'git', { message: (r.stderr || r.stdout).trim().split('\n')[0] });
      }
    }
    return c.json({ commit: gitIn(deps.workspace, 'rev-parse', 'HEAD').stdout.trim() }, 201);
  });

  app.post('/api/setup/remote', async (c) => {
    const no = signedOnly(c); if (no) return no;
    const b = await c.req.json().catch(() => ({})) as { url?: string };
    const url = String(b.url ?? '').trim();
    if (/^(https?|ssh):\/\/[^/@\s]+:[^/@\s]*@/i.test(url) || /^https?:\/\/[^/@\s]+@/i.test(url)) return jsonError(c, 400, 'credentials-in-url', { message: 'put the token in the vault, not in the address' });
    if (!/^(https:\/\/|ssh:\/\/|git@)[^\s?#]+$/.test(url)) return jsonError(c, 400, 'bad-url');
    if (!hasHistory()) return jsonError(c, 409, 'no-history', { message: 'start the backup history first' });
    const has = gitIn(deps.workspace, 'remote', 'get-url', 'origin').status === 0;
    const r = gitIn(deps.workspace, 'remote', has ? 'set-url' : 'add', 'origin', url);
    return r.status === 0 ? c.json({ url }) : jsonError(c, 500, 'git', { message: r.stderr.trim().split('\n')[0] });
  });

  app.get('/api/setup/engine', async (c) => {
    const no = signedOnly(c); if (no) return no;
    const h = await deps.engine.health(); deps.engineHealth = h; deps.health.signedIn = h.signedIn;
    return c.json(h);
  });

  app.post('/api/setup/test-job', async (c) => {
    const no = signedOnly(c); if (no) return no;
    const h = await deps.engine.health(); deps.engineHealth = h; deps.health.signedIn = h.signedIn;
    if (!h.installed || !h.signedIn) return jsonError(c, 503, 'engine', { reason: h.detail, message: h.detail });
    try {
      const j = deps.jobs.submit({ type: 'bookkeeping', text: TEST_TEXT, budgetUsd: 0.05 });
      lastTest = j.id;
      return c.json({ id: j.id }, 201);
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      return jsonError(c, e.code === 'daily-budget' ? 429 : e.code === 'stopping' ? 503 : 409, e.code, { message: e.message });
    }
  });

  app.get('/api/setup/test-job/:id', (c) => {
    const no = signedOnly(c); if (no) return no;
    const j = deps.jobs.get(c.req.param('id'));
    return j ? c.json({ state: j.state, pass: wizardPass(j) }) : jsonError(c, 404, 'not-found');
  });
}
