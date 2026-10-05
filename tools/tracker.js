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
 *   The board (owner, 2026-10-05, "Tracker yeni düzen"): every row in one line
 *       shape, [mark] [text ▸] [link] [time], in state groups: Active work (tr
 *       "Aktif çalışma"), Owner, Waiting, Done today; Plans alone below a faint
 *       rule. The whole line is a <button aria-expanded aria-controls> that opens
 *       its detail directly under it (<li class="crew-dl">, the list's next item),
 *       one open at a time across the page (PANEL_JS); without script every detail
 *       shows under its line. The detail: the small text, its "sonraki:/next:" part
 *       on its own line, the crew entries' links, in developer mode their
 *       model · effort · ctx tail; an owner line leads with the link to where it is
 *       decided and the reason word. A row's url is a link label on the line
 *       (label, else "page"/"sayfa"); only http(s). Ids come from titles
 *       (slugId), so what is open survives a reload: STATE_JS keeps the open
 *       detail, folds, opened long lists and the scroll position in the browser's
 *       storage, every access guarded.
 *       Active work is only what runs now: run rows, the rows crew entries are
 *       working on, and working entries with no row; never what waits on the
 *       owner, never idle. Its head has the line count and on the right Voice's
 *       icon and each working role's; nothing running: count 0 and one line
 *       "Nothing running right now" / "Şu an çalışan iş yok". Every role icon
 *       carries title and aria-label saying what the role is doing (L.doing:
 *       developer mode "Builder · kod yazıyor", off "Kod yazıyor"; a summary icon
 *       leads with its count, "2 · kod yazıyor").
 *       Owner: you rows (with the owner entries naming them) and owner entries
 *       with no such row, as their own lines. A you row waiting on a decision
 *       (it has options/recommend/why, or an owner entry with reason decision
 *       names it) is the question (its title) with options [{key, label, text}],
 *       two or more, keys unique; recommend, one of the keys; why, one line. Else
 *       render, row and crew refuse it before writing (checkDecisions). Its detail
 *       shows the question, one option per line with its key as a tag, the
 *       recommended one marked with its why. With the page's database (published
 *       with capabilities {db: {}}) ANSWER_JS makes the option lines the choice
 *       and shows a note and Send: Send writes answers/<slugId('a', title)> =
 *       {row, key, label, note, at, state: "new"} and the line says
 *       "cevaplandı: A · HH:MM", also after a reload. Every row's detail ends with
 *       the same note form (a note alone: answers/<id>--n<time>, key ""), and every
 *       row's line has a small reply icon that opens the detail at the note; a
 *       sent note marks the icon. A row with nothing more to show has no detail of
 *       its own: its title is never repeated under it. Active work and Owner oldest
 *       first, the rest newest first; ties keep file order; an empty group is left out.
 *       In a group, the lines of one category (a row's parent, else its group, by
 *       name) sit under one category line, indented, however few; no line repeats
 *       its category; a parent in the same group is the category line itself.
 *       Done today is one closed <details name="trk"> with its count and last
 *       time, its categories closed folds inside; Plans one closed fold per group
 *       (its group, else its parent; neither: Other). Waiting and Done today
 *       clamp after 5 units, cut cleanly at a line, no fade.
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
 *       ok (done) | plan. <main> is rebuilt from it (the board above), so a row
 *       removed from the file disappears. A row without `time` is stamped once
 *       with the current local HH:MM and that stamp is written back to
 *       rows.json; a row with `time` keeps it. A `time` of DD.MM (a carried-over
 *       row, a plan's day) orders by that date, before any time of today. A page's
 *       own <main> tag and what stands in it before <!-- crew --> are kept.
 *       The Theme's tokens (<style id="theme">, tools/lib/theme.js), the console look (CONSOLE_CSS) and
 *       the clamp, panel and state scripts are put back last on every render, and
 *       any non-zero radius or shadow in the page's styles is stripped. Only
 *       <main>, those blocks and the page's "updated" stamp (data-t) change.
 *       Prints `rows: N`. Exit 1 on a missing dir or rows.json, invalid JSON,
 *       unknown state, or two rows with the same title (case and outer spaces
 *       ignored): one job, one row.
 *
 * Developer mode (`devMode: true` in the workspace's .joserah/config.json, found
 * by walking up from <dir>) names the role in each icon's title, and adds the
 * faint model · effort tail to the detail. Off (the default, and outside any workspace) the strip
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
  en: { locale: 'en', rec: 'recommended', choice: 'Your choice', note: 'note (optional)', write: 'write a note', send: 'Send', none: 'Nothing running right now', doing: { voice: 'talking with you', lead: 'managing', architect: 'planning', builder: 'writing code', scout: 'researching', sentry: 'watching' }, reasons: { decision: 'decision', 'sign-in': 'sign-in', connection: 'connection', approval: 'approval' }, run: 'Active work', runPlain: 'Active work', you: 'Owner', wait: 'Waiting', plan: 'Plan', ok: 'Done', next: 'next', decide: 'decision page', groups: ['Active work', 'Owner', 'Waiting', 'Done today', 'Plans'], link: 'page', other: 'Other', upd: 'updated', more: 'all', less: 'show less' },
  tr: { locale: 'tr', rec: 'önerim', choice: 'Seçiminiz', note: 'not (isteğe bağlı)', write: 'not yazın', send: 'Gönder', none: 'Şu an çalışan iş yok', doing: { voice: 'sizinle konuşuyor', lead: 'yönetiyor', architect: 'planlıyor', builder: 'kod yazıyor', scout: 'araştırıyor', sentry: 'izliyor' }, reasons: { decision: 'karar', 'sign-in': 'oturum açma', connection: 'bağlantı', approval: 'onay' }, run: 'Aktif çalışma', runPlain: 'Aktif çalışma', you: 'Sizde', wait: 'Beklemede', plan: 'Plan', ok: 'Bitti', next: 'sonraki', decide: 'karar sayfası', groups: ['Aktif çalışma', 'Sizde', 'Beklemede', 'Bugün biten', 'Planlar'], link: 'sayfa', other: 'Diğer', upd: 'güncelleme', more: 'tümü', less: 'daralt' },
};
const GROUP = { run: 0, you: 1, wait: 2, ok: 3, plan: 4 };
const { findWorkspace, readConfig } = require('../hooks/lib/workspace');

const CREW_ROLES = ['voice', 'lead', 'architect', 'builder', 'scout', 'sentry'];
const CREW_STATES = ['work', 'owner', 'idle'];
const CREW_REASONS = ['decision', 'sign-in', 'connection', 'approval'];
const CREW_EFFORTS = ['low', 'medium', 'high'];
const { ICONS } = require('./lib/crew-icons');
const theme = require('./lib/theme');
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

