'use strict';
// The Theme: one source for every page the plugin builds (the Tracker, the Trail, and later templates).
// Trail spec 2026-10-05, "Theme", option A. A page carries TOKENS_CSS as <style id="theme"> and the
// base console rules first in its own console style; every render puts them back, so a change here
// reaches every page on its next render. Console look (owner, 2026-10-05: "kartlar olmasın yuvarlak
// köşeli … elit admin gibi"): no cards, no rounded corners, no shadows, hairlines, mono group heads.

// Colour tokens: light by default, dark by the system unless the page says data-theme="light", and dark
// when it says data-theme="dark".
const TOKENS_CSS = [
  ':root{color-scheme:light dark;--bg:#f6f6f5;--card:#ffffff;--line:#dcdcd9;--ink:#222222;--muted:#5c5c59;--faint:#797976;--run:#2563a8;--you:#b4232a;--ok:#2f7d55;--wait:#a8650f;--link:#2563a8;--sans:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}',
  '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#1b1b1a;--card:#242423;--line:#3a3a38;--ink:#e4e4e1;--muted:#b0b0ac;--faint:#8f8f8b;--run:#6ea8e6;--you:#ef7b80;--ok:#5fbf8f;--wait:#e0a24f;--link:#6ea8e6}}',
  ':root[data-theme="dark"]{--bg:#1b1b1a;--card:#242423;--line:#3a3a38;--ink:#e4e4e1;--muted:#b0b0ac;--faint:#8f8f8b;--run:#6ea8e6;--you:#ef7b80;--ok:#5fbf8f;--wait:#e0a24f;--link:#6ea8e6}',
].join('\n');

// The base console rules any page shares: the mono font, no radius or shadow, group heads (a plain one
// and a fold's summary), and the clamp — a long list shows its first lines, cut cleanly after the last
// one shown (no fade: owner, 2026-10-05, "bu altı şeffaflık durumu saçma sapan"), and opens in place as a
// bounded scroll area.
const BASE_CSS = [
  ':root{--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}',
  '*,*::before,*::after{border-radius:0;box-shadow:none}',
  '.hd{display:flex;align-items:baseline;gap:8px;padding:0 0 8px;font:600 10.5px/1.2 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--faint)}',
  '.hd span{font-weight:500;letter-spacing:.04em;color:var(--faint);font-variant-numeric:tabular-nums}',
  'summary.hd{cursor:pointer;list-style:none}summary.hd::-webkit-details-marker{display:none}',
  'summary.hd::before{content:"\\25B8";width:14px;letter-spacing:0;color:var(--faint)}details[open]>summary.hd::before{content:"\\25BE"}',
  'summary.hd .lt{margin-left:auto}summary.hd:hover{color:var(--ink)}summary.hd:focus-visible{outline:1px solid var(--link);outline-offset:2px}',
  '.clip{position:relative}',
  '.clip.clamp{max-height:20rem;overflow:hidden}',
  '.clip.clamp.open{max-height:min(64vh,560px);overflow-y:auto;overscroll-behavior:contain;border-bottom:1px solid var(--faint)}',
  '@media (prefers-reduced-motion: no-preference){.clip.clamp{transition:max-height .22s ease}}',
  '.more{display:block;width:100%;margin:0;padding:9px 0;border:0;border-bottom:1px solid var(--line);background:none;color:var(--muted);text-align:left;cursor:pointer;font:500 11px/1.2 var(--mono);letter-spacing:.06em}',
  '.more::before{content:"\\25BE";display:inline-block;width:14px;color:var(--faint)}',
  '.more[aria-expanded="true"]::before{content:"\\25B4"}',
  '.more:hover{color:var(--ink)}',
  '.more:focus-visible{outline:1px solid var(--link);outline-offset:2px}',
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
