'use strict';
// The Theme: one source for every page the plugin builds (the Tracker, the Trail, the Case research, the
// Changelog). Trail spec 2026-10-05, "Theme", option A. A page carries TOKENS_CSS as <style id="theme"> and the
// base console rules first in its own console style; every render puts them back, so a change here
// reaches every page on its next render. Console look (owner, 2026-10-05: "kartlar olmasın yuvarlak
// köşeli … elit admin gibi"): no cards, no rounded corners, no shadows, hairlines, mono group heads.

// Colour tokens: light by default, dark by the system unless the page says data-theme="light", and dark
// when it says data-theme="dark". The brand's palette (owner, 2026-10-06: "Yeni yapıya göre" — the pages now
// live inside the platform's interface): burgundy #8B0D32, its dark-theme rose #d9587e, greys mixed off the
// burgundy as in .brand/report.html and .brand/mail.html, the values the platform's own pages use. The state
// colours sit with the burgundy: owner the rose family, running a muted steel blue, done a green, waiting an
// amber; each clears 4.5:1 as text on both grounds (faint, the brand's own grey, is meta text only). Sora
// first: the platform serves and declares it; a standalone page falls back to the system face, nothing embedded.
const TOKENS_CSS = [
  ':root{color-scheme:light dark;--bg:#f5f3f2;--card:#faf8f8;--line:#e3dbdd;--ink:#2a2326;--muted:#5f5458;--faint:#7a6f73;--brand:#8B0D32;--rose:#d9587e;--run:#33608c;--you:#b8325a;--ok:#2e7552;--wait:#8f5c0e;--link:#8B0D32;--sans:"Sora",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}',
  '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#1c1819;--card:#221d1f;--line:#372e31;--ink:#ddd5d7;--muted:#b3a8ab;--faint:#9a8d91;--run:#86a9d4;--you:#d9587e;--ok:#74c09a;--wait:#dba55a;--link:#e07a98}}',
  ':root[data-theme="dark"]{--bg:#1c1819;--card:#221d1f;--line:#372e31;--ink:#ddd5d7;--muted:#b3a8ab;--faint:#9a8d91;--run:#86a9d4;--you:#d9587e;--ok:#74c09a;--wait:#dba55a;--link:#e07a98;color-scheme:dark}',
  ':root[data-theme="light"]{color-scheme:light}',
].join('\n');

