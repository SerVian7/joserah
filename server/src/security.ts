import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from './app.ts';
import type { AppDeps } from './deps.ts';
import { COOKIE, checkSession, originOk } from './auth.ts';

export const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none'";

export function headers(): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next();
    c.header('Content-Security-Policy', CSP);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'SAMEORIGIN');
  };
}

/**
 * The address the rate limit counts by. Behind a declared proxy (`proxy: true`) every request comes from the proxy, so the
 * right-most `X-Forwarded-For` entry — the one the proxy itself appended — names the client; without a proxy the header is
 * the client's own word and is ignored.
 */
export function clientAddr(c: Context<Env>, proxy = false): string {
  if (proxy) {
    const last = (c.req.header('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  return c.env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

/** A local path only: no other host (`//x`, `/\x`, a control character a browser drops), never the login page itself (no sign-in loop). */
export function safeNext(next: string | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !/[\x00-\x1f\x7f]/.test(next) && !/^\/login(?:[/?#]|$)/.test(next) ? next : '/';
}

// Public: no session needed. /logout only clears the cookie, so a signed-out page can still use it without a redirect chain.
// The interface files under /_/s/ (style, script, font, the J) hold nothing private: the sign-in page needs them.
const PUBLIC = [/^\/healthz$/, /^\/login$/, /^\/logout$/, /^\/_\/login\.css$/, /^\/_\/s\//];
const SETUP_ONLY = [/^\/setup$/, /^\/api\/setup\//, /^\/_\/setup\.js$/];

export function guard(deps: AppDeps): MiddlewareHandler<Env> {
  return async (c, next) => {
    const p = c.req.path;
    if (PUBLIC.some((r) => r.test(p))) return next();
    if (deps.auth.state.kind === 'setup') {
      if (SETUP_ONLY.some((r) => r.test(p))) return next();
      return p.startsWith('/api/') ? c.json({ error: 'setup-needed' }, 503) : c.redirect('/setup', 302);
    }
    if (checkSession(deps.auth.state.file, getCookie(c, COOKIE))) { c.set('signedIn', true); return next(); }
    if (p.startsWith('/api/') || p === '/events') return c.json({ error: 'signed-out' }, 401);
    const u = new URL(c.req.url);
    return c.redirect(`/login?next=${encodeURIComponent(u.pathname + u.search)}`, 302);
  };
}

export function originCheck(deps: AppDeps): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
    if (!originOk(c.req.url, c.req.header('origin'), [deps.config().publicOrigin, deps.baseUrl])) return c.json({ error: 'origin' }, 403);
    return next();
  };
}
