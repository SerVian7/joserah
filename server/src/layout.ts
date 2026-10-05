import { theme } from './cjs.ts';

export function esc(s: string): string { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }

export const LABELS = {
  tr: { home: 'Ana sayfa', tracker: 'Takip', wiki: 'Bilgi', jobs: 'İşler', signin: 'Giriş', password: 'Parola', signinBtn: 'Giriş yap', wrong: 'Parola yanlış.', limited: 'Çok fazla deneme. {s} sn sonra tekrar deneyin.', signout: 'Çıkış', pages: 'Sayfalar', newJob: 'Yeni iş', send: 'Gönder', cost: 'Bugün tahmini maliyet', estimate: 'tahmin', running: 'Çalışan işler', none: 'Şu an çalışan iş yok', cancel: 'Durdur', reply: 'Yanıtla', approve: 'İzin ver ve sürdür', retry: 'Yeniden dene', changed: 'Değişen dosyalar', result: 'Sonuç', disabled: 'İş verilemiyor', search: 'Ara', claims: 'Ölçüm ve kararlar', lint: 'Denetim', log: 'Günlük', fileIt: 'Sayfa olarak kaydet', ask: 'Sor', upload: 'Dosya ekle', noTracker: 'Bugün için takip sayfası yok.' },
  en: { home: 'Home', tracker: 'Tracker', wiki: 'Knowledge', jobs: 'Jobs', signin: 'Sign in', password: 'Password', signinBtn: 'Sign in', wrong: 'Wrong password.', limited: 'Too many tries. Try again in {s} s.', signout: 'Sign out', pages: 'Pages', newJob: 'New job', send: 'Send', cost: "Today's estimated cost", estimate: 'estimate', running: 'Running jobs', none: 'Nothing running right now', cancel: 'Stop', reply: 'Reply', approve: 'Allow and continue', retry: 'Retry', changed: 'Changed files', result: 'Result', disabled: 'Jobs cannot start', search: 'Search', claims: 'Measurements and decisions', lint: 'Checks', log: 'Log', fileIt: 'File it as a page', ask: 'Ask', upload: 'Add a file', noTracker: 'There is no Tracker for today.' },
} as const;
export type Lang = keyof typeof LABELS;

// Phone first: 16 px gutter, nothing wider than the screen, long words wrap (decision 9).
export const PAGE_CSS = [
  '*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}',
  'body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 var(--sans);overflow-wrap:anywhere}',
  'main,header.top{max-width:960px;margin:0 auto;padding:0 16px}',
  'header.top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding-top:12px;padding-bottom:12px;border-bottom:1px solid var(--line)}',
  'header.top a{color:var(--link);text-decoration:none}',
  'img,video,iframe,table,pre{max-width:100%}pre{overflow-x:auto}table{display:block;overflow-x:auto;border-collapse:collapse}',
  'input,textarea,button,select{font:inherit;max-width:100%}textarea{width:100%}',
  'button{border:1px solid var(--line);background:var(--card);color:var(--ink);padding:8px 14px;cursor:pointer}',
  '.muted{color:var(--muted)}.err{color:var(--you)}',
].join('\n');
// TV: a large read-only view, far from the screen.
export const TV_CSS = 'html{font-size:28px}body{font-size:1rem}form.ans,button.rp,.send,input,textarea{display:none!important}';

/** One page frame. `nav: false` drops the top links (login, setup); `tv: true` adds the large read-only TV styles. */
export function shell(o: { title: string; lang: Lang; body: string; head?: string; nav?: boolean; tv?: boolean }): string {
  const L = LABELS[o.lang];
  const nav = o.nav === false ? '' : `<header class="top"><a href="/">${esc(L.home)}</a><a href="/p/tracker">${esc(L.tracker)}</a><a href="/w/">${esc(L.wiki)}</a><a href="/jobs">${esc(L.jobs)}</a></header>`;
  const tv = o.tv ? `<style id="tv">${TV_CSS}</style>` : '';
  return `<!doctype html><html lang="${o.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(o.title)}</title><style id="theme">${theme.TOKENS_CSS}</style><style>${PAGE_CSS}</style>${tv}${o.head ?? ''}</head><body>${nav}<main>${o.body}</main></body></html>`;
}