// One line shape for every group (owner, 2026-10-05: "Ajan çalışıyor, kısmını aktif çalışma gibi yapalım
// ben yukarıdan tıklayınca aşağıyı doldursun … önce işin kategori ismi sonra kısa özet gibi. net yalın
// olsun."; then "Tracker yeni düzen", Architect's build note): [mark] [text ▸] [link] [time]. The whole
// line is a button that opens its detail right under it (<li class="crew-dl">), one open at a time across
// the page; lines of one category sit under one category line, indented with the left hairline. Without
// script every detail shows under its own line. Theme tokens only. The selectors carry :is(.crew,main)
// so they outweigh the strip's older CREW_CSS on any page, the plugin's or an outside updater's.
const LN = ':is(.crew,main) li.crew-line';
const STRIP_CSS = [
  // each section is its own area (owner, 2026-10-05: "Aktif çalışma gibi alanların ayrı gözükmesi lazım
  // stilde … çocuklar için de geçerli"): a quiet surface, a hairline frame, a top band in its state's colour
  'section.crew,main .blk{padding:14px 16px 4px;background:var(--card);border:1px solid var(--line);border-top:3px solid var(--faint)}',
  'section.crew{border-top-color:var(--run)}main .blk[data-k="you"]{border-top-color:var(--you)}main .blk[data-k="wait"]{border-top-color:var(--wait)}main .blk[data-k="ok"]{border-top-color:var(--ok)}',
  'main .blk>details>summary.hd{border-bottom:0;padding-bottom:10px}main .blk>details[open]>summary.hd{border-bottom:1px solid var(--muted)}',
  '.crew .hd{flex-wrap:wrap}',
  '.crew .hd .crew-sum{display:flex;flex-wrap:wrap;margin-left:auto;gap:14px;padding:0;border:0;letter-spacing:0}',
  '.crew-sum span{font:500 11px var(--mono);font-variant-numeric:tabular-nums;gap:4px}',
  `.crew svg,${LN} svg{width:16px;height:16px}`,
  // the columns carry no gap of their own: each part brings its margin, so a part that is not there (no link,
  // a reply icon still hidden) leaves no hole
  `${LN}{position:relative;display:grid;grid-template-columns:minmax(16px,auto) minmax(0,1fr) auto auto minmax(46px,auto);grid-template-areas:"m x r l t";gap:0;align-items:center;margin:0;padding:9px 0;background:none;border:0;border-bottom:1px solid var(--line);font:400 14px/1.45 var(--sans)}`,
  `${LN}>.ic{grid-area:m;margin-right:12px}${LN}>.tx{grid-area:x}${LN}>.rp{grid-area:r}${LN}>.lk{grid-area:l;margin-left:12px}${LN}>time{grid-area:t;margin-left:12px}`,
  `${LN} .ic,${LN} .ic>span{display:inline-flex;flex:none;align-items:center;gap:4px;min-width:0}`,
  `${LN} .ic>.sq{display:inline-block;width:5px;height:5px;background:currentColor;color:var(--faint)}`,
  `${LN}.run .sq{color:var(--run)}${LN}.you .sq{color:var(--you)}${LN}.wait .sq,${LN}.plan .sq{color:var(--wait)}${LN}.ok .sq{color:var(--ok)}`,
  `${LN} .tx{display:block;width:100%;min-width:0;margin:0;padding:0;border:0;background:none;font:inherit;text-align:left;cursor:pointer;overflow-wrap:anywhere;color:var(--ink)}`,
  `${LN} .ct{font:500 11px var(--mono);color:var(--faint)}${LN} .tx .n{margin-left:8px;font:500 11px var(--mono);color:var(--faint)}`,
  `${LN} .tx::before{content:"\\25B8";display:inline-block;width:14px;font:500 11px var(--mono);color:var(--faint)}`,
  `${LN} .tx[aria-expanded="true"]::before{content:"\\25BE"}`,
  `${LN} .tx::after{content:"";position:absolute;inset:0}`,
  `${LN}:hover .tx,${LN} .tx[aria-expanded="true"]{color:var(--link)}`,
  `${LN} .tx:focus-visible,${LN} .lk:focus-visible{outline:1px solid var(--link);outline-offset:2px}`,
  `${LN}>.lk{position:relative;z-index:1;font:500 11px var(--mono);color:var(--link);text-decoration:none;white-space:nowrap}`,
  `${LN}>time{align-self:center;text-align:right;font:500 11px var(--mono);font-variant-numeric:tabular-nums;color:var(--faint);white-space:nowrap}`,
  ':is(.crew,main) li.crew-dl{display:block;margin:0 0 0 2px;padding:0 0 0 16px;background:none;border:0;border-left:1px solid var(--line)}',
  '.cd{padding:10px 0 12px 24px;border-bottom:1px solid var(--faint);font:400 12.5px/1.5 var(--sans);color:var(--muted)}',
  '.cd>b{display:block;font:500 13px/1.45 var(--sans);color:var(--ink)}.js-cd .cd>b{display:none}',
  // a row with nothing more to show has no panel; with the database its panel is the note alone
  '.cd.bare{display:none}html.js-ans .cd.bare.fm:not([hidden]){display:block}html.js-ans .cd.bare.fm{padding-top:4px}',
  `${LN}:has(+li.crew-dl>.cd.bare) .tx::before{visibility:hidden}html.js-ans ${LN}:has(+li.crew-dl>.cd.fm) .tx::before{visibility:visible}`,
  '.cd p{margin:2px 0 0;overflow-wrap:anywhere}.cd a{color:var(--link)}.cd .dl em{font-style:normal;color:var(--you)}',
  '.cd .nx span{margin-right:6px;font:600 10.5px var(--mono);letter-spacing:.07em;text-transform:uppercase;color:var(--faint)}',
  '.cd .cm{font:500 11px var(--mono);letter-spacing:.02em;color:var(--faint)}',
  '.cd[hidden]{display:none}',
  '@keyframes mv-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}@keyframes mv-flash{0%,25%{background:color-mix(in srgb,var(--link) 14%,transparent)}100%{background:transparent}}',
  '@media (prefers-reduced-motion: no-preference){li.crew-line.mv-new{animation:mv-in .45s ease-out both}li.crew-line.mv-changed,li.crew-line.mv-done,summary.mv-changed{animation:mv-flash 2.2s ease-out}}',
  '.cd ul.opt{list-style:none;margin:6px 0 2px;padding:0}',
  '.cd ul.opt>li{display:block;margin:0;padding:5px 0 5px 30px;position:relative;background:none;border:0;border-top:1px solid var(--line);overflow-wrap:anywhere}',
  '.cd ul.opt .k{position:absolute;left:0;top:6px;min-width:18px;padding:0 4px;font:600 10.5px/1.5 var(--mono);text-align:center;color:var(--muted);border:1px solid var(--line)}',
  '.cd ul.opt .ol{color:var(--ink);font-weight:500}.cd ul.opt .ot{display:block}.cd ul.opt .ol+.ot{margin-top:1px}',
  '.cd ul.opt em{margin-left:8px;padding:0 5px;font:600 10px/1.6 var(--mono);font-style:normal;letter-spacing:.07em;text-transform:uppercase;color:var(--you);border:1px solid currentColor}',
  '.cd ul.opt li.pk{cursor:pointer}.cd ul.opt li.pk:hover .ol{color:var(--link)}.cd ul.opt li.pk[aria-pressed="true"] .k{background:var(--you);color:var(--bg);border-color:var(--you)}.cd ul.opt li.pk[aria-pressed="true"] .ol{color:var(--you)}.cd ul.opt li.pk:focus-visible{outline:1px solid var(--link);outline-offset:3px}',
  // the reply icon: above the line's own click area, quiet until pointed at; a sent note marks it
  `${LN}>.rp{position:relative;z-index:1;display:inline-flex;align-items:center;margin-left:10px;padding:3px;color:var(--faint);background:none;border:0;cursor:pointer}${LN}>.rp svg{width:14px;height:14px}${LN}>.rp:hover,${LN}>.rp:focus-visible{color:var(--link)}${LN}>.rp:focus-visible{outline:1px solid var(--link);outline-offset:1px}${LN}>.rp[data-done]{color:var(--ok)}${LN}>.rp[data-reply]{color:var(--link)}${LN}>.rp[hidden]{display:none}`,
  // a row's conversation, oldest first, above its note box: who and when, then the words
  '.cd ol.th{list-style:none;margin:10px 0 0;padding:0 0 0 10px;border-left:2px solid var(--line)}.cd ol.th[hidden]{display:none}',
  '.cd ol.th>li{display:block;margin:0;padding:3px 0 5px;background:none;border:0;text-align:left}.cd ol.th .who{font:600 11.5px var(--sans);color:var(--ink)}.cd ol.th .as .who{color:var(--link)}',
  '.cd ol.th time{display:inline;margin-left:8px;font:500 11px var(--mono);font-variant-numeric:tabular-nums;color:var(--faint)}.cd ol.th p{display:block;margin:1px 0 0;text-align:left;color:var(--ink);overflow-wrap:anywhere}.cd ol.th p.ch{font-weight:500}',
  'form.ans{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0 2px}form.ans[hidden]{display:none}',
  'form.ans input{flex:1 1 160px;min-width:0;min-height:34px;padding:0 8px;font:400 13px var(--sans);color:var(--ink);background:none;border:1px solid var(--line)}',
  'form.ans .send{min-height:34px;padding:0 14px;font:600 11px var(--mono);letter-spacing:.07em;text-transform:uppercase;color:var(--bg);background:var(--ink);border:0;cursor:pointer}form.ans .send[disabled]{opacity:.4;cursor:default}',
  'form.ans button:focus-visible,form.ans input:focus-visible{outline:1px solid var(--link);outline-offset:2px}form.ans .err{flex-basis:100%;color:var(--you)}form.ans .err[hidden]{display:none}',
  ':is(.crew,main) li.crew-line .tx .an{margin-left:8px;font:600 10.5px var(--mono);letter-spacing:.07em;text-transform:uppercase;color:var(--ok)}:is(.crew,main) li.crew-line .tx .an[hidden]{display:none}',
  '.cd ul.opt>li.rec .k{color:var(--you);border-color:currentColor}.cd ul.opt .why{display:block;margin-top:2px;color:var(--you)}',
  ':is(.crew,main) li.crew-none{display:block;padding:9px 0;border-bottom:1px solid var(--line);font:400 14px/1.45 var(--sans);color:var(--muted)}',
  // a category line (a project group): its name and the member count, a label over its indented lines,
  // quieter than the section title above it and than the lines under it; a done or plan one folds
  'li.cat{display:block}li.cat>ul.ch,li.cat>ol{list-style:none;margin:0;padding:0}',
  'li.cat>.jh,li.cat>details>summary{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;gap:0 12px;padding:14px 0 6px;font:600 13px/1.35 var(--sans);letter-spacing:.01em;color:var(--muted)}',
  'li.cat>details>summary{padding:10px 0 9px;border-bottom:1px solid var(--line)}li.cat>details[open]>summary{border-bottom:0;padding-bottom:6px}',
  '.jt{min-width:0;overflow-wrap:anywhere}li.cat>.jh>span:last-child,li.cat>details>summary>span:last-child{font:500 11px var(--mono);font-variant-numeric:tabular-nums;color:var(--faint)}',
  'li.cat>details>summary{cursor:pointer;list-style:none}li.cat>details>summary::-webkit-details-marker{display:none}',
  'li.cat>details>summary .jt::before{content:"\\25B8";display:inline-block;width:14px;font:500 11px var(--mono);color:var(--faint)}li.cat>details[open]>summary .jt::before{content:"\\25BE"}',
  'li.cat>details>summary:hover .jt{color:var(--link)}li.cat>details>summary:focus-visible{outline:1px solid var(--link);outline-offset:2px}',
  // a row heading its own category reads as the category's name, still a line that opens
  `li.cat>ul.ch>${LN.replace(':is(.crew,main) ', '')}{padding:14px 0 6px;border-bottom:0}li.cat>ul.ch>${LN.replace(':is(.crew,main) ', '')} .tx{font:600 13px/1.35 var(--sans);letter-spacing:.01em;color:var(--muted)}`,
  // the lines of a group: an evident indented block under its name
  'li.cat>ol,li.cat>details>ol{margin:0 0 8px 3px;padding-left:14px;border-left:2px solid var(--line)}',
  // phone width: mark, text and time on the first row, the link label under the text
  `@media (max-width:560px){${LN}{grid-template-columns:minmax(16px,auto) minmax(0,1fr) auto auto;grid-template-areas:"m x r t" ". l . .";row-gap:2px}${LN}>.lk{justify-self:start;margin-left:0}:is(.crew,main) li.crew-dl{padding-left:12px}.cd{padding-left:0}li.cat>ol,li.cat>details>ol{padding-left:10px}section.crew,main .blk{padding:12px 12px 4px}}`,
];
// The panel: with script, every detail starts closed; a line's button opens its own and closes every
// other on the page; a second click closes it. aria-expanded follows; no scrolling, focus stays on the
// button. It waits for the whole document, so it serves lines below the script too.
const PANEL_JS = '(function(){function all(){return document.querySelectorAll("button.tx[aria-controls]")}'
  + 'function set(b,o){b.setAttribute("aria-expanded",String(o));var d=document.getElementById(b.getAttribute("aria-controls"));if(d)d.hidden=!o}'
  + 'function init(){var bs=all();if(!bs.length)return;document.documentElement.classList.add("js-cd");Array.prototype.forEach.call(bs,function(b){set(b,false)})}'
  + 'document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("button.tx[aria-controls]");if(!b)return;var o=b.getAttribute("aria-expanded")!=="true";'
  + 'Array.prototype.forEach.call(all(),function(x){if(x!==b)set(x,false)});set(b,o)});'
  + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init()})();';
