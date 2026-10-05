#!/usr/bin/env node
/**
 * tracker.js — keeps a small status page (a "Tracker") from a rows.json file.
 *
 *   node tools/tracker.js init <dir> --title "<text>" [--date DD.MM.YYYY]
 *                         [--lang en|tr] [--logo <png|svg file>] [--force]
 *       Writes <dir>/index.html from templates/tracker/index.html (one small
 *       header line "<title> · <date>", date defaults to today) and
 *       <dir>/rows.json as [] if absent. Refuses, exit 1, if index.html exists
 *       unless --force. --logo copies the file next to index.html as logo.png|svg
 *       and references it by relative path (the page stays small; publish the
 *       file with it); without it the page has no logo and no wordmark.
 *
 *   node tools/tracker.js row <dir> --title "<text>" --state run|you|wait|ok|plan
 *                         [--small "<text>"] [--url <http(s)>] [--label "<text>"]
 *       [--group "<text>"]: a plan row's heading in the plans list; the Plans fold
 *       then holds one closed fold per group.
 *       Upserts ONE row by title (case and outer spaces ignored) into rows.json
 *       and re-renders; nothing has to be read first. A changed row loses its
 *       `time` and is re-stamped now; small/url/label not given are cleared.
 *       [--parent "<title>"]: the row's main job (a row title, case and outer
 *       spaces ignored); its sub-jobs form a container under it. One level only: a
 *       row with a parent cannot be a parent, nor its own. A row re-run without
 *       --parent keeps the one it had; --parent "" ungroups it. A refused row is
 *       not written.
 *
 *   node tools/tracker.js crew <dir> --role voice|lead|architect|builder|scout|sentry
 *                         --job "<text>" --state work|owner|idle
 *                         [--reason decision|sign-in|connection|approval] [--url <http(s)>]
 *                         [--model <name>] [--effort low|medium|high] [--ctx <tokens>] [--agent <id>]
 *                         [--row "<row title>"]
 *       Upserts ONE entry of the Crew strip by role + job (case and outer spaces
 *       ignored), stamps its `time` now, re-renders. reason/url not given are
 *       cleared; model, effort, ctx, agent and row carry over, and --ctx stamps `ctxTime`;
 *       `agent` is the id the hooks match the entry by (never shown).
 *       `row` names the row the entry works on (a row title, case and outer spaces
 *       ignored; an unknown one is refused; --row "" clears it): the strip line then
 *       reads "<category> · <summary>" from that row (category: its parent's title or
 *       its group; summary: its title) and opens the row's detail. Entries naming the
 *       same row share one line. An entry with no row shows its own job, no detail.
 *       In developer mode they show as a faint `model · effort · ctx @time`
 *       tail, the context figure only with its time (never estimated).
 *       rows.json then becomes { rows: [...], crew: [...] }; a legacy
 *       array is read as { rows, crew: [] } and kept an array until a crew entry
 *       exists.
 *
 *   Active work (tr "Aktif çalışma", every mode): the strip under the header is
 *       the one list of running work — run rows are never listed in the sections
 *       below. Only what is running now: crew entries in state work and run rows;
 *       an entry waiting on the owner or idle is never a strip line (what waits on
 *       the owner is the owner section's). A head with its line count (and on the
 *       right Voice's icon and each working role's, when there are crew entries),
 *       then one line per row being worked on, per working entry with no row, and
 *       per run row no working entry names (no icon, oldest first); nothing running:
 *       head count 0 and one line "Nothing running right now" / "Şu an çalışan iş
 *       yok". Every role icon carries title and aria-label saying what the role is
 *       doing (L.doing: developer mode "Builder · kod yazıyor", off "Kod yazıyor";
 *       a summary icon leads with its count, "2 · kod yazıyor"). Every
 *       line is a control: an entry with no row but a url is that link; any other
 *       line is a <button aria-expanded aria-controls> that opens its detail (the
 *       row's small text, its "sonraki:/next:" part on its own line, its links and
 *       the entries' links; with nothing more, its title) in a panel directly under that
 *       line (<li class="crew-dl">, the list's next item), one open at a time
 *       (PANEL_JS, <script id="panel"> inside the strip); without script every
 *       detail shows under its own line.
 *       Each entry carries `since` (ISO): when its state began. It is set when the
 *       state changes and kept on an update that keeps it, so a working or waiting
 *       line can say how long it has been so: its <time> carries data-since and a
 *       small inline script (SINCE_JS) turns the HH:MM into "running 7 min" /
 *       "7 dk'dır sürüyor", "waiting on you 12 min" / "12 dk'dır sizi bekliyor",
 *       every 30 s, text only; without script the HH:MM stays. `sinceState` is the
 *       state `since` belongs to: a hand edit that changes the state restarts it
 *       on the next render; an entry with no `since` starts at its own `time`,
 *       never later than now.
 *
 *   node tools/tracker.js <dir>
 *       Renders. rows.json is the FULL inventory: an array of
 *       {match?, state, title, small?, url?, label?, group?, parent?, time?}, state one of
 *       run (a background agent is working on it right now) | you (the owner's
 *       decision or action) | wait (waiting on someone outside, no AI working) |
 *       ok (done) | plan. The <ol> is rebuilt from it, so a row
 *       removed from the file disappears. A row without `time` is stamped once
 *       with the current local HH:MM and that stamp is written back to
 *       rows.json; a row with `time` keeps it. Run rows are lines of the Active
 *       work strip above the list; the sections, in this order, all open: owner
 *       (you), waiting (wait), plans (plan), done (ok); owner oldest first, the
 *       others newest first,
 *       ties keep file order, an empty section gets no heading. A plan's `group`
 *       leads its small line. Only http(s) urls become links. Rows with a
 *       `parent` form a container under their main job: a header line over the
 *       indented sub-jobs (the main row heads it when it is in the same section,
 *       otherwise its state follows the title); only a done container is a
 *       closed <details name="trk">, one open at a time. A waiting, plans or done
 *       section with more than 5 items shows its first rows and fades, with a
 *       button that opens it in place as a bounded scroll area; active sections
 *       never clamp. The console look (CONSOLE_CSS) and the clamp script
 *       (CLIP_JS) are put back last on every render, and any non-zero radius or
 *       shadow in the page's styles is stripped. Only <main>, those two blocks
 *       and the page's "updated" stamp (data-t) change. Prints `rows: N`.
 *       Exit 1 on a missing dir or rows.json, invalid JSON, unknown state, or two
 *       rows with the same title (case and outer spaces ignored): one job, one row.
 *
 * Developer mode (`devMode: true` in the workspace's .joserah/config.json, found
 * by walking up from <dir>) names the crew only as each icon's title, and adds the
 * faint model · effort tail. Off (the default, and outside any workspace) the strip
 * keeps its icons, states, counts and elapsed time but carries no role name and no
 * agent wording, in text, title or data attributes: a line is the work only. The
 * run label is "Active work" (tr "Aktif çalışma") in both modes.
 *
 * Labels follow <html lang> (en, tr). Tests may fix the clock with
 * JOSERAH_NOW=<ISO timestamp>. No dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LABELS = {
  en: { locale: 'en', none: 'Nothing running right now', doing: { voice: 'talking with you', lead: 'managing', architect: 'planning', builder: 'writing code', scout: 'researching', sentry: 'watching' }, reasons: { decision: 'decision', 'sign-in': 'sign-in', connection: 'connection', approval: 'approval' }, run: 'Active work', runPlain: 'Active work', you: 'Owner', wait: 'Waiting', plan: 'Plan', ok: 'Done', next: 'next', decide: 'decision page', groups: ['Active work', 'Owner', 'Waiting', 'Done', 'Plans'], link: 'page', other: 'Other', upd: 'updated', more: 'all', less: 'show less' },
  tr: { locale: 'tr', none: 'Şu an çalışan iş yok', doing: { voice: 'sizinle konuşuyor', lead: 'yönetiyor', architect: 'planlıyor', builder: 'kod yazıyor', scout: 'araştırıyor', sentry: 'izliyor' }, reasons: { decision: 'karar', 'sign-in': 'oturum açma', connection: 'bağlantı', approval: 'onay' }, run: 'Aktif çalışma', runPlain: 'Aktif çalışma', you: 'Sizde', wait: 'Beklemede', plan: 'Plan', ok: 'Bitti', next: 'sonraki', decide: 'karar sayfası', groups: ['Aktif çalışma', 'Sizde', 'Beklemede', 'Bitenler', 'Planlar'], link: 'sayfa', other: 'Diğer', upd: 'güncelleme', more: 'tümü', less: 'daralt' },
};
const GROUP = { run: 0, you: 1, wait: 2, ok: 3, plan: 4 };
const { findWorkspace, readConfig } = require('../hooks/lib/workspace');

const CREW_ROLES = ['voice', 'lead', 'architect', 'builder', 'scout', 'sentry'];
const CREW_STATES = ['work', 'owner', 'idle'];
const CREW_REASONS = ['decision', 'sign-in', 'connection', 'approval'];
const CREW_EFFORTS = ['low', 'medium', 'high'];
const { ICONS } = require('./lib/crew-icons');
const ROLE_NAME = { voice: 'Voice', lead: 'Lead', architect: 'Architect', builder: 'Builder', scout: 'Scout', sentry: 'Sentry' };
// The strip's look, theme tokens only (owner, 2026-10-05: calm, no new hues): icons in the muted text
// token; working pulses slowly; owner takes the page's owner colour; idle is dimmed; reduced motion,
// no pulse. The template carries the same line; a page made before the strip gets it once.
const CREW_CSS = '.crew{padding:8px 0 6px;border-bottom:1px solid var(--line)}'
  + '.crew-sum{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:2px 0 6px}'
  + '.crew-sum span{display:inline-flex;align-items:center;gap:2px;font-size:12px;font-variant-numeric:tabular-nums;color:var(--muted)}'
  + '.crew svg{width:18px;height:18px;flex:none;color:var(--muted)}'
  + '.crew ul{list-style:none;margin:0;padding:0}'
  + '.crew li.crew-line{display:flex;align-items:center;gap:8px;padding:3px 0;margin:0;background:none;border:0;border-radius:0;font-size:13px}'
  + '.crew-line span{flex:1;min-width:0;overflow-wrap:anywhere}.crew-line a{color:inherit}'
  + '.crew-line em{font-style:normal;color:var(--you)}'
  + '.crew-line.work svg,.crew-sum .work svg{animation:crew-pulse 2.4s ease-in-out infinite}'
  + '.crew-line.owner svg{color:var(--you)}.crew-sum .owner svg{color:var(--you)}'
  + '.crew-line.idle,.crew-sum .idle{opacity:.5}'
  + '@keyframes crew-pulse{50%{opacity:.4}}'
  + '@media (prefers-reduced-motion: reduce){.crew-line.work svg,.crew-sum .work svg{animation:none}}';

// Active work (owner, 2026-10-05: "Ajan çalışıyor, kısmını aktif çalışma gibi yapalım ben yukarıdan
// tıklayınca aşağıyı doldursun … önce işin kategori ismi sonra kısa özet gibi. net yalın olsun."): the
// strip is a section like the others — a head with its count and the icon summary on the right — and
// the one list of running work. A line reads "<category> · <summary>"; a line with a detail is a real
// button (the whole line is its target) that opens the detail in one panel under the lines, one at a
// time. Without script every detail shows, each under its own title. Theme tokens only.
const STRIP_CSS = [
  'section.crew{padding:0;border:0}',
  '.crew .hd{flex-wrap:wrap}',
  '.crew .hd .crew-sum{display:flex;flex-wrap:wrap;margin-left:auto;gap:14px;padding:0;border:0;letter-spacing:0}',
  '.crew-sum span{font:500 11px var(--mono);font-variant-numeric:tabular-nums;gap:4px}',
  '.crew svg{width:16px;height:16px}',
  '.crew li.crew-line{position:relative;display:grid;grid-template-columns:minmax(16px,auto) minmax(0,1fr) minmax(46px,auto);gap:0 12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);font-size:13.5px}',
  '.crew .ic,.crew .ic>span{display:inline-flex;flex:none;align-items:center;gap:4px;min-width:0}',
  '.crew .tx{min-width:0;overflow-wrap:anywhere;color:var(--ink)}.crew .ct{color:var(--muted)}',
  '.crew button.tx{display:block;width:100%;margin:0;padding:0;border:0;background:none;font:inherit;text-align:left;cursor:pointer}',
  '.crew a.tx{display:block;text-decoration:none}',
  '.crew button.tx::before,.crew a.tx::before{content:"\\25B8";display:inline-block;width:14px;font:500 11px var(--mono);color:var(--faint)}',
  '.crew button.tx[aria-expanded="true"]::before{content:"\\25BE"}.crew a.tx::before{content:"\\2197"}',
  '.crew .tx::after{content:"";position:absolute;inset:0}',
  '.crew li.crew-line:hover .tx,.crew button.tx[aria-expanded="true"]{color:var(--link)}',
  '.crew .tx:focus-visible{outline:1px solid var(--link);outline-offset:2px}',
  '.crew li.crew-line>time{order:0;align-self:center;text-align:right;font:500 11px var(--mono);font-variant-numeric:tabular-nums;color:var(--faint);white-space:nowrap}',
  '.crew-line .cm{display:inline;margin:0 0 0 8px;font:500 11px var(--mono);letter-spacing:.02em;color:var(--faint);white-space:nowrap}.crew-line .cm i{font-style:normal}',
  '.crew li.crew-dl{display:block;margin:0 0 0 2px;padding:0 0 0 16px;border-left:1px solid var(--line)}.crew .cd{padding:10px 0 12px 24px;border-bottom:1px solid var(--faint);font:400 12.5px/1.5 var(--sans);color:var(--muted)}',
  '.cd>b{display:block;font:500 13px/1.45 var(--sans);color:var(--ink)}.crew.js .cd:not(.bare)>b{display:none}',
  '.cd p{margin:2px 0 0;overflow-wrap:anywhere}.cd a{color:var(--link)}',
  '.cd .nx span{margin-right:6px;font:600 10.5px var(--mono);letter-spacing:.07em;text-transform:uppercase;color:var(--faint)}',
  '.cd[hidden]{display:none}',
  '.crew li.crew-none{display:block;padding:8px 0;border-bottom:1px solid var(--line);font-size:13.5px;color:var(--muted)}',
  // phone width: icons and elapsed time on the top line, the text under them (as the rows below)
  '@media (max-width:560px){.crew li.crew-line{grid-template-columns:minmax(16px,auto) minmax(0,1fr);grid-template-areas:"i t" "x x";gap:4px 12px}.crew li.crew-line>.ic{grid-area:i}.crew li.crew-line>.tx{grid-area:x}.crew li.crew-line>time{grid-area:t}.crew li.crew-dl{padding-left:12px}.crew .cd{padding-left:0}}',
];
// The panel: with script, every detail starts closed; a line's button opens its own and closes the
// others; a second click closes it. aria-expanded follows; no scrolling, focus stays on the button.
const PANEL_JS = '(function(){var s=document.querySelector("section.crew");if(!s)return;var bs=s.querySelectorAll("button.tx");if(!bs.length)return;s.classList.add("js");'
  + 'function set(b,o){b.setAttribute("aria-expanded",String(o));var d=document.getElementById(b.getAttribute("aria-controls"));if(d)d.hidden=!o}'
  + 'Array.prototype.forEach.call(bs,function(b){set(b,false)});'
  + 's.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("button.tx");if(!b)return;var o=b.getAttribute("aria-expanded")!=="true";'
  + 'Array.prototype.forEach.call(bs,function(x){if(x!==b)set(x,false)});set(b,o)})})();';

// Console look (owner, 2026-10-05: "kartlar olmasın yuvarlak köşeli … elit admin gibi"): no cards, no
// rounded corners, no shadows; hairline rows, a mono state tag with a thin left mark, a tabular
// right-aligned time column; a main job is a container (header line over indented children); a long
// list shows its first rows, fades, and opens in place as a bounded scroll area. Theme tokens only.
// The template carries it as <style id="console"> and every render puts it back last, so it wins over
// a page's older styles and a re-render reproduces it exactly. The strip's console layout is here too.
const CONSOLE_CSS = [
  ':root{--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}',
  '*,*::before,*::after{border-radius:0;box-shadow:none}',
  'main{display:grid;gap:28px;max-width:820px;margin:0 auto;padding:22px 16px 56px}',
  'main ol{list-style:none;margin:0;padding:0}',
  'main li{margin:0;padding:0;background:none;border:0}',
  'main>ol{display:grid;gap:28px}',
  'li.sec,li.job,li.grp{display:block}',
  '.hd{display:flex;align-items:baseline;gap:8px;padding:0 0 8px;font:600 10.5px/1.2 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--faint)}',
  '.hd span{font-weight:500;letter-spacing:.04em;color:var(--faint);font-variant-numeric:tabular-nums}',
  'li[data-st]{display:grid;grid-template-columns:120px minmax(0,1fr) 46px;gap:0 16px;align-items:baseline;padding:9px 0 10px;border-bottom:1px solid var(--line)}',
  'li[data-st]>div{min-width:0;overflow-wrap:anywhere}',
  'li[data-st] b{display:block;font:500 14px/1.45 var(--sans);color:var(--ink)}',
  'li[data-st] small,.jt small{display:block;margin-top:2px;font:400 12.5px/1.5 var(--sans);color:var(--muted);overflow-wrap:anywhere}',
  'li[data-st] small a,.jt small a{color:var(--link)}',
  'li[data-st] time{align-self:baseline;text-align:right;font:500 11px/1.4 var(--mono);font-variant-numeric:tabular-nums;color:var(--faint);white-space:nowrap}',
  '.s{justify-self:start;min-width:0;padding-left:7px;border-left:2px solid currentColor;font:600 10.5px/1.25 var(--mono);letter-spacing:.07em;text-transform:uppercase;white-space:nowrap}',
  '.s.run{color:var(--run)}.s.you{color:var(--you)}.s.ok{color:var(--ok)}.s.wait,.s.plan{color:var(--wait)}',
  '.jh,li.grp>details>summary{display:grid;grid-template-columns:14px minmax(0,1fr) auto;align-items:baseline;padding:10px 0 9px;border-bottom:1px solid var(--line);font:600 13.5px/1.4 var(--sans);color:var(--ink)}',
  '.jh::before{content:"";width:5px;height:5px;align-self:center;background:var(--faint)}',
  '.jt{min-width:0;overflow-wrap:anywhere}.jt em{font-style:normal;font-weight:400;color:var(--faint)}',
  'li.grp>details>summary{cursor:pointer;list-style:none}',
  'li.grp>details>summary::-webkit-details-marker{display:none}',
  'li.grp>details>summary::before{content:"\\25B8";font:500 11px var(--mono);color:var(--faint)}',
  'li.grp>details[open]>summary::before{content:"\\25BE"}',
  'li.grp>details>summary:hover .jt{color:var(--link)}',
  '.jh>span:last-child,li.grp>details>summary>span:last-child{padding-left:12px;font:500 11px var(--mono);font-variant-numeric:tabular-nums;color:var(--faint);white-space:nowrap}',
  'li.job>ol,li.grp>details>ol{margin:0 0 0 2px;padding-left:16px;border-left:1px solid var(--line)}',
  'li.job>ol>li[data-st],li.grp>details>ol>li[data-st]{grid-template-columns:102px minmax(0,1fr) 46px;padding:7px 0 8px}',
  'li.job>ol>li[data-st] b,li.grp>details>ol>li[data-st] b{font-weight:400;font-size:13.5px}',
  'li.job>ol>li[data-st] small,li.grp>details>ol>li[data-st] small{font-size:12px}',
  'li.job>ol>li[data-st] .s,li.grp>details>ol>li[data-st] .s{font-size:10px;opacity:.85}',
  '.clip{position:relative}',
  '.clip.clamp{max-height:20rem;overflow:hidden}',
  '.clip.clamp.open{max-height:min(64vh,560px);overflow-y:auto;overscroll-behavior:contain;border-bottom:1px solid var(--faint)}',
  '@media (prefers-reduced-motion: no-preference){.clip.clamp{transition:max-height .22s ease}}',
  '.fade{position:relative;height:64px;margin-top:-64px;background:linear-gradient(to bottom,transparent,var(--bg) 88%);cursor:pointer}',
  '.clip.open+.fade{display:none}',
  '.more{display:block;width:100%;margin:0;padding:9px 0;border:0;border-bottom:1px solid var(--line);background:none;color:var(--muted);text-align:left;cursor:pointer;font:500 11px/1.2 var(--mono);letter-spacing:.06em}',
  '.more::before{content:"\\25BE";display:inline-block;width:14px;color:var(--faint)}',
  '.more[aria-expanded="true"]::before{content:"\\25B4"}',
  '.more:hover{color:var(--ink)}',
  '.more:focus-visible,li.grp>details>summary:focus-visible{outline:1px solid var(--link);outline-offset:2px}',
  ...STRIP_CSS,
  '@media (max-width:560px){main{gap:24px}main>ol{gap:24px}.crew-line .cm i{display:none}'
    + 'li[data-st],li.job>ol>li[data-st],li.grp>details>ol>li[data-st]{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"s t" "b b";gap:3px 12px}'
    + 'li[data-st]>.s{grid-area:s}li[data-st]>div{grid-area:b}li[data-st]>time{grid-area:t}li.job>ol,li.grp>details>ol{padding-left:12px}}',
].join('\n');
// The clamp: a long list shows its first rows plus a slice of the next (measured; a CSS max-height
// stands in without script); the button, or a click on the fade, opens it in place as a bounded scroll
// area and closes it again without moving the page; focus stays on the button.
const CLIP_JS = [
  '(function(){var N=5;function fit(c){if(c.classList.contains("open"))return;var l=c.querySelectorAll(":scope>ol>li");if(l.length<=N)return;var t=c.getBoundingClientRect().top,b=l[N-1].getBoundingClientRect().bottom,n=l[N].getBoundingClientRect().height;c.style.maxHeight=Math.round(b-t+Math.min(30,n/2))+"px"}',
  'function all(){document.querySelectorAll(".clip.clamp").forEach(fit)}',
  'function toggle(b){var c=document.getElementById(b.getAttribute("aria-controls")),o=b.getAttribute("aria-expanded")!=="true",r=c.getBoundingClientRect(),h0=r.height;b.setAttribute("aria-expanded",String(o));c.classList.toggle("open",o);if(o){c.style.maxHeight=""}else{c.scrollTop=0;fit(c);if(r.top<0){var h1=parseFloat(c.style.maxHeight)||h0;window.scrollBy(0,h1-h0)}}b.textContent=o?b.dataset.less:b.dataset.label}',
  'document.addEventListener("click",function(e){var b=e.target.closest(".more");if(b){toggle(b);return}var f=e.target.closest(".fade");if(f){var m=f.parentNode.querySelector(".more");if(m)toggle(m)}});',
  'document.addEventListener("toggle",function(e){var c=e.target.closest&&e.target.closest(".clip.clamp");if(c)fit(c)},true);',
  'var rt;window.addEventListener("resize",function(){clearTimeout(rt);rt=setTimeout(all,120)});all();window.addEventListener("load",all)})();',
].join('\n');
const CLAMP = 5;
// The strip's elapsed time (owner, 2026-10-05: "10 dk dır hiçbir şey olmadı mı abi?"): a working or
// waiting line's <time data-since> reads how long it has been in that state, from the page's own clock,
// every 30 s, without a republish. Text only; the HH:MM moves to the title; without script it stays.
const SINCE_JS = '(function(){var tr=document.documentElement.lang==="tr";'
  + 'function txt(m,o){if(m<1)return tr?"az önce":"just now";var h=Math.floor(m/60),r=m%60,q=tr?(h?h+" sa "+r+" dk":m+" dk"):(h?h+" h "+r+" min":m+" min");'
  + 'return tr?q+"\'dır "+(o?"sizi bekliyor":"sürüyor"):(o?"waiting on you ":"running ")+q}'
  + 'function tick(){var n=Date.now();Array.prototype.forEach.call(document.querySelectorAll(".crew-line>time[data-since]"),function(t){var s=Date.parse(t.getAttribute("data-since"));if(isNaN(s))return;'
  + 'if(!t.title)t.title=t.textContent;t.textContent=txt(Math.max(0,Math.floor((n-s)/60000)),t.parentNode.classList.contains("owner"))})}'
  + 'tick();setInterval(tick,30000)})();';

// Developer mode decides only whether the owner sees the crew; no workspace → off.
function devModeFor(dir) {
  const root = findWorkspace(dir);
  const cfg = root && readConfig(root);
  return !!(cfg && cfg.devMode === true);
}

// A refusal throws; the CLI prints it and exits 1, a caller (hooks/crew.js) catches it.
class Refused extends Error {}
const die = (msg) => { throw new Refused(msg); };
const now = () => (process.env.JOSERAH_NOW ? new Date(process.env.JOSERAH_NOW) : new Date());
const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const key = (t) => String(t ?? '').trim().toLowerCase();
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') opt.force = true;
    else if (/^--(title|date|lang|logo|state|small|url|label|group|role|job|reason|parent|model|effort|ctx|agent|row)$/.test(a)) opt[a.slice(2)] = argv[++i];
    else if (a.startsWith('--')) die(`unknown option ${a}`);
    else pos.push(a);
  }
  return { pos, opt };
}

function init(dir, opt) {
  if (!dir) die('usage: tracker.js init <dir> --title "<text>" [--date DD.MM.YYYY] [--lang en|tr] [--logo file] [--force]');
  if (!opt.title) die('--title is required');
  const lang = opt.lang || 'en';
  if (!LABELS[lang]) die(`unknown language ${lang} (en or tr)`);
  const out = path.join(dir, 'index.html');
  if (fs.existsSync(out) && !opt.force) die(`${out} already exists (use --force to overwrite)`);
  const d = now();
  const date = opt.date || `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  let logo = '';
  if (opt.logo) {
    const ext = path.extname(opt.logo).toLowerCase();
    if (!['.png', '.svg'].includes(ext)) die('--logo must be a .png or .svg file');
    let buf;
    try { buf = fs.readFileSync(opt.logo); } catch (e) { die(`cannot read logo ${opt.logo}`); }
    const name = `logo${ext}`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buf);
    logo = `<img alt="" src="${name}">`;
  }
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'templates', 'tracker', 'index.html'), 'utf8');
  const line = `${opt.title} · ${date}`;
  const html = tpl
    .replace('<html lang="en">', () => `<html lang="${lang}">`)
    .replace('<title>Tracker</title>', () => `<title>${esc(line)}</title>`)
    .replace('<!--tracker:logo-->', () => logo)
    .replace('<!--tracker:line-->', () => esc(line));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(out, html);
  const rows = path.join(dir, 'rows.json');
  if (!fs.existsSync(rows)) fs.writeFileSync(rows, '[]\n');
  console.log(`tracker: wrote ${out}`);
}

// rows.json is either the legacy array of rows or { rows: [...], crew: [...] }.
function readStore(rowsPath) {
  let j;
  try { j = JSON.parse(fs.readFileSync(rowsPath, 'utf8')); } catch (e) { die(`rows.json is not valid JSON: ${e.message}`); }
  if (Array.isArray(j)) return { rows: j, crew: [] };
  if (!j || typeof j !== 'object' || !Array.isArray(j.rows) || (j.crew !== undefined && !Array.isArray(j.crew))) {
    die('rows.json must be an array, or an object with a "rows" array and a "crew" array');
  }
  return { rows: j.rows, crew: j.crew || [] };
}

// the legacy array shape is kept until a crew entry exists
function writeStore(rowsPath, store) {
  const data = store.crew.length ? { rows: store.rows, crew: store.crew } : store.rows;
  fs.writeFileSync(rowsPath, JSON.stringify(data, null, 1) + '\n');
}

function checkCrew(e, where) {
  if (!e || !CREW_ROLES.includes(e.role)) die(`${where}: unknown role "${e && e.role}" (${CREW_ROLES.join('|')})`);
  if (!CREW_STATES.includes(e.state)) die(`${where}: unknown state "${e.state}" (${CREW_STATES.join('|')})`);
  if (e.reason !== undefined && !CREW_REASONS.includes(e.reason)) die(`${where}: unknown reason "${e.reason}" (${CREW_REASONS.join('|')})`);
  if (!String(e.job ?? '').trim()) die(`${where}: a job is required`);
  // model, effort and context are shown only as reported, never estimated; a context figure needs the time it was reported
  if (e.model !== undefined && !/^[\w.:[\]-]{1,40}$/.test(e.model)) die(`${where}: bad model "${e.model}"`);
  if (e.effort !== undefined && !CREW_EFFORTS.includes(e.effort)) die(`${where}: unknown effort "${e.effort}" (${CREW_EFFORTS.join('|')})`);
  if (e.ctx !== undefined && !(Number.isInteger(e.ctx) && e.ctx > 0)) die(`${where}: ctx must be a positive whole number of tokens`);
  if (e.ctxTime !== undefined && !/^\d\d:\d\d$/.test(e.ctxTime)) die(`${where}: ctxTime must be HH:MM`);
  // the agent id the hooks match an entry by (never shown on the page)
  if (e.agent !== undefined && !/^[\w-]{1,80}$/.test(e.agent)) die(`${where}: bad agent id "${e.agent}"`);
  // the row the entry works on (a row title): its category, summary and detail come from that row
  if (e.row !== undefined && (typeof e.row !== 'string' || !e.row.trim())) die(`${where}: row must be a row title`);
}

// A row's `parent` names its main job's row: it must exist, must not be the row itself, and must not
// have a parent of its own (one level only).
const hasParent = (r) => !!(r && key(r.parent));
function checkParents(rows) {
  rows.forEach((r, i) => {
    if (!hasParent(r)) return;
    if (key(r.parent) === key(r.title)) die(`row ${i + 1}: "${r.title}" cannot be its own parent`);
    const main = rows.find((x) => x && key(x.title) === key(r.parent));
    if (!main) die(`row ${i + 1}: parent "${r.parent}" is not a row`);
    if (hasParent(main)) die(`row ${i + 1}: one level only (parent "${r.parent}" has a parent itself)`);
  });
}

// summary: Voice first, then one icon per role with an entry, a count when 2+ of it are working or
// waiting on the owner; then one line per entry: icon, "<Role> · <job>", the reason when owner.
// Developer mode off (owner, 2026-10-05: "ajan dememeli ve ajan isimleri olmamalı. ikonları
// kalabilir."): the same icons, states and counts, but no role name anywhere — no "<Role> ·",
// no title, no data-role — so a line is the work only.
// Developer mode only: a faint `model · effort · ctx @time` after the line, as reported; the context
// figure only with the time it was reported (never estimated), and at phone width it moves to the title.
// Several entries on one line (one row): their tails one after another, " / " between them.
function crewTail(es) {
  const parts = es.map((e) => {
    const me = [e.model, e.effort].filter(Boolean).map(esc).join(' · ');
    const cx = e.ctx && e.ctxTime ? `${e.ctx >= 1000 ? Math.round(e.ctx / 1000) + 'k' : e.ctx} @${esc(e.ctxTime)}` : '';
    return { full: [me, cx].filter(Boolean).join(' · '), inline: `${me}${cx ? `<i>${me ? ' · ' : ''}${cx}</i>` : ''}` };
  }).filter((x) => x.full);
  return parts.length ? ` <small class="cm" title="${parts.map((x) => x.full).join(' / ')}">${parts.map((x) => x.inline).join(' / ')}</small>` : '';
}

// a working or waiting line's time carries when that state began; the script reads it as elapsed time
const ticks = (e) => (e.state === 'work' || e.state === 'owner') && !!e.since;
const elapsedTime = (e) => `<time${ticks(e) ? ` data-since="${esc(e.since)}"` : ''}>${esc(e.time)}</time>`;

// `since`: when the entry's state began. A missing one starts at the entry's own HH:MM today, never
// later than now; one that belongs to another state (a hand edit changed it) restarts now.
function stampSince(e, clock) {
  if (e.since && e.sinceState === e.state) return false;
  let at = clock;
  const m = !e.since && /^(\d\d):(\d\d)$/.exec(String(e.time || ''));
  if (m) { const d = new Date(clock); d.setHours(+m[1], +m[2], 0, 0); if (d <= clock) at = d; }
  e.since = at.toISOString(); e.sinceState = e.state;
  return true;
}

const isUrl = (u) => /^https?:\/\//i.test(String(u || ''));
// A row's detail: its small text, the next step ("sonraki: …" / "next: …" parts of the small line) on
// its own line, and its links (the row's, then each entry's). Empty when there is nothing to show.
// (Lines waiting on the owner are no longer strip lines, owner 2026-10-05, so no detail leads with a
// decision link any more.)
function detailOf(r, es, L) {
  const parts = String((r && r.small) || '').split(' · ').map((x) => x.trim()).filter(Boolean);
  const nextRe = /^(sonraki|next)\s*:\s*/i;
  const rest = parts.filter((x) => !nextRe.test(x)).join(' · ');
  const next = parts.filter((x) => nextRe.test(x)).map((x) => x.replace(nextRe, '')).filter(Boolean);
  const urls = [];
  if (r && isUrl(r.url)) urls.push([r.url, r.label || L.link]);
  for (const e of es) if (isUrl(e.url) && !urls.some(([u]) => u === e.url)) urls.push([e.url, L.link]);
  if (!rest && !next.length && !urls.length) return '';
  return (rest ? `<p>${esc(rest)}</p>` : '')
    + next.map((x) => `<p class="nx"><span>${esc(L.next)}</span> ${esc(x)}</p>`).join('')
    + (urls.length ? `<p class="ln">${urls.map(([u, l]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`).join(' · ')}</p>` : '');
}

// The Active work strip, the one list of running work (owner, 2026-10-05): one line per row being
// worked on — the crew entries that name that row (`row`) share its line, their icons side by side —
// then one line per entry that names no row (its own job, no detail), then every running row no entry
// names (no icon, oldest first), so nothing running is hidden. Developer mode on: the role is only the
// icon's title, and a faint model · effort tail follows; off: icons and elapsed time only, no role name
// anywhere (owner, 2026-10-05: "ajan dememeli ve ajan isimleri olmamalı. ikonları kalabilir.").
// Only what is running (owner, 2026-10-05: "şu an çalışan bir şey var mı anlamıyorum hepsi beni bekliyor
// galiba"): entries waiting on the owner or idle are left out, so every line reads as running; with
// nothing running the strip says so in one line. Each role icon says what the role is doing ("ikonların
// üstüne gelince planning gibi anlaşılır şeyler yazsın"), as title and aria-label.
function activeStrip(crew, rows, L, dev = true) {
  const byTitle = new Map(rows.map((r) => [key(r.title), r]));
  const working = crew.filter((e) => e.state === 'work');
  const act = (role) => (L.doing || LABELS.en.doing)[role];
  const cap = (s) => s.charAt(0).toLocaleUpperCase(L.locale || 'en') + s.slice(1);
  const tip = (role, n) => {
    const t = dev ? `${ROLE_NAME[role]} · ${act(role)}` : (n ? act(role) : cap(act(role)));
    const s = esc(n ? `${n} · ${t}` : t);
    return ` role="img" title="${s}" aria-label="${s}"`;
  };
  const items = []; const byRow = new Map();
  for (const e of working) {
    const r = key(e.row) ? byTitle.get(key(e.row)) : null;
    if (!r) { items.push({ r: null, es: [e] }); continue; }
    if (!byRow.has(r)) { const it = { r, es: [] }; byRow.set(r, it); items.push(it); }
    byRow.get(r).es.push(e);
  }
  rows.map((r, i) => ({ r, i })).filter(({ r }) => r.state === 'run' && !byRow.has(r))
    .sort((a, b) => String(a.r.time).localeCompare(String(b.r.time)) || a.i - b.i)
    .forEach(({ r }) => items.push({ r, es: [] }));
  // the summary: Voice, then each role with working entries, its count in the icon's text
  const sum = crew.length ? `<div class="crew-sum">${CREW_ROLES.filter((r) => r === 'voice' || working.some((e) => e.role === r)).map((r) => {
    const n = working.filter((e) => e.role === r).length;
    return `<span${n ? ' class="work"' : ''}${dev ? ` data-role="${r}"` : ''}${n >= 2 ? ` data-count="${n}"` : ''}${tip(r, n)}>${ICONS[r]}${n >= 2 ? n : ''}</span>`;
  }).join('')}</div>` : '';
  const head = `<div class="hd">${esc(L.groups[GROUP.run])} <span>${items.length}</span>${sum}</div>`;
  if (!items.length) return `${head}<ul>\n  <li class="crew-none">${esc(L.none || LABELS.en.none)}</li>\n</ul>`;
  const details = [];
  const lines = items.map(({ r, es }) => {
    const st = es.length ? 'work' : 'run';
    // category: the row's main job (its parent row's title) or its group; summary: the row's title
    const main = r && hasParent(r) ? byTitle.get(key(r.parent)) : null;
    const cat = r ? (main ? main.title : String(r.parent || r.group || '').trim()) : '';
    const sumText = r ? r.title : es[0].job;
    const text = `${cat ? `<span class="ct">${esc(cat)} ·</span> ` : ''}${esc(sumText)}`;
    const tail = dev ? crewTail(es) : '';
    const icons = es.map((e) => `<span${tip(e.role, 0)}>${ICONS[e.role]}</span>`).join('');
    // the line's time: its latest change; a working or waiting line counts from the earliest start in that state
    let time = `<time>${esc(r ? r.time : '')}</time>`;
    if (es.length) {
      const inSt = es.filter((e) => e.state === st && e.since).map((e) => e.since).sort();
      time = elapsedTime({ state: st, since: inSt[0], time: es.map((e) => String(e.time)).sort().pop() });
    }
    // every line is a control (Lead, 2026-10-05): a row's line opens its panel; an entry with no row
    // but a url is the link itself; anything else opens a panel that shows at least its title
    let body; let panel = '';
    if (!r && isUrl(es[0].url)) {
      body = `<a class="tx" href="${esc(es[0].url)}" target="_blank" rel="noopener">${text}${tail}</a>`;
    } else {
      const d = r ? detailOf(r, es, L) : '';
      const id = `cd-${details.length + 1}`;
      details.push(id);
      panel = `  <li class="crew-dl"><div class="cd${d ? '' : ' bare'}" id="${id}"><b>${cat ? `${esc(cat)} · ` : ''}${esc(sumText)}</b>${d}</div></li>\n`;
      body = `<button type="button" class="tx" aria-expanded="false" aria-controls="${id}">${text}${tail}</button>`;
    }
    // the detail is the list's next item after its own line, so it opens right under the line clicked
    // (owner, 2026-10-05: one shared panel after the list opened every detail under the last line)
    return `  <li class="crew-line ${st}"${dev && es.length ? ` data-role="${es[0].role}"` : ''}><span class="ic">${icons}</span>${body}${time}</li>\n${panel}`;
  }).join('');
  return `<div class="hd">${esc(L.groups[GROUP.run])} <span>${items.length}</span>${sum}</div><ul>\n${lines}</ul>`
    // the panel script sits in the strip, after the list, so the strip is self-contained inside <main>
    + (details.length ? `<script id="panel">${PANEL_JS}</script>` : '');
}

function render(dir, { quiet = false } = {}) {
  const pagePath = path.join(dir, 'index.html');
  const rowsPath = path.join(dir, 'rows.json');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) die(`${dir} is not a directory`);
  if (!fs.existsSync(pagePath)) die(`${pagePath} not found (run init first)`);
  if (!fs.existsSync(rowsPath)) die(`${rowsPath} not found`);
  const store = readStore(rowsPath);
  const { rows, crew } = store;
  let html = fs.readFileSync(pagePath, 'utf8');
  const base = LABELS[(html.match(/<html[^>]*\blang="(\w+)"/) || [])[1]] || LABELS.en;
  const dev = devModeFor(dir);
  const L = dev ? base : { ...base, run: base.runPlain, groups: [base.runPlain, ...base.groups.slice(1)] };
  const clock = now();
  let stamped = false;
  rows.forEach((r, i) => {
    if (!r || !Object.prototype.hasOwnProperty.call(GROUP, r.state)) die(`row ${i + 1}: unknown state "${r && r.state}"`);
    if (r.time === undefined || r.time === null || r.time === '') { r.time = hm(clock); stamped = true; }
  });
  crew.forEach((e, i) => {
    checkCrew(e, `crew ${i + 1}`);
    if (e.time === undefined || e.time === null || e.time === '') { e.time = hm(clock); stamped = true; }
    if (stampSince(e, clock)) stamped = true;
  });
  const seen = new Set();
  rows.forEach((r, i) => {
    const k = String(r.title ?? '').trim().toLowerCase();
    if (k && seen.has(k)) die(`row ${i + 1}: duplicate title "${r.title}" (one job, one row: change the existing row)`);
    seen.add(k);
  });
  checkParents(rows);
  // active sections (in progress, owner) oldest first; the long lists (waiting, done, plans) newest first
  const NEWEST = [GROUP.wait, GROUP.ok, GROUP.plan];
  const sorted = rows.map((r, i) => ({ r, i, g: GROUP[r.state] }))
    .sort((a, b) => a.g - b.g || (NEWEST.includes(a.g) ? -1 : 1) * String(a.r.time).localeCompare(String(b.r.time)) || a.i - b.i);
  // a row's main job (its `parent`, resolved to that row)
  const byTitle = new Map(rows.map((r) => [key(r.title), r]));
  const mainOf = (r) => (hasParent(r) ? byTitle.get(key(r.parent)) : null);
  const smallOf = (r) => {
    const link = /^https?:\/\//i.test(String(r.url || ''))
      ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label || L.link)}</a>` : '';
    // a plan's group (its heading in the plans list) leads the small line
    return [r.state === 'plan' && r.group ? esc(r.group) : '', r.small ? esc(r.small) : '', link].filter(Boolean).join(' · ');
  };
  const li = (r) => {
    const small = smallOf(r);
    return `<li data-st="${r.state}"><span class="s ${r.state}">${L[r.state]}</span><div><b>${esc(r.title)}</b>${small ? `<small>${small}</small>` : ''}</div><time>${esc(r.time)}</time></li>`;
  };
  // One section's top-level items: a row, or a container — a main job's header line over its sub-jobs,
  // indented. The main row heads its container when it is in the same section; otherwise the header
  // carries its state. A container sorts by its newest row. Only a finished (done) container is a
  // <details>, closed, one open at a time; active and waiting ones never fold.
  const units = (it, g) => {
    const subsOf = new Map();
    for (const x of it) { const m = mainOf(x.r); if (m) { if (!subsOf.has(m)) subsOf.set(m, []); subsOf.get(m).push(x); } }
    const headOf = new Map(it.filter((x) => subsOf.has(x.r)).map((x) => [x.r, x]));
    const out = []; const done = new Set();
    for (const x of it) {
      const m = mainOf(x.r) || (subsOf.has(x.r) ? x.r : null);
      if (!m) { out.push({ t: String(x.r.time), i: x.i, html: li(x.r) }); continue; }
      if (done.has(m)) continue;
      done.add(m);
      const subs = subsOf.get(m); const head = headOf.get(m);
      const all = head ? [head, ...subs] : subs;
      const t = all.map((y) => String(y.r.time)).sort().pop();
      const note = head ? smallOf(m) : '';
      const jt = `<span class="jt">${esc(m.title)}${head ? '' : ` <em>· ${L[m.state]}</em>`}${note ? `<small>${note}</small>` : ''}</span>`;
      const meta = `<span>${subs.length} · ${esc(t)}</span>`;
      const kids = `<ol>${subs.map((y) => li(y.r)).join('')}</ol>`;
      out.push({ t, i: Math.min(...all.map((y) => y.i)), html: g === GROUP.ok
        ? `<li class="grp"><details name="trk"><summary>${jt}${meta}</summary>${kids}</details></li>`
        : `<li class="job"><div class="jh">${jt}${meta}</div>${kids}</li>` });
    }
    return out.sort((a, b) => (NEWEST.includes(g) ? -1 : 1) * a.t.localeCompare(b.t) || a.i - b.i);
  };
  // A section block: a head with its row count, then the list. A long finished list (more than five
  // items) is clamped: its first rows show, the rest fades, and a button opens it in place. Active
  // sections are never clamped. Lists are never fully closed.
  const KEY = ['run', 'you', 'wait', 'ok', 'plan'];
  const block = (g) => {
    const it = sorted.filter((x) => x.g === g);
    if (!it.length) return '';
    const us = units(it, g); const k = KEY[g];
    const long = NEWEST.includes(g) && us.length > CLAMP;
    const more = `${L.more} (${it.length})`;
    return `<div class="blk" data-k="${k}"><div class="hd">${L.groups[g]} <span>${it.length}</span></div>`
      + `<div class="clip${long ? ' clamp' : ''}" id="clip-${k}"><ol>\n${us.map((u) => '  ' + u.html + '\n').join('')}</ol></div>`
      + (long ? `<div class="fade" aria-hidden="true"></div><button type="button" class="more" aria-expanded="false" aria-controls="clip-${k}" data-label="${esc(more)}" data-less="${esc(L.less)}">${esc(more)}</button>` : '')
      + '</div>';
  };
  // one list, active work first (owner, 2026-10-05, replacing the 2026-10-03 placement of waiting and
  // plans at the top): in progress, owner, waiting, plans, done
  const secs = [GROUP.you, GROUP.wait, GROUP.plan, GROUP.ok].map(block).filter(Boolean).map((b) => `<li class="sec">${b}</li>`);
  const ol = `<ol>\n${secs.map((x) => '  ' + x + '\n').join('')}</ol>`;
  // the Crew strip: shown whenever it has entries; developer mode decides only whether roles are named
  const stripHtml = activeStrip(crew, rows, L, dev);
  const strip = stripHtml ? `<section class="crew">${stripHtml}</section>\n` : '';
  if (!/<main>[\s\S]*<\/main>/.test(html) || !/data-t="[^"]*"/.test(html)) die('index.html is not a tracker page');
  html = html.replace(/<main>[\s\S]*<\/main>/, () => `<main>\n<!-- crew -->\n${strip}${ol}\n</main>`)
    .replace(/data-t="[^"]*"/, () => `data-t="${clock.toISOString()}"`);
  // the console style and the clamp script are rebuilt last; no rounded corner or shadow survives in any style
  html = html.replace(/\n<style id="console">[\s\S]*?<\/style>/, '').replace(/<script id="clip">[\s\S]*?<\/script>\n/, '')
    .replace(/<script id="since">[\s\S]*?<\/script>\n/, '');
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (m, a, css, b) => a
    + css.replace(/border-radius:(?!0[;}\s!])[^;}]*;?/g, '').replace(/box-shadow:(?!none[;}\s!])[^;}]*;?/g, '') + b);
  // a page made before the strip gets its styles once
  if (crew.length && !html.includes('@keyframes crew-pulse')) html = html.replace('</style>', `${CREW_CSS}\n</style>`);
  const at = html.lastIndexOf('</style>') + '</style>'.length;
  html = `${html.slice(0, at)}\n<style id="console">\n${CONSOLE_CSS}\n</style>${html.slice(at)}`;
  html = html.replace('</body>', () => `<script id="clip">${CLIP_JS}</script>\n</body>`);
  // the elapsed-time script only when a strip line has something to count
  if (crew.some(ticks)) html = html.replace('</body>', () => `<script id="since">${SINCE_JS}</script>\n</body>`);
  fs.writeFileSync(pagePath, html);
  if (stamped) writeStore(rowsPath, store);
  if (!quiet) console.log(`rows: ${rows.length}`);
}

