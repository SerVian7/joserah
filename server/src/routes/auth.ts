import { setCookie, deleteCookie } from 'hono/cookie';
import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { COOKIE, signSession, verifyPassword } from '../auth.ts';
import { clientAddr, safeNext } from '../security.ts';
import { shell, esc, jmark, LABELS } from '../layout.ts';
import { workspaceLang } from '../config.ts';

export function register(app: App, deps: AppDeps): void {
  const page = (lang: 'tr' | 'en', next: string, msg = '') => {
    const L = LABELS[lang];
    return shell({ title: L.signin, lang, nav: false, bodyClass: 'is-signin', body: `<div class="stage">${jmark('big hero')}</div><h1>${esc(L.signin)}</h1>${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ''}<form method="post" action="/login"><input type="hidden" name="next" value="${esc(next)}"><label>${esc(L.password)}<br><input type="password" name="password" autocomplete="current-password" required autofocus></label><p><button>${esc(L.signinBtn)}</button></p></form>` });
  };
  app.get('/login', (c) => (deps.auth.state.kind === 'ready' ? c.html(page(workspaceLang(deps.workspace), safeNext(c.req.query('next')))) : c.redirect('/setup', 302)));
  app.post('/login', async (c) => {
    const lang = workspaceLang(deps.workspace); const L = LABELS[lang];
    const body = await c.req.parseBody();
    // No await from here on: check, verify (synchronous scrypt) and fail run as one step, so parallel tries cannot all pass the gate.
    const state = deps.auth.state;
    if (state.kind !== 'ready') return c.redirect('/setup', 302);
    const addr = clientAddr(c, deps.config().proxy); const t = Date.now();
    const gate = deps.limiter.check(addr, t);
    if (!gate.ok) { c.header('Retry-After', String(gate.retryAfterSec)); return c.html(page(lang, '/', L.limited.replace('{s}', String(gate.retryAfterSec))), 429); }
    const next = safeNext(typeof body.next === 'string' ? body.next : undefined);
    if (typeof body.password !== 'string' || !verifyPassword(body.password, state.file.scrypt)) {
      deps.limiter.fail(addr, t);
      return c.html(page(lang, next, L.wrong), 401);
    }
    deps.limiter.success(addr);
    setCookie(c, COOKIE, signSession(state.file), { httpOnly: true, sameSite: 'Strict', path: '/', secure: deps.secureCookies, maxAge: 30 * 86400 });
    return c.redirect(next, 303);
  });
  app.post('/logout', (c) => { deleteCookie(c, COOKIE, { path: '/' }); return c.redirect('/login', 303); });
}