// What is open survives a reload (owner, 2026-10-05: "sayfa güncellenince otomatik yenileniyor expandların
// durumu da değişmesin"; a republish reloads the page). The open detail, the open folds (by id, a fold
// without one by its summary text), the opened long lists and the scroll position are kept per viewer in
// the browser's storage, under the page's path; every read and write is guarded, and with no storage the
// page simply starts closed. Nothing is saved before the viewer acts. (The artifact runtime 0.2.67
// promises only claude.use(); it has no hot-reload snapshot to use instead.)
const STATE_JS = '(function(){var K="trk:"+location.pathname,ready=false,t=0,W=typeof window!=="undefined"?window:{},H=(W.claude&&W.claude.hot)||null;'
  + 'function each(s,f){Array.prototype.forEach.call(document.querySelectorAll(s),f)}'
  + 'function dk(d){if(d.id)return d.id;var s=d.querySelector("summary");return"S:"+(s?s.textContent:"").trim().slice(0,80)}'
  + 'function get(){try{return JSON.parse(localStorage.getItem(K)||"null")}catch(e){return null}}'
  + 'function snap(){var p=null,d=[],c=[];each("button.tx[aria-controls]",function(b){if(b.getAttribute("aria-expanded")==="true")p=b.getAttribute("aria-controls")});'
  + 'each("details",function(x){if(x.open)d.push(dk(x))});each("button.more[aria-controls]",function(b){if(b.getAttribute("aria-expanded")==="true")c.push(b.getAttribute("aria-controls"))});'
  + 'return{p:p,d:d,c:c,y:Math.round(window.scrollY||0)}}'
  + 'function put(){if(!ready)return;try{localStorage.setItem(K,JSON.stringify(snap()))}catch(e){}}'
  + 'function later(){clearTimeout(t);t=setTimeout(put,150)}'
  + 'function restore(s){if(!s||typeof s!=="object")return;var d=s.d||[],c=s.c||[],y=+s.y||0;'
  + 'each("details",function(x){x.open=d.indexOf(dk(x))>=0});'
  + 'each("button.tx[aria-controls]",function(b){if(s.p&&b.getAttribute("aria-controls")===s.p){b.setAttribute("aria-expanded","true");var e=document.getElementById(s.p);if(e)e.hidden=false}});'
  + 'each("button.more[aria-controls]",function(b){if(c.indexOf(b.getAttribute("aria-controls"))>=0&&b.getAttribute("aria-expanded")!=="true")b.click()});'
  + 'if(y>0){window.scrollTo(0,y);window.addEventListener("load",function(){window.scrollTo(0,y)})}}'
  + 'function go(h){restore(h&&h.state&&typeof h.state==="object"?h.state:get());ready=true;document.addEventListener("click",later);document.addEventListener("toggle",later,true);window.addEventListener("scroll",later);window.addEventListener("pagehide",put)}'
  + 'function start(h){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",function(){go(h)});else go(h)}'
  + 'if(H&&typeof H.snapshot==="function"){try{H.snapshot(function(){return{state:snap(),sig:W.__trkSig||null}})}catch(e){}}'
  + 'if(H&&typeof H.ready==="function"){try{H.ready(start)}catch(e){start({})}}else start((H&&H.data)||{})})();';