function upsert(dir, opt) {
  if (!dir || !opt.title || !opt.state) die('usage: tracker.js row <dir> --title "<text>" --state run|you|wait|ok|plan [--small t] [--url u] [--label t] [--group t]');
  if (!Object.prototype.hasOwnProperty.call(GROUP, opt.state)) die(`unknown state "${opt.state}"`);
  const rowsPath = path.join(dir, 'rows.json');
  if (!fs.existsSync(rowsPath)) die(`${rowsPath} not found (run init first)`);
  const store = readStore(rowsPath);
  const { rows } = store;
  const row = { state: opt.state, title: opt.title };
  if (opt.small) row.small = opt.small;
  if (opt.url) row.url = opt.url;
  if (opt.label) row.label = opt.label;
  if (opt.group) row.group = opt.group;
  const i = rows.findIndex((r) => r && key(r.title) === key(opt.title));
  // the parent stays unless given: re-running a sub-job's row must not ungroup it
  const parent = opt.parent !== undefined ? opt.parent : (i >= 0 ? rows[i].parent : undefined);
  if (parent) row.parent = parent;
  if (i >= 0) rows[i] = row; else rows.push(row);
  checkParents(rows); // before writing: a refused row leaves rows.json alone
  writeStore(rowsPath, store);
  render(dir);
}