// The base console rules any page shares: the page's ground and type, its one-line header, the mono face, no
// radius or shadow, group heads (a plain one and a fold's summary), and the clamp — a long list shows its first
// lines, cut cleanly after the last one shown (no fade: owner, 2026-10-05, "bu altı şeffaflık durumu saçma
// sapan"), and opens in place as a bounded scroll area. Group heads stay mono capitals, tracked lighter than
// before (2026-10-06). Focus is a 2px ring; on a touch screen a control is at least 44px tall; a hover change
// only where there is a pointer that hovers. The header is styled here, not in a page's own style,
// so an older page takes it on its next render. Served inside the platform (html.jz-framed) it stays a plain
// line under the platform's header and drops its logo: the platform's J already stands on top, and the J is the
// only logo on a page. header.top is an older page's name for the same line.
const HB = ':is(header.bar,header.top)';
const BASE_CSS = [
  ':root{--mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}',
  '*,*::before,*::after{border-radius:0;box-shadow:none}',
  '*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;text-size-adjust:100%}',
  'body{margin:0;background:var(--bg);color:var(--ink);font:400 14.5px/1.55 var(--sans);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}',
  'a{color:var(--link);text-decoration-thickness:1px;text-underline-offset:3px}',
  '::selection{background:color-mix(in srgb,var(--rose) 26%,transparent)}',
  ':where(a,button,summary,input,textarea,select,[tabindex]):focus-visible{outline:2px solid var(--link);outline-offset:2px}',
  `${HB}{display:flex;align-items:center;gap:10px;min-height:44px;margin:0;padding:10px 20px;border-bottom:1px solid var(--line);font:400 12.5px/1.35 var(--sans);color:var(--muted)}`,
  `${HB} img{display:block;flex:none;height:18px;width:auto;max-width:96px}html.jz-framed ${HB} img{display:none}`,
  `${HB} .line{flex:1;min-width:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden;overflow-wrap:anywhere;font-weight:500;color:var(--ink)}`,
  `${HB} .upd{flex:none;font:400 11px var(--mono);font-variant-numeric:tabular-nums;color:var(--faint)}`,
  '.hd{display:flex;align-items:baseline;gap:8px;padding:0 0 9px;font:600 11px/1.3 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line)}',
  '.hd span{font-weight:400;letter-spacing:0;color:var(--faint);font-variant-numeric:tabular-nums}',
  'summary.hd{cursor:pointer;list-style:none}summary.hd::-webkit-details-marker{display:none}',
  'summary.hd::before{content:"\\25B8";flex:none;width:14px;letter-spacing:0;color:var(--faint)}details[open]>summary.hd::before{content:"\\25BE"}',
  'summary.hd .lt{margin-left:auto}@media (hover: hover){summary.hd:hover{color:var(--ink)}}',
  '.clip{position:relative}',
  '.clip.clamp{max-height:20rem;overflow:hidden}',
  '.clip.clamp.open{max-height:min(64vh,560px);overflow-y:auto;overscroll-behavior:contain;border-bottom:1px solid var(--line)}',
  '@media (prefers-reduced-motion: no-preference){.clip.clamp{transition:max-height .22s ease}}',
  '.more{display:flex;align-items:center;width:100%;min-height:40px;margin:0;padding:8px 0;border:0;border-bottom:1px solid var(--line);background:none;color:var(--muted);text-align:left;cursor:pointer;font:500 11.5px/1.2 var(--mono);letter-spacing:.02em}',
  '.more::before{content:"\\25BE";display:inline-block;width:14px;color:var(--faint)}',
  '.more[aria-expanded="true"]::before{content:"\\25B4"}',
  '@media (hover: hover){.more:hover{color:var(--ink)}}',
  '@media (pointer: coarse){.more,summary.hd{min-height:44px;align-items:center}}',
].join('\n');

// The clamp's script: a long list (a .clip.clamp holding an <ol>) shows its first rows whole, cut where the
// next one starts (measured; the CSS max-height stands in without script); the .more button opens it in
// place as a bounded scroll area and closes it again without moving the page.
const CLIP_JS = [
  '(function(){var N=5;function fit(c){if(c.classList.contains("open"))return;var l=c.querySelectorAll(":scope>ol>li:not(.crew-dl)");if(l.length<=N)return;var t=c.getBoundingClientRect().top,b=l[N].getBoundingClientRect().top;c.style.maxHeight=Math.round(b-t)+"px"}',
  'function all(){document.querySelectorAll(".clip.clamp").forEach(fit)}',
  'function toggle(b){var c=document.getElementById(b.getAttribute("aria-controls")),o=b.getAttribute("aria-expanded")!=="true",r=c.getBoundingClientRect(),h0=r.height;b.setAttribute("aria-expanded",String(o));c.classList.toggle("open",o);if(o){c.style.maxHeight=""}else{c.scrollTop=0;fit(c);if(r.top<0){var h1=parseFloat(c.style.maxHeight)||h0;window.scrollBy(0,h1-h0)}}b.textContent=o?b.dataset.less:b.dataset.label}',
  'document.addEventListener("click",function(e){var b=e.target.closest(".more");if(b)toggle(b)});',
  'document.addEventListener("toggle",function(e){var t=e.target;if(t.querySelectorAll)t.querySelectorAll(".clip.clamp").forEach(fit);var c=t.closest&&t.closest(".clip.clamp");if(c)fit(c)},true);',
  'var rt;window.addEventListener("resize",function(){clearTimeout(rt);rt=setTimeout(all,120)});all();window.addEventListener("load",all)})();',
].join('\n');

// Tokens and base in one block, for a page that carries them in a single style (the Trail).
const css = () => `${TOKENS_CSS}\n${BASE_CSS}`;

module.exports = { TOKENS_CSS, BASE_CSS, CLIP_JS, css };