// Console look (owner, 2026-10-05: "kartlar olmasın yuvarlak köşeli … elit admin gibi"): no cards, no
// rounded corners, no shadows; hairline lines, mono group heads with their counts, a tabular
// right-aligned time column; a long list shows its first lines, fades, and opens in place as a bounded
// scroll area; Done today is one fold; Plans stand alone below a faint rule. Theme tokens only.
// The shared part (mono font, no radius or shadow, group heads, the clamp) is the Theme's BASE_CSS
// (tools/lib/theme.js); the board's own layout follows it. The template carries it as
// <style id="console"> and every render puts it back last, so it wins over a page's older styles and a
// re-render reproduces it exactly. The line and category shapes are STRIP_CSS.
// The answer (owner, 2026-10-05: "textbox ve seçim yetenekleri getirelim"; "şıklar direk seçilebilmeli altta
// niye ayrı buton var"; "her satıra cevap verebilmeliyim. aslında küçük bir ikonla"; "orada chat geçmiş de
// görünmeli. sen de cevap verebiliyorsun dimi"): with the artifact's database (capability `db`, declared on
// publish as {db: {}}) every row's note form shows, and so does each line's reply icon, which opens the row's
// detail and puts the cursor in the note. In a question row the option lines themselves are the choice (one
// at a time, aria-pressed, Enter or Space too); Send writes answers/<id> = {row, key, label, note, at,
// state: "new"} and the line says "cevaplandı: A · HH:MM". A note with no choice is its own document,
// answers/<id>--n<time> with key "". The assistant answers in the same collection, answers/<id>--r<time> =
// {row, from: "assistant", note, at, state: "reply"}. Everything stored for a row ("<id>" or "<id>--…"; "--"
// never stands in an id made by slugId) is its conversation, shown oldest first above the note box, each
// message with who wrote it (Siz / Joserah) and its time, live through one subscription, also after a
// reload; the reply icon is marked when the owner wrote and when the assistant answered. Every text goes in
// through textContent. No database, no right to write, or any failure to reach it: forms and icons stay
// hidden and the row reads as before.
const ANSWER_JS = '(function(){var D=document,forms=D.querySelectorAll("form.ans[data-ans]");if(!forms.length)return;'
  + 'var W=typeof window!=="undefined"?window:{};if(!W.claude||typeof W.claude.use!=="function")return;'
  + 'var tr=D.documentElement.lang==="tr",T=tr?{done:"cevaplandı",note:"not gönderildi",reply:"Joserah cevap verdi",me:"Siz",as:"Joserah",fail:"gönderilemedi, tekrar deneyin"}'
  + ':{done:"answered",note:"note sent",reply:"Joserah replied",me:"You",as:"Joserah",fail:"could not send, try again"};'
  + 'function each(l,f){Array.prototype.forEach.call(l||[],f)}'
  + 'function hm(iso){var d=new Date(iso);if(isNaN(d.getTime()))return"";return("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2)}'
  + 'var rps=D.querySelectorAll("button.rp[data-rp]"),docs={};'
  + 'function baseOf(id){var i=String(id).indexOf("--");return i<0?String(id):String(id).slice(0,i)}'
  + 'function mark(id,a){var at=hm(a.at)?" · "+hm(a.at):"",as=a.from==="assistant";if(a.key&&!as){each(D.querySelectorAll("[data-an]"),function(e){if(e.getAttribute("data-an")===id){e.textContent=T.done+": "+a.key+at;e.hidden=false}});'
  + 'each(forms,function(f){if(f.getAttribute("data-ans")===id&&f.getAttribute("data-choice"))f.hidden=true})}'
  + 'each(rps,function(b){if(b.getAttribute("data-nt")!==id)return;var w=String(a.at||"");if(w<(b.getAttribute("data-at")||""))return;var t=(as?T.reply:a.key?T.done+": "+a.key:T.note)+at;'
  + 'b.setAttribute("data-at",w);if(as)b.setAttribute("data-reply","1");else b.setAttribute("data-done","1");b.setAttribute("title",t);b.setAttribute("aria-label",t)})}'
  + 'function el(t,c,x){var e=D.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e}'
  + 'function draw(){var by={};Object.keys(docs).forEach(function(id){var b=baseOf(id);(by[b]=by[b]||[]).push(docs[id])});'
  + 'each(forms,function(f){var xs=(by[f.getAttribute("data-ans")]||[]).slice().sort(function(x,y){var p=String(x.at||""),q=String(y.at||"");return p<q?-1:p>q?1:0}),th=f.__th;'
  + 'if(!xs.length){if(th)th.hidden=true;return}if(!th&&f.parentNode){th=el("ol","th");f.parentNode.insertBefore(th,f);f.__th=th}if(!th)return;'
  + 'while(th.firstChild)th.removeChild(th.firstChild);'
  + 'xs.forEach(function(a){var as=a.from==="assistant",li=el("li",as?"as":"me");li.appendChild(el("span","who",as?T.as:T.me));li.appendChild(el("time","",hm(a.at)));'
  + 'if(a.key&&!as)li.appendChild(el("p","ch",String(a.key)+(a.label?" · "+a.label:"")));if(a.note)li.appendChild(el("p","",String(a.note)));th.appendChild(li)});th.hidden=false})}'
  + 'function off(){each(forms,function(f){f.hidden=true});each(rps,function(b){b.hidden=true})}'
  + 'var p;try{p=W.claude.use("db")}catch(e){return}Promise.resolve(p).then(function(db){if(!db)return;var col=db.collection("answers"),R=D.documentElement;if(R.classList)R.classList.add("js-ans");'
  + 'each(forms,function(f){var ch=!!f.getAttribute("data-choice"),box=f.parentNode,keys=ch&&box&&box.querySelectorAll?box.querySelectorAll("ul.opt li[data-k]"):[],note=f.querySelector("input"),send=f.querySelector(".send"),err=f.querySelector(".err"),pick=null;'
  + 'function txt(){return String(note&&note.value||"").trim().slice(0,500)}function ready(){send.disabled=!pick&&!txt()}'
  + 'each(keys,function(b){b.setAttribute("role","button");b.setAttribute("tabindex","0");b.setAttribute("aria-pressed","false");if(b.classList)b.classList.add("pk");'
  + 'function go(){pick=b;each(keys,function(x){x.setAttribute("aria-pressed",String(x===b))});ready()}b.addEventListener("click",go);b.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();go()}})});'
  + 'if(note&&note.addEventListener)note.addEventListener("input",ready);'
  + 'f.addEventListener("submit",function(e){e.preventDefault();var n=txt();if(!pick&&!n)return;var base=f.getAttribute("data-ans"),c=pick,id=c?base:base+"--n"+Date.now().toString(36),'
  + 'a={row:f.getAttribute("data-row"),key:c?c.getAttribute("data-k"):"",label:c?c.getAttribute("data-l"):"",note:n,at:new Date().toISOString(),state:"new"};'
  + 'send.disabled=true;err.hidden=true;col.doc(id).set(a).then(function(){docs[id]=a;mark(base,a);draw();if(!c&&note)note.value="";ready()},function(x){var k=x&&x.code;'
  + 'if(k==="invalid_argument"||k==="not_granted"||k==="revoked"||k==="capability_disabled"||k==="capability_removed"){off();return}err.textContent=T.fail;err.hidden=false;send.disabled=false})});'
  + 'f.hidden=false});'
  + 'each(rps,function(b){b.hidden=false;b.addEventListener("click",function(){var id=b.getAttribute("data-rp"),tx=b.parentNode&&b.parentNode.querySelector("button.tx");if(tx&&tx.getAttribute("aria-expanded")!=="true"&&tx.click)tx.click();'
  + 'var d=D.getElementById(id),i=d&&d.querySelector("form.ans input");if(i&&i.focus)i.focus()})});'
  + 'col.onSnapshot(function(snap){docs={};each(snap.docs,function(d){if(!d.exists)return;var a=d.data();if(!a)return;docs[d.id]=a;mark(baseOf(d.id),a)});draw()},function(){})},function(){})})();';