/**
 * Upserts one Crew strip entry by role + job (case and outer spaces ignored),
 * stamps its time now and re-renders without printing. Throws on a refusal
 * (unknown role, state or reason; no rows.json; invalid JSON) before writing.
 * Shared by the CLI's `crew` branch and the hooks' safety net.
 */
function upsertCrew(dir, opt, { quiet = true } = {}) {
  if (!dir || !opt || !opt.role || !opt.job || !opt.state) die(`usage: tracker.js crew <dir> --role ${CREW_ROLES.join('|')} --job "<text>" --state ${CREW_STATES.join('|')} [--reason ${CREW_REASONS.join('|')}] [--url u] [--model m] [--effort ${CREW_EFFORTS.join('|')}] [--ctx <tokens>] [--agent <id>]`);
  const entry = { role: opt.role, job: opt.job, state: opt.state };
  if (opt.reason) entry.reason = opt.reason;
  if (opt.url) entry.url = opt.url;
  checkCrew(entry, 'crew');
  const stamp = hm(now());
  const rowsPath = path.join(dir, 'rows.json');
  if (!fs.existsSync(rowsPath)) die(`${rowsPath} not found (run init first)`);
  const store = readStore(rowsPath);
  const i = store.crew.findIndex((e) => e && e.role === entry.role && key(e.job) === key(entry.job));
  // model, effort and the context figure carry over unless given again; --ctx stamps the time it was reported
  const old = i >= 0 ? store.crew[i] : {};
  for (const k of ['model', 'effort', 'ctx', 'ctxTime', 'agent', 'row']) if (old[k] !== undefined) entry[k] = old[k];
  if (opt.agent !== undefined) entry.agent = opt.agent;
  // --row "<title>": the row this entry works on (must be a row); --row "" clears it
  if (opt.row !== undefined) {
    if (!String(opt.row).trim()) delete entry.row;
    else if (!store.rows.some((r) => r && key(r.title) === key(opt.row))) die(`row "${opt.row}" is not a row`);
    else entry.row = opt.row;
  }
  if (opt.model !== undefined) entry.model = opt.model;
  if (opt.effort !== undefined) entry.effort = opt.effort;
  if (opt.ctx !== undefined) {
    if (!/^\d+$/.test(String(opt.ctx))) die('--ctx takes a whole number of tokens');
    entry.ctx = Number(opt.ctx); entry.ctxTime = stamp;
  }
  checkCrew(entry, 'crew');
  entry.time = stamp;
  // the time in a state counts from when it began: kept while the state is, restarted when it changes
  // (an entry from before `since` starts at its own time)
  if (old.state === entry.state) { const o = { ...old }; stampSince(o, now()); entry.since = o.since; entry.sinceState = o.sinceState; }
  else { entry.since = now().toISOString(); entry.sinceState = entry.state; }
  if (i >= 0) store.crew[i] = entry; else store.crew.push(entry);
  writeStore(rowsPath, store);
  render(dir, { quiet });
}

/** The Crew strip entries of the Tracker in `dir`, read-only. Throws on a refusal. */
function readCrew(dir) {
  return readStore(path.join(dir, 'rows.json')).crew;
}

function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  if (pos[0] === 'init') init(pos[1], opt);
  else if (pos[0] === 'row') upsert(pos[1], opt);
  else if (pos[0] === 'crew') upsertCrew(pos[1], opt, { quiet: false });
  else if (pos.length === 1) render(pos[0]);
  else die('usage: tracker.js init <dir> --title "<text>" [...]  |  tracker.js row <dir> --title t --state s  |  tracker.js crew <dir> --role r --job t --state s  |  tracker.js <dir>');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    console.error(`tracker: ${e.message}`);
    process.exit(1);
  }
}
module.exports = { devModeFor, LABELS, CREW_CSS, CONSOLE_CSS, STRIP_CSS, CLIP_JS, SINCE_JS, PANEL_JS, activeStrip, stampSince, CREW_ROLES, upsertCrew, readCrew, Refused };
