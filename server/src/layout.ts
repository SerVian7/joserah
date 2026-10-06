import { theme } from './cjs.ts';
import { asset, ASSET_V } from './static.ts';

export function esc(s: string): string { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }

export const LABELS = {
  tr: { home: 'Ana sayfa', tracker: 'Takip', wiki: 'Bilgi', jobs: 'İşler', signin: 'Giriş', password: 'Parola', signinBtn: 'Giriş yap', wrong: 'Parola yanlış.', limited: 'Çok fazla deneme. {s} sn sonra tekrar deneyin.', signout: 'Çıkış', pages: 'Sayfalar', newJob: 'Yeni iş', send: 'Gönder', cost: 'Bugün tahmini maliyet', estimate: 'tahmin', running: 'Çalışan işler', none: 'Şu an çalışan iş yok', cancel: 'Durdur', reply: 'Yanıtla', approve: 'İzin ver ve sürdür', retry: 'Yeniden dene', changed: 'Değişen dosyalar', result: 'Sonuç', disabled: 'İş verilemiyor', search: 'Ara', claims: 'Ölçüm ve kararlar', lint: 'Denetim', log: 'Günlük', fileIt: 'Sayfa olarak kaydet', ask: 'Sor', upload: 'Dosya ekle', noTracker: 'Bugün için takip sayfası yok.', here: 'Buradayım. Şu an çalışan iş yok.', working1: 'Bir iş üzerinde çalışıyorum.', workingN: '{n} iş üzerinde çalışıyorum.', waiting1: 'Sizi bekleyen bir şey var.', waitingN: 'Sizi bekleyen {n} şey var.', offline: 'Bağlantı koptu, yeniden bağlanıyorum.', prompt: 'Ne yapayım?', kind: 'Tür', more: 've {n} tane daha', open: 'Takipte aç', now: 'Şu an', skip: 'İçeriğe geç', calm: 'Hareketi durdur', move: 'Hareketi sürdür' },
  en: { home: 'Home', tracker: 'Tracker', wiki: 'Knowledge', jobs: 'Jobs', signin: 'Sign in', password: 'Password', signinBtn: 'Sign in', wrong: 'Wrong password.', limited: 'Too many tries. Try again in {s} s.', signout: 'Sign out', pages: 'Pages', newJob: 'New job', send: 'Send', cost: "Today's estimated cost", estimate: 'estimate', running: 'Running jobs', none: 'Nothing running right now', cancel: 'Stop', reply: 'Reply', approve: 'Allow and continue', retry: 'Retry', changed: 'Changed files', result: 'Result', disabled: 'Jobs cannot start', search: 'Search', claims: 'Measurements and decisions', lint: 'Checks', log: 'Log', fileIt: 'File it as a page', ask: 'Ask', upload: 'Add a file', noTracker: 'There is no Tracker for today.', here: 'I am here. Nothing is running.', working1: 'Working on one job.', workingN: 'Working on {n} jobs.', waiting1: 'One thing waits on you.', waitingN: '{n} things wait on you.', offline: 'Connection lost. Reconnecting.', prompt: 'What should I do?', kind: 'Kind', more: 'and {n} more', open: 'Open in the Tracker', now: 'Now', skip: 'Skip to content', calm: 'Pause the motion', move: 'Resume the motion' },
} as const;
export type Lang = keyof typeof LABELS;

// Phone first: 16 px gutter, nothing wider than the screen, long words wrap (decision 9).
export const PAGE_CSS = [
  '*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}',
  'body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 var(--sans);overflow-wrap:anywhere}',
  'main{max-width:960px;margin:0 auto;padding:0 16px}',
  'img,video,iframe,table,pre{max-width:100%}pre{overflow-x:auto}table{display:block;overflow-x:auto;border-collapse:collapse}',
  'input,textarea,button,select{font:inherit;max-width:100%}textarea{width:100%}',
  'button{border:1px solid var(--line);background:var(--card);color:var(--ink);padding:8px 14px;cursor:pointer}',
  '.muted{color:var(--muted)}.err{color:var(--you)}',
].join('\n');
// TV: a large read-only view, far from the screen.
export const TV_CSS = 'html{font-size:28px}body{font-size:1rem}form.ans,button.rp,.send,input,textarea{display:none!important}';