// Motion (owner, 2026-10-05: "sayfayı sürekli yeniden çizme satırı güncelle güzelce. animatik düşün temiz
// neat."). A publish reloads every open view (artifact runtime 0.2.67: "every open view live-reloads to it";
// in-place edits are for live docs only), so the page cannot be patched without one. After the reload this
// script compares each line's key and signature with the last load (browser storage, per page; every access
// guarded): a new line slides in, a changed one flashes once, one that moved to done flashes, and the closed
// Done fold's head with it; then it stores this load. The first load and the same page again move nothing.
// The animations are CSS, only without reduced motion; scroll and open details come back through STATE_JS.
const MOTION_JS = '(function(){var K="trk-sig:"+location.pathname,prev=null,cur={},W=typeof window!=="undefined"?window:{},H=(W.claude&&W.claude.hot)||null;'
  + 'if(H&&H.data&&H.data.sig&&typeof H.data.sig==="object")prev=H.data.sig;else{try{prev=JSON.parse(localStorage.getItem(K)||"null")}catch(e){prev=null}}W.__trkSig=cur;'
  + 'function mark(el,c){el.classList.add(c);setTimeout(function(){el.classList.remove(c)},2400)}'
  + 'Array.prototype.forEach.call(document.querySelectorAll("li.crew-line[data-key]"),function(l){var k=l.getAttribute("data-key"),s=l.getAttribute("data-sig"),g=l.getAttribute("data-st")||"run";cur[k]={s:s,g:g};'
  + 'if(!prev||typeof prev!=="object")return;var p=prev[k],c=!p?"mv-new":(p.g!==g&&g==="ok")?"mv-done":(p.s!==s||p.g!==g)?"mv-changed":"";if(!c)return;mark(l,c);'
  + 'var d=l.closest&&l.closest("details");if(d&&!d.open){var h=d.querySelector("summary");if(h)mark(h,"mv-changed")}});'
  + 'try{localStorage.setItem(K,JSON.stringify(cur))}catch(e){}})();';

const CONSOLE_CSS = [
  theme.BASE_CSS,
  'main{display:grid;gap:28px;max-width:820px;margin:0 auto;padding:22px 16px 56px}',
  'main ol,main ul{list-style:none;margin:0;padding:0}',
  'main li{margin:0;padding:0;background:none;border:0}',
  'main>ol{display:grid;gap:28px}',
  // the section title is the top of the order: section > project group > line > time and link
  'main .blk>.hd,main .blk>details>summary.hd,main .crew>.hd{padding:0 0 9px;font:700 12px/1.2 var(--mono);letter-spacing:.14em;color:var(--ink);border-bottom:1px solid var(--muted)}',
  'li.sec{display:block}li.sec.pl{padding-top:12px}',
  ...STRIP_CSS,
  '@media (max-width:560px){main{gap:24px}main>ol{gap:24px}}',
].join('\n');
// The clamp's script is the Theme's (tools/lib/theme.js).
const { CLIP_JS } = theme;
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
    else if (a === '--option') (opt.option = opt.option || []).push(argv[++i]);
    else if (/^--(title|date|lang|logo|state|small|url|label|group|role|job|reason|parent|model|effort|ctx|agent|row|recommend|why)$/.test(a)) opt[a.slice(2)] = argv[++i];
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

// A row waiting on the owner's decision (owner, 2026-10-05: "hatırlamıyorum ve önerilerin dispatch de
// değil"; "bunu daha güzel formatlayamaz mısın?") is answered from the page: its title is the question,
// `options` its answers [{key, label, text}], `recommend` the key recommended and `why` one line on why.
// A you row is a decision when it carries any of them or an owner entry with reason decision names it;
// any other you row is an action (sign-in, reload, approval of one thing) and needs only the action and
// where it is done.
const DECISION_NEEDS = "waits on the owner's decision: it needs options (two or more, each with its own key and a label or text), recommend (one of the keys) and why (one line)";
const optionsOf = (r) => (Array.isArray(r && r.options) ? r.options : []).map((o) => ({
  key: String((o && o.key) ?? '').trim(), label: String((o && o.label) ?? '').trim(), text: String((o && o.text) ?? '').trim(),
}));
function checkDecisions(rows, crew = []) {
  const named = new Set(crew.filter((e) => e && e.state === 'owner' && e.reason === 'decision' && key(e.row)).map((e) => key(e.row)));
  rows.forEach((r, i) => {
    if (!r || r.state !== 'you') return;
    const isDecision = r.options !== undefined || r.recommend !== undefined || r.why !== undefined || named.has(key(r.title));
    if (!isDecision) return;
    const os = optionsOf(r);
    const keys = os.map((o) => key(o.key));
    const ok = Array.isArray(r.options) && os.length >= 2 && os.every((o) => o.key && (o.label || o.text))
      && new Set(keys).size === keys.length && keys.includes(key(r.recommend)) && String(r.why ?? '').trim();
    if (!ok) die(`row ${i + 1}: "${r.title}" ${DECISION_NEEDS}`);
  });
}

// Developer mode only: `model · effort · ctx @time` as reported, in the line's detail (the build note,
// 2026-10-05: no longer on the line); the context figure only with the time it was reported (never
// estimated). Several entries on one line: their tails one after another, " / " between them.
function crewTail(es) {
  return es.map((e) => {
    const me = [e.model, e.effort].filter(Boolean).join(' · ');
    const cx = e.ctx && e.ctxTime ? `${e.ctx >= 1000 ? Math.round(e.ctx / 1000) + 'k' : e.ctx} @${e.ctxTime}` : '';
    return [me, cx].filter(Boolean).join(' · ');
  }).filter(Boolean).map(esc).join(' / ');
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

// A short hash of a line's content (djb2, base 36): equal content, equal signature.
function sigOf(text) {
  let h = 5381;
  for (const ch of String(text)) h = (Math.imul(h, 33) ^ ch.codePointAt(0)) >>> 0;
  return h.toString(36);
}

// A stable id from a title (owner, 2026-10-05: what is open survives a reload; an id from a position
// would point at another line once a row is added above it): a readable slug and a short hash of the
// whole title, so two titles that slug alike still differ. `hashOf` (default the text) adds to the hash only,
// never to what is readable: a crew line hashes its role but never shows it.
function slugId(prefix, text, hashOf = text) {
  const k = key(text);
  let h = 5381;
  for (const ch of key(hashOf)) h = (Math.imul(h, 33) ^ ch.codePointAt(0)) >>> 0;
  const slug = k.replace(/ı/g, 'i').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '');
  return `${prefix}-${slug ? `${slug}-` : ''}${h.toString(36)}`;
}