// Before the first paint: the lifted J from an earlier visit (so the mark is solid at once), and the load sequence
// only on the first page of a visit, never with reduced motion, never on a TV.
const BOOT_JS = `(function(h){h.classList.add('js');try{var m=localStorage.getItem('jz-mask-${ASSET_V}');if(m){h.style.setProperty('--jm','url('+m+')');h.classList.add('jm')}if(!sessionStorage.getItem('jz-seen')&&!h.hasAttribute('data-tv')&&!matchMedia('(prefers-reduced-motion: reduce)').matches)h.classList.add('boot')}catch(e){}})(document.documentElement)`;
// The same for a served page under the frame: the solid J at once, no load sequence; hidden when the page is itself framed.
const FRAME_BOOT_JS = `(function(h){h.classList.add('jz-framed');try{if(self!==top)h.classList.add('jz-inframe');var m=localStorage.getItem('jz-mask-${ASSET_V}');if(m){h.style.setProperty('--jm','url('+m+')');h.classList.add('jm')}}catch(e){}})(document.documentElement)`;

/** The J, drawn from the recorded mark. `big` is the centre-stage size (sign-in, home). */
export const jmark = (cls = '') => `<span class="jmark${cls ? ` ${cls}` : ''}" aria-hidden="true"></span>`;

/** The header: the living J, the four places, the pulse that says what waits. `cls` adds `jz-frame` for a served page. */
export function topBar(lang: Lang, here?: string, cls = ''): string {
  const L = LABELS[lang];
  const words = { here: L.here, working1: L.working1, workingN: L.workingN, waiting1: L.waiting1, waitingN: L.waitingN, offline: L.offline, more: L.more, none: L.none };
  const link = (href: string, label: string) => `<a href="${href}"${here === href ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  return `<header class="jz-top${cls ? ` ${cls}` : ''}" data-words="${esc(JSON.stringify(words))}"><a class="jz-mark" href="/" aria-label="Joserah">${jmark()}</a><nav>${link('/', L.home)}${link('/p/tracker', L.tracker)}${link('/w/', L.wiki)}${link('/jobs', L.jobs)}</nav><a class="jz-pulse" href="/" hidden><i></i><span></span></a></header>`;
}

/** What a served page (Tracker, Trail, Case research, report) gets to sit inside the app: head additions, and the header. */
export function frameParts(lang: Lang, here?: string): { head: string; header: string } {
  return {
    head: `<link rel="preload" href="/_/s/fonts/sora-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="${asset('frame.css')}"><script>${FRAME_BOOT_JS}</script><script src="${asset('ui.js')}" defer></script>`,
    header: topBar(lang, here, 'jz-frame'),
  };
}

/**
 * One page frame. `nav: false` drops the top links (login, setup); `tv: true` adds the large read-only TV styles;
 * `here` marks the current link; `state` is the presence the page opens with (home knows it, others learn it live).
 */
export function shell(o: { title: string; lang: Lang; body: string; head?: string; nav?: boolean; tv?: boolean; here?: string; state?: string; bodyClass?: string }): string {
  const L = LABELS[o.lang];
  const nav = o.nav === false ? '' : topBar(o.lang, o.here);
  const tv = o.tv ? `<style id="tv">${TV_CSS}</style>` : '';
  const attrs = `lang="${o.lang}"${o.state ? ` data-state="${esc(o.state)}"` : ''}${o.tv ? ' data-tv' : ''}`;
  return `<!doctype html><html ${attrs}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#f5f3f2" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1c1819" media="(prefers-color-scheme: dark)"><title>${esc(o.title)}</title>`
    + `<link rel="preload" href="/_/s/fonts/sora-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>`
    + `<style id="theme">${theme.TOKENS_CSS}</style><style>${PAGE_CSS}</style><link rel="stylesheet" href="${asset('frame.css')}"><link rel="stylesheet" href="${asset('ui.css')}"><script>${BOOT_JS}</script>${tv}${o.head ?? ''}`
    + `<script src="${asset('ui.js')}" defer></script></head>`
    + `<body${o.bodyClass ? ` class="${esc(o.bodyClass)}"` : ''}><a class="skip" href="#main">${esc(L.skip)}</a><div id="boot" aria-hidden="true">${jmark('big')}</div>${nav}<main id="main">${o.body}</main></body></html>`;
}