// Answered on the page (owner, 2026-10-05: "şıklar direk seçilebilmeli altta niye ayrı buton var"; "her
// satıra cevap verebilmeliyim. aslında küçük bir ikonla"): a question's option lines are themselves the
// choice; every row's detail ends with a short note and Send. Hidden until the page's database is there
// (ANSWER_JS); its id is made from the title, so it survives a move.
const isChoice = (r) => !!r && r.state === 'you' && optionsOf(r).some((o) => o.key && (o.label || o.text));
const REPLY_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.5 3.5h11v7.5H6.5l-3 2.5V11h-1z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
function formOf(r, L) {
  const id = slugId('a', r.title);
  const ph = esc(isChoice(r) ? (L.note || LABELS.en.note) : (L.write || LABELS.en.write));
  return `<form class="ans" data-ans="${id}" data-row="${esc(r.title)}"${isChoice(r) ? ' data-choice="1"' : ''} hidden>`
    + `<input type="text" id="n-${id}" name="note" maxlength="500" placeholder="${ph}" aria-label="${ph}">`
    + `<button type="submit" class="send" disabled>${esc(L.send || LABELS.en.send)}</button><span class="err" role="status" hidden></span></form>`;
}

// A line's detail: the small text, the next step ("sonraki: …" / "next: …" parts of the small line) on
// its own line, the crew entries' links, and in developer mode their model tail. A line waiting on the
// owner leads with the link to where it is decided (an owner entry's url, else the row's, with its
// label) and the entries' reason words. Empty when there is nothing to show: the line's title is never
// repeated as the detail's only content (owner, 2026-10-05: "neden başlık açıklama ile aynı").
function detailOf(r, es, L, { dev = false, decide = false } = {}) {
  const parts = String((r && r.small) || '').split(' · ').map((x) => x.trim()).filter(Boolean);
  const nextRe = /^(sonraki|next)\s*:\s*/i;
  const rest = parts.filter((x) => !nextRe.test(x)).join(' · ');
  const next = parts.filter((x) => nextRe.test(x)).map((x) => x.replace(nextRe, '')).filter(Boolean);
  const a = (u, l) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`;
  let dl = ''; let lead = '';
  if (decide) {
    const own = es.filter((e) => e.state === 'owner');
    const eu = (own.find((e) => isUrl(e.url)) || {}).url;
    lead = eu || (r && isUrl(r.url) ? r.url : '');
    const label = eu ? L.decide : (r && r.label) || L.decide;
    const why = [...new Set(own.filter((e) => e.reason).map((e) => (L.reasons || {})[e.reason] || e.reason))].join(', ');
    if (lead || why) dl = `<p class="dl">${lead ? a(lead, label) : ''}${lead && why ? ' ' : ''}${why ? `<em>${esc(why)}</em>` : ''}</p>`;
  }
  const urls = [];
  for (const e of es) if (isUrl(e.url) && e.url !== lead && !urls.includes(e.url)) urls.push(e.url);
  const tail = dev ? crewTail(es) : '';
  // a decision: one option per line (its key a small tag), the recommended one marked, its why under it;
  // the question is the line's own title, never repeated here
  const os = optionsOf(r).filter((o) => o.key && (o.label || o.text));
  const ask = os.length ? `<ul class="opt">${os.map((o) => {
    const rec = key(o.key) === key(r.recommend);
    return `<li${rec ? ' class="rec"' : ''} data-k="${esc(o.key)}" data-l="${esc(o.label || o.text)}"><span class="k">${esc(o.key)}</span>`
      + (o.label ? `<span class="ol">${esc(o.label)}</span>` : '')
      + (rec ? ` <em>${esc(L.rec || LABELS.en.rec)}</em>` : '')
      + (o.text ? `<span class="ot">${esc(o.text)}</span>` : '')
      + (rec && String(r.why ?? '').trim() ? `<span class="why">${esc(String(r.why).trim())}</span>` : '')
      + '</li>';
  }).join('')}</ul>` : '';
  return dl + ask
    + (rest ? `<p>${esc(rest)}</p>` : '')
    + next.map((x) => `<p class="nx"><span>${esc(L.next)}</span> ${esc(x)}</p>`).join('')
    + (urls.length ? `<p class="ln">${urls.map((u) => a(u, L.link)).join(' · ')}</p>` : '')
    + (tail ? `<p class="cm">${tail}</p>` : '');
}

// The board (owner, 2026-10-05, "Tracker yeni düzen", Architect's build note; and "şu an çalışan bir
// şey var mı anlamıyorum hepsi beni bekliyor galiba"): every row of the day in one line shape, in state
// groups — Active work (run rows and the rows crew entries are working on, plus working entries with no
// row; never what waits on the owner), Owner (you rows and the entries waiting on the owner), Waiting,
// Done today (one closed fold) — and Plans below, one closed fold per group. In a group, two or more
// lines of one category (a row's parent, else its group) sit under one category line, one or many
// (owner, 2026-10-05: "NEden joserah zenger gibi grup ismi değil?"); a parent in the same group is the
// category line itself.
// Active work and Owner oldest first, the rest newest first. Developer mode on: an icon's title names the
// role and what it is doing; off: only what it is doing, no role name anywhere (owner, 2026-10-05:
// "ajan dememeli ve ajan isimleri olmamalı. ikonları kalabilir."; "ikonların üstüne gelince planning
// gibi anlaşılır şeyler yazsın").
function board(rows, crew, L, dev) {
  const byTitle = new Map(rows.map((r) => [key(r.title), r]));
  const mainOf = (r) => (r && hasParent(r) ? byTitle.get(key(r.parent)) || null : null);
  const catText = (r) => { const m = mainOf(r); return m ? m.title : String(r.parent || r.group || '').trim(); };
  const idx = new Map(rows.map((r, i) => [r, i]));
  const working = crew.filter((e) => e.state === 'work');
  const act = (role) => (L.doing || LABELS.en.doing)[role];
  const cap = (s) => s.charAt(0).toLocaleUpperCase(L.locale || 'en') + s.slice(1);
  const tip = (role, n) => {
    const t = dev ? `${ROLE_NAME[role]} · ${act(role)}` : (n ? act(role) : cap(act(role)));
    const s = esc(n ? `${n} · ${t}` : t);
    return ` role="img" title="${s}" aria-label="${s}"`;
  };
  const G = { run: [], you: [], wait: [], ok: [], plan: [] };
  // a time sorts as a time of today; a day mark DD.MM (a carried-over row, a plan's day) by its date and
  // before any time of today (the year is not known: a December mark after a January one sorts wrong)
  const tkey = (t) => { const m = /^(\d\d)\.(\d\d)$/.exec(t); return m ? `0 ${m[2]}.${m[1]}` : `1 ${t}`; };
  const item = (r, es, t, i) => ({ r, es, t: String(t ?? ''), k: tkey(String(t ?? '')), i });
  const latest = (xs) => xs.slice().sort((a, b) => a.k.localeCompare(b.k)).pop().t;
  const onRow = new Map();
  working.forEach((e, ci) => {
    const r = key(e.row) ? byTitle.get(key(e.row)) : null;
    if (!r) { G.run.push(item(null, [e], e.time, rows.length + ci)); return; }
    if (!onRow.has(r)) { const it = item(r, [], r.time, idx.get(r)); onRow.set(r, it); G.run.push(it); }
    onRow.get(r).es.push(e);
  });
  rows.forEach((r) => { if (r.state === 'run' && !onRow.has(r)) G.run.push(item(r, [], r.time, idx.get(r))); });
  const youRow = new Map();
  rows.forEach((r) => { if (r.state === 'you') { const it = item(r, [], r.time, idx.get(r)); youRow.set(r, it); G.you.push(it); } });
  crew.forEach((e, ci) => {
    if (e.state !== 'owner') return;
    const r = key(e.row) ? byTitle.get(key(e.row)) : null;
    if (r && youRow.has(r)) youRow.get(r).es.push(e); else G.you.push(item(null, [e], e.time, rows.length + ci));
  });
  for (const g of ['wait', 'ok', 'plan']) rows.forEach((r) => { if (r.state === g) G[g].push(item(r, [], r.time, idx.get(r))); });

  // one line and its detail, the next item of the list
  const lineFor = (g, it, { prefix = true, extra = '' } = {}) => {
    const { r, es } = it;
    const cat = r ? catText(r) : '';
    const title = r ? r.title : es[0].job;
    const id = r ? slugId(`d-${g}`, title) : slugId(`d-${g}`, es[0].job, `crew ${es[0].role} ${es[0].job}`);
    const strip = g === 'run';
    const mark = strip && es.length ? es.map((e) => `<span${tip(e.role, 0)}>${ICONS[e.role]}</span>`).join('') : '<span class="sq"></span>';
    let time = `<time>${esc(it.t)}</time>`;
    if (strip && es.length) {
      const since = es.filter((e) => e.since).map((e) => e.since).sort()[0];
      time = elapsedTime({ state: 'work', since, time: es.map((e) => String(e.time)).sort().pop() });
    }
    const answerable = isChoice(r);
    const text = `${prefix && cat ? `<span class="ct">${esc(cat)} ·</span> ` : ''}${esc(title)}${answerable ? ` <span class="an" data-an="${slugId('a', r.title)}" hidden></span>` : ''}${extra}`;
    const link = r && isUrl(r.url) ? `<a class="lk" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label || L.link)}</a>` : '';
    const d = detailOf(r, es, L, { dev, decide: g === 'you' });
    const form = r ? formOf(r, L) : '';
    // a reply icon on every row's line: it opens the detail and puts the cursor in the note (ANSWER_JS)
    const nt = r ? `<button type="button" class="rp" data-rp="${id}" data-nt="${slugId('a', r.title)}" title="${esc(L.write || LABELS.en.write)}" aria-label="${esc(L.write || LABELS.en.write)}" hidden>${REPLY_SVG}</button>` : '';
    // motion (owner, 2026-10-05): a stable key from the title and a signature of what the line shows, so the
    // page can tell after a reload what is new, changed or finished
    const sig = sigOf(JSON.stringify([g, title, cat, r && r.small, r && r.url, r && r.label, it.t, r && r.options, r && r.recommend, r && r.why, es.map((e) => [e.role, e.job, e.state])]));
    const mk = ` data-key="${slugId('k', title)}" data-sig="${sig}"`;
    const attrs = strip ? `class="crew-line ${es.length ? 'work' : 'run'}"${dev && es.length ? ` data-role="${es[0].role}"` : ''}${mk}`
      : `data-st="${g}" class="crew-line ${g}"${mk}`;
    return `  <li ${attrs}><span class="ic">${mark}</span><button type="button" class="tx" aria-expanded="false" aria-controls="${id}">${text}</button>${link}${time}${nt}</li>\n`
      + `  <li class="crew-dl"><div class="cd${d ? '' : ' bare'}${!d && form ? ' fm' : ''}" id="${id}">${d ? `<b>${cat ? `${esc(cat)} · ` : ''}${esc(title)}</b>${d}` : ''}${form}</div></li>\n`;
  };
  const NEWEST = new Set(['wait', 'ok', 'plan']);
  const order = (g) => (a, b) => (NEWEST.has(g) ? -1 : 1) * a.k.localeCompare(b.k) || a.i - b.i;
  // a group's units: lines, or a category line over its members, standing where its first member stands
  // A category is keyed by the parent's name: the row of that title when there is one (always, on the
  // plugin's own page), else the name alone (an outside updater's rows may name a category no row has).
  const units = (g, list) => {
    const its = [...list].sort(order(g));
    const catOf = (it) => (it.r ? key(hasParent(it.r) ? it.r.parent : it.r.group) : '');
    const subs = new Map();
    for (const it of its) { const c = catOf(it); if (c) { if (!subs.has(c)) subs.set(c, []); subs.get(c).push(it); } }
    const heads = new Map(its.filter((it) => it.r && subs.has(key(it.r.title))).map((it) => [key(it.r.title), it]));
    // one level, as the plugin's own rows are: a line that heads a category is never also a member of
    // its parent's (an outside updater's rows can nest two levels), so every line shows once
    const isHead = (it) => !!(it.r && heads.has(key(it.r.title)));
    for (const [c, ms] of subs) subs.set(c, ms.filter((x) => !isHead(x)));
    const out = []; const seen = new Set();
    for (const it of its) {
      const c = isHead(it) ? key(it.r.title) : catOf(it);
      if (!c) { out.push(lineFor(g, it)); continue; }
      if (seen.has(c)) continue;
      seen.add(c);
      const ms = subs.get(c); const head = heads.get(c);
      const m = { title: byTitle.has(c) ? byTitle.get(c).title : String(ms[0].r.parent || ms[0].r.group).trim() };
      const kids = ms.map((x) => lineFor(g, x, { prefix: false })).join('');
      if (g === 'ok') {
        // a finished category folds, closed; one open at a time inside Done today
        const all = head ? [head, ...ms] : ms;
        const last = latest(all);
        out.push(`  <li class="cat"><details name="trk-ok" id="${slugId('f-ok', m.title)}"><summary class="jh"><span class="jt">${esc(m.title)}</span><span>${all.length} · ${esc(last)}</span></summary><ol>\n${head ? lineFor(g, head, { prefix: false }) : ''}${kids}</ol></details></li>\n`);
      } else if (head) {
        out.push(`  <li class="cat"><ul class="ch">\n${lineFor(g, head, { prefix: false, extra: ` <span class="n">${ms.length}</span>` })}</ul><ol>\n${kids}</ol></li>\n`);
      } else {
        out.push(`  <li class="cat"><div class="jh"><span class="jt">${esc(m.title)}</span><span>${ms.length}</span></div><ol>\n${kids}</ol></li>\n`);
      }
    }
    return out;
  };

  // Active work: its head (and on the right Voice's icon and each working role's, with its count), its
  // lines; nothing running says so
  const sum = crew.length ? `<div class="crew-sum">${CREW_ROLES.filter((r) => r === 'voice' || working.some((e) => e.role === r)).map((r) => {
    const n = working.filter((e) => e.role === r).length;
    return `<span${n ? ' class="work"' : ''}${dev ? ` data-role="${r}"` : ''}${n >= 2 ? ` data-count="${n}"` : ''}${tip(r, n)}>${ICONS[r]}${n >= 2 ? n : ''}</span>`;
  }).join('')}</div>` : '';
  const stripLines = units('run', G.run).join('') || `  <li class="crew-none">${esc(L.none || LABELS.en.none)}</li>\n`;
  const strip = `<div class="hd">${esc(L.groups[GROUP.run])} <span>${G.run.length}</span>${sum}</div><ul>\n${stripLines}</ul>`;

  // the groups below: Owner and Waiting open (Waiting clamps after five), Done today one closed fold,
  // Plans one closed fold per group; an empty group is left out
  const sec = (g) => {
    const its = G[g];
    if (!its.length) return '';
    const head = esc(L.groups[GROUP[g]]);
    if (g === 'plan') {
      const byG = new Map();
      for (const it of [...its].sort(order('plan'))) { const k = String(it.r.group || it.r.parent || '').trim() || L.other; if (!byG.has(k)) byG.set(k, []); byG.get(k).push(it); }
      const folds = [...byG].map(([k, xs]) => `  <li class="cat"><details name="trk" id="${slugId('f-plan', k)}"><summary class="jh"><span class="jt">${esc(k)}</span><span>${xs.length}</span></summary><ol>\n${xs.map((x) => lineFor('plan', x, { prefix: false })).join('')}</ol></details></li>\n`).join('');
      return `<li class="sec pl"><div class="blk" data-k="plan"><div class="hd">${head} <span>${its.length}</span></div><ol>\n${folds}</ol></div></li>`;
    }
    const us = units(g, its);
    const long = (g === 'wait' || g === 'ok') && us.length > CLAMP;
    const more = `${L.more} (${its.length})`;
    const list = `<div class="clip${long ? ' clamp' : ''}" id="clip-${g}"><ol>\n${us.join('')}</ol></div>`
      + (long ? `<button type="button" class="more" aria-expanded="false" aria-controls="clip-${g}" data-label="${esc(more)}" data-less="${esc(L.less)}">${esc(more)}</button>` : '');
    if (g === 'ok') {
      const last = latest(its);
      return `<li class="sec"><div class="blk" data-k="ok"><details name="trk" id="f-ok"><summary class="hd">${head} <span>${its.length}</span><span class="lt">${esc(last)}</span></summary>${list}</details></div></li>`;
    }
    return `<li class="sec"><div class="blk" data-k="${g}"><div class="hd">${head} <span>${its.length}</span></div>${list}</div></li>`;
  };
  return { strip, list: ['you', 'wait', 'ok', 'plan'].map(sec).filter(Boolean) };
}

// The Active work strip alone, for a page an outside updater keeps (it takes the strip, its styles and
// scripts from here): with `script` the panel and state scripts come with it; the plugin's own page
// carries them once at its end instead.
function activeStrip(crew, rows, L, dev = true, { script = true } = {}) {
  return board(rows, crew, L, dev).strip
    + (script ? `<script id="panel">${PANEL_JS}</script><script id="state">${STATE_JS}</script>` : '');
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
  checkDecisions(rows, crew);
  const { strip: stripHtml, list } = board(rows, crew, L, dev);
  const ol = `<ol>\n${list.map((x) => '  ' + x + '\n').join('')}</ol>`;
  // the Active work strip is always there: what runs, or that nothing does
  const strip = `<section class="crew">${stripHtml}</section>\n`;
  if (!/<main\b[^>]*>[\s\S]*<\/main>/.test(html) || !/data-t="[^"]*"/.test(html)) die('index.html is not a tracker page');
  // a page's own <main> tag and what stands before its crew slot (a heading of its own) are kept
  html = html.replace(/(<main\b[^>]*>)([\s\S]*)<\/main>/, (m, open, inner) => {
    const at = inner.indexOf('<!-- crew -->');
    return `${open}${at >= 0 ? inner.slice(0, at) : '\n'}<!-- crew -->\n${strip}${ol}\n</main>`;
  })
    .replace(/data-t="[^"]*"/, () => `data-t="${clock.toISOString()}"`);
  // the theme and console styles and the clamp script are rebuilt last; no rounded corner or shadow
  // survives in any style
  html = html.replace(/\n<style id="theme">[\s\S]*?<\/style>/, '').replace(/\n<style id="console">[\s\S]*?<\/style>/, '').replace(/<script id="clip">[\s\S]*?<\/script>\n/, '')
    .replace(/<script id="since">[\s\S]*?<\/script>\n/, '')
    .replace(/<script id="panel">[\s\S]*?<\/script>\n/, '').replace(/<script id="state">[\s\S]*?<\/script>\n/, '')
    .replace(/<script id="answer">[\s\S]*?<\/script>\n/, '').replace(/<script id="motion">[\s\S]*?<\/script>\n/, '');
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (m, a, css, b) => a
    + css.replace(/border-radius:(?!0[;}\s!])[^;}]*;?/g, '').replace(/box-shadow:(?!none[;}\s!])[^;}]*;?/g, '') + b);
  // a page made before the strip gets its styles once
  if (crew.length && !html.includes('@keyframes crew-pulse')) html = html.replace('</style>', `${CREW_CSS}\n</style>`);
  // the Theme's tokens (tools/lib/theme.js) before the page's own styles, so a page's own palette has the last
  // word and the Theme fills in only what the page does not define (Lead, 2026-10-05: placed after them, they
  // turned a page's brand links blue); the console after everything, so its layout wins
  const first = html.search(/<style[\s>]/);
  if (first >= 0) html = `${html.slice(0, first)}<style id="theme">\n${theme.TOKENS_CSS}\n</style>\n${html.slice(first)}`;
  const at = html.lastIndexOf('</style>') + '</style>'.length;
  html = `${html.slice(0, at)}${first >= 0 ? '' : `\n<style id="theme">\n${theme.TOKENS_CSS}\n</style>`}\n<style id="console">\n${CONSOLE_CSS}\n</style>${html.slice(at)}`;
  // the clamp first (a restored long list opens through its button), then the panel, then the saved state
  html = html.replace('</body>', () => `<script id="clip">${CLIP_JS}</script>\n<script id="panel">${PANEL_JS}</script>\n<script id="state">${STATE_JS}</script>\n<script id="answer">${ANSWER_JS}</script>\n<script id="motion">${MOTION_JS}</script>\n</body>`);
  // the elapsed-time script only when a strip line has something to count
  if (crew.some(ticks)) html = html.replace('</body>', () => `<script id="since">${SINCE_JS}</script>\n</body>`);
  fs.writeFileSync(pagePath, html);
  if (stamped) writeStore(rowsPath, store);
  if (!quiet) console.log(`rows: ${rows.length}`);
}

function upsert(dir, opt) {
  if (!dir || !opt.title || !opt.state) die('usage: tracker.js row <dir> --title "<text>" --state run|you|wait|ok|plan [--small t] [--url u] [--label t] [--group t] [--option "A|label|text" --option "B|label" --recommend A --why "one line"]');
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
  if (opt.option) row.options = opt.option.map((x) => { const [k, l, ...t] = String(x).split('|'); const o = { key: k.trim() }; if (l && l.trim()) o.label = l.trim(); if (t.join('|').trim()) o.text = t.join('|').trim(); return o; });
  if (opt.recommend) row.recommend = opt.recommend;
  if (opt.why) row.why = opt.why;
  const i = rows.findIndex((r) => r && key(r.title) === key(opt.title));
  // the parent stays unless given: re-running a sub-job's row must not ungroup it
  const parent = opt.parent !== undefined ? opt.parent : (i >= 0 ? rows[i].parent : undefined);
  if (parent) row.parent = parent;
  if (i >= 0) rows[i] = row; else rows.push(row);
  checkParents(rows); // before writing: a refused row leaves rows.json alone
  checkDecisions(rows, store.crew);
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
  checkDecisions(store.rows, store.crew); // before writing: an owner decision needs its row's options
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
module.exports = { devModeFor, LABELS, CREW_CSS, CONSOLE_CSS, STRIP_CSS, CLIP_JS, SINCE_JS, PANEL_JS, STATE_JS, ANSWER_JS, MOTION_JS, activeStrip, board, slugId, checkDecisions, stampSince, CREW_ROLES, upsertCrew, readCrew, Refused };
