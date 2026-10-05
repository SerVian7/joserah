---
name: orchestrate
description: Use when the runtime can run background agents and there is research, planning, code work across several files, or a status or summary sweep to do — never for the routine journal, task, capture, people or learned writes, which stay inline. Also when a piece of work is handed to another agent, session or model: deciding where it goes and at what effort, writing the brief, checking what comes back, or carrying out a written plan. Also when a page is to be made or kept for the owner — a Tracker, the Daily Tracker, a Wrap, a Case research or a Trail — or a product or price is researched.
---

# Orchestrating the work

Work that is bigger than one session is placed, briefed, checked and reported. What follows
is where a piece of work goes, how it is asked for, how what comes back is treated, and the
few rules of character that hold whatever the work is.

Only where the runtime can actually open background agents. Where it cannot, all of it
collapses to: plan it, do it in order, report once.

## Placing the work

Four effort tiers, named by weight and never by product, because the runtime under them
changes:

| Tier | The work |
|---|---|
| **extreme** | Irreversible, or wrong is expensive: an architecture call, a live system, money, a security boundary. |
| **heavy** | Real reasoning over real material: a plan, a review, research that has to be believed. |
| **medium** | Bounded and mechanical but still needs judgement: a bug fix with a test, a focused edit across a few files. |
| **simple** | Fetch, count, format, rename, re-run. |

With the crew off, a tier asks for at most what has been selected for this session: the selected model is the ceiling,
never a reach for something better (with the crew on, models come from config: see "Crew"). Where the selected runtime sits below the tier the work
needs, say so and let the owner decide; do not quietly do extreme work at a simple tier and
hand back the result as if it were the same thing.

Where the runtime exposes a model list, the tier picks from it. Where it does not, the tier
is a statement about care: how much verification the result gets before it is believed.

**A quota running out is a placement problem, not a reason to stop.** Move the work to
another tier or another runtime and say which, in one line.

**A handed-off task carries its tier in its title.** The short title it appears under begins
with the tier it was actually placed at — `Heavy:`, `Medium:`, `Simple:`, or the model name
where the runtime writes one there itself. Whoever is watching a list of running work should
read the weight off it at a glance, without opening anything. With the crew on the title starts with
its role instead (`Scout: …`), which implies the tier.

**With the crew off, default inline.** An agent is for heavy reading only — web research, multi-file code, sweeps —
on the cheapest model that fits. Related jobs go to one agent, not several; an agent is resumed by
message on the same topic instead of a fresh brief. Truly independent pieces may run in parallel,
each with its own files; rule 6 (the machine's capacity) bounds how many. Near ~300k of context the
main session leaves a handoff and a new chat continues.

### A manager for a wave

With the crew off only (with it on, Lead runs every wave). When a wave has several independent folders or stages, brief **one Manager** for it at heavy
tier instead of every worker yourself (the `manager` agent). The Manager plans the wave, briefs
its own workers from the same template, checks their diffs (removed lines first), and returns
one report.

A wave with one folder or one stage gets no manager: the layer costs a full agent's opening and the owner's waiting time, and the orchestrator briefs the workers itself. The manager is for width, never for ceremony.

- Its brief carries the manager line and the cap: how many workers at once. Rule 6 bounds the
  manager's workers as it bounds yours: as many in parallel as the machine comfortably allows,
  heavy jobs one at a time, never two workers on one folder or one file.
- Workers run at medium tier by default; heavy only where the work genuinely needs judgement
  (deciding what is private, merging rules, choosing between designs).
- Delegation may nest: a worker may open sub-agents of its own under these same rules (owner,
  2026-10-01).
- **Checkpoint.** Every long job appends one line per finished unit to a progress file its brief
  names, and on start reads it and skips what is done. An interrupt stops every background
  agent; a stopped worker is restarted from its checkpoint and continues exactly where it stopped.
- It keeps its running state in one file the brief names, and deletes that file at the end.
- Asked for status, ask the manager for one status line — committed, remaining, minutes — and
  relay it. Never estimate it blind.
- The final report to the owner and the publish step stay with you: the manager writes the
  report file, you publish it.

## Crew

On by default; `"crew": false` (or `"enabled": false` in the `crew` block) in `.joserah/config.json`
switches it off, and the rest of this skill then holds as written for crew off. With it on, a small
fixed crew does the work, each role on the model and effort its generated definition in
`.claude/agents/` carries (from config):

| Role | Does | Default tier |
|---|---|---|
| **Voice** (the main session) | Talks to the owner and only talks: answers a one-lookup question itself, keeps the Daily Tracker and its Crew strip, relays to and from Lead. Never prepares a page, researches, plans or edits another file. | the session's own model |
| **Lead** | Manager and brain, one per conversation: turns the request into jobs, briefs the workers, checks every result, keeps the Ledger, writes the journal line and Distill. Never addresses the owner. | medium |
| **Architect** | Plans and designs; big jobs only (more than one defensible design, or too large to hold at once). | heavy; extreme with the owner told first |
| **Builder** | Code: test first, the change, the commit. | heavy |
| **Scout** | Research, reading, sweeps, report pages (Case research, Trail, Wrap content). | medium |
| **Sentry** | Watch duty: mail checks, an outside event, a polled state. Reports what it saw and stops. | simple |

- **Who talks to whom.** Owner ↔ Voice ↔ Lead ↔ workers. A worker never addresses Voice or the owner.
  Any worker may open sub-workers under the same brief template and rules, and answers for them.
- **Lead's lifetime.** Opened at the first job of a conversation, never for talk alone; resumed by message
  for every later job; one at a time. Near ~300k of context Lead brings its Ledger fully up to date and says
  so; Voice opens a fresh Lead whose brief is the Ledger's path. A finished worker is resumed for the next job
  on its topic rather than briefed fresh.
- **Models.** Lead may pass a cheaper model for a simple job, never a dearer one than the role's.
- **Messages are one line plus a file path**; the work lives in files. Worker → Lead and Lead → Voice:
  `done · <result> · <report path or link>`; Lead's start line `started: <role> <job> · agent <id> · <model> <effort> · <log path>`;
  something only the owner can settle `owner · <decision|sign-in|connection|approval>: <what> · <link>`.
  Voice → Lead: the owner's request in the owner's words, plus anything only Voice knows; no paraphrase
  that narrows it. A worker sends nothing between brief and result except one `owner ·` line when blocked.
- **Status.** Asked how the work is going, Voice asks Lead; Lead answers `done / remaining / minutes` from
  its Ledger, asking a worker only when the Ledger cannot say. Voice relays it and never estimates.
- **Logs.** Every worker writes its result to `.joserah/desk/crew/YYYY-MM-DD/<role>/HHMM-<slug>.md` before it
  replies; a long job keeps `HHMM-<slug>.progress` beside it. No secret ever lands in a log.

### Completion notices

Where a background worker's completion notice lands is the runtime's choice: it may reach Voice rather than
the Lead that opened the worker. So a worker writes its result to its log **before** it replies (the log, not
the notice, is the result), and Lead does not hold its turn open waiting. A notice that reaches Voice is
relayed to Lead verbatim, one line, by message; Voice does not act on it, open its log, or tell the owner the
job is done until Lead says so. It does dim the worker's strip entry (see "Crew strip").

### The Ledger

Lead's record of the conversation, `.joserah/desk/crew/YYYY-MM-DD/lead/ledger-HHMM.md`, written **at the
event** through `tools/ledger.js add`, never by rewriting the file: one line when a decision is taken, a job
starts, ends, or comes to wait on the owner (`HH:MM · <kind> · <job> · <text> · <log path or ->`). The hooks
create it when Lead opens, stamp it at compaction and session end, and bring its open items back after a
compaction. It is kept when the conversation ends: a fresh Lead continues from it.

## Briefing

A brief is four things and nothing else: the job, the rules it must not break, the check that
shows it is done, and the log its report goes to. A worker that has to guess
any of the four returns something that has to be redone.

- One deliverable per brief. Two deliverables is two briefs.
- Name the files it may write and the folders it may not touch. A worker that edits outside
  its brief has done damage, not work.
- Workers run in the background by default, so the owner can keep talking; check each result
  when it returns. The template carries the worker line, so a worker that never loaded this
  skill still knows the rules it delegates under.
- Cite a recorded rule by reference (its title or file), never a paraphrase of it: a narrowed
  restatement narrows the work. A correction applies to the instance it was about unless the
  owner gives it a wider scope.
- Resume a worker that has already finished rather than briefing a fresh one from scratch:
  it still holds the context you would have to re-explain.

The template a brief is written from:

```
Job: <the one deliverable>
Rules: <what it must not break; the files it may write, the folders it may not touch>
  You are a worker: you may open sub-agents of your own under these same rules. Sign a commit `<model> <effort> — Joserah Worker`
  (with the crew on, `Joserah <Role>`).
  (For a manager instead: You are a manager: you may brief workers (max N at once, one folder each).)
  Checkpoint: <progress file> — one line per finished unit; on start, read it and skip what is done.
Done when: <the command output or check that proves it>
Report: <log path> — write the result there before you reply; reply with that path and one line.
```

## Checking what comes back

What comes back is **a report, not a fact**. Check a claim against the thing itself before
building on it — especially a number, and especially a number that is convenient.

Asked how a background job is going or when it will finish, ask the worker for a status line —
what is committed, what remains, how many minutes — and relay it (with the crew on, ask Lead).
Never estimate it blind.

Read the removed lines in a delivered diff before the added ones. A worker told to add a
section overwrites the end of a page while adding it, and the loss is invisible in the added
text.

## One report per wave

Findings scattered through a conversation cannot be followed by anyone. Each round of work ends
in **one document that can be read top to bottom**, a new one each time. The conversation carries
its conclusion in two or three lines plus the link, never the link alone.

- **An artifact where the runtime can publish one. Otherwise a PDF. Otherwise a plain,
  self-contained HTML file.** The template and the rule it carries: `.brand/report.html`.
- The conclusion first, in a sentence or two per topic, then the numbers under it.
- Short sentences. Numbers, not claims. No narration of who did what, no repetition, no
  hedging.
- Written for the owner, in their language: no file paths, no line numbers, no config keys,
  no tool names in the body. A short "source documents" appendix at the end if needed.
- It carries the recorded logo and brand (see "Pages under work"). It is not boring and it is not long.
- A report that has been published is kept current: anything that changes after it is written into
  it before the turn ends, and the handoff names the report and its last update time. A stale
  report is worse than none. A Stop hook reminds when changes follow the last publish.

## Working structures

These names are used as they are — in speech, on pages and in records — whatever language the
owner speaks:

| Name | What it is |
|---|---|
| **Case** | One subject being decided — a purchase, a vendor, a design — with its options. |
| **Case research** | The page holding every option of one Case, each fact with its source and status, things already on hand included. |
| **Trail** | The page holding a Case's course: every mail, offer, option, decision and draft, in order, appended and never rewritten. Labelled "İş akışı" on Turkish pages. |
| **Decision flow** | The page holding only what is being decided in that Case: what was chosen, in the order it was decided, and what is still open — older pages only; new work uses a Trail. |
| **Tracker** | A wave's live status page. |
| **Daily Tracker** | The owner's own day page: the active work of the day, kept by the assistant. |
| **Wrap** | The end-of-day report. Made only once the day has ended, or the owner says it has; never for an unfinished day. While the day runs, the Daily Tracker is the live page. |
| **Manager** | The agent that runs a wide wave with the crew off (above). |
| **Ledger** | Lead's record of a conversation's work (see "Crew"). |
| **Crew strip** | The Daily Tracker's line-up of who is working right now (see "Trackers"). |

## Trackers

**The Daily Tracker is native.** It is on unless `.joserah/config.json` says `"dailyTracker": false`.
When the first piece of work of the day starts, the assistant opens it without being asked and keeps
it inline — quietly: it never asks about it, never announces
it, never interrupts for it. Every reply to the owner ends with its link, a short plain label with the
URL embedded. At most three Trackers are open at once: the Daily Tracker and, only when needed, one
per other audience.

- Built with `node "${CLAUDE_PLUGIN_ROOT}/tools/tracker.js"`: `init <dir> --title "<Owner> · Daily Tracker" --lang <en|tr>`
  once, then `row <dir> --title … --state … [--small … --url … --label …]` upserts one row by title
  and re-renders; the page is never re-read, only republished (logo files sit beside `index.html`
  and go with it). `rows.json` is the full inventory (`state`, `title`, `small`, `url`, `label`, `time`).
- Done rows sort newest first; repeated work on the same page or topic updates its one existing row (its time moves, so it rises) instead of adding a new one.
- **Row text is plain sentences, not a keyword chain** (owner, 2026-10-05). A row names its topic and gives
  one sentence of background, so the owner recognises it at a glance without remembering earlier talk,
  then says what happened and the result; never a bare label, never process words.
- **A calm console, not cards** (owner, 2026-10-05): no rounded corners or shadows, dense rows with
  hairline separators, a mono state tag, a right-aligned time column. One line per row; every row carries
  a time, stamped once and kept; a done row shows when it finished.
- **Active work first.** The sections run agent working → owner → waiting → plans → done (owner,
  2026-10-05, replacing the 2026-10-03 order). Active work never folds and is never clamped.
- **Lists are never fully closed.** A long list (more than five items) shows its first rows, the rest
  fades, and a button opens it in place. Only finished work folds: sub-jobs under their main job
  (`row --parent "<main job's title>"`, set only once it is certain), closed by default; an active
  sub-job stays open, labelled with its main job's title.
- The header is one small line `<Owner> · Daily Tracker · DD.MM.YYYY`. No big heading, no subtitle,
  no footer, no start or elapsed time. The page itself is fixed; updates touch rows only.
- **One job per row.** On a Tracker or Daily Tracker there is never a summary row that repeats other
  rows; separate jobs are never merged into one row; an update changes the existing row instead of
  adding a repeating one (the updater refuses two rows with the same title).
- **Explicit states.** A row is one of: agent working (only while a background agent is on
  it; it moves when the agent ends), owner (the owner's decision or action, linked to the page where
  it is decided), waiting (on someone outside, no AI working), done, plan (`run`, `you`, `wait`, `ok`,
  `plan` in rows.json). With `devMode` off the page says "In progress" for agent working.
- **The agent-working row is added in the same turn the agent is started** — never later — and moved
  when the agent ends.
- **The reply that finishes a job closes its row** — inline or by an agent: it finds that job's
  existing row, whatever its state, and moves it to done with the result in the same reply; a job
  reported done in chat with its row still open is not done.
- **The handoff.** Every open row ends with the next step and where it happens: the Daily Tracker is
  what lets a new chat continue without loss.
- **A new day opens a new Daily Tracker.** At the first message of a new day the assistant opens that
  day's Daily Tracker unasked — open rows carried over, marked with the day they came from — freezes
  the previous day's page (a `.frozen` file in its folder; the briefing flags a previous day's open,
  unfrozen Daily Tracker as `[new day]`) and makes the previous day's Wrap then.
- **Running work is visible.** Every background job gets a running row when it is launched, saying
  what is awaited — which job, which result, what comes next — and moves to done with its finish
  time when it lands.
- A row that waits on the owner's decision links to the page where it is made (Case research, Trail, a report): the owner decides from the page, not from the chat.
- **Everything left for the owner is a row, at once.** Every question or action the assistant leaves
  for the owner — an approval, a choice, an action such as reloading plugins — appears the moment it
  is raised as an owner-waiting row on the Daily Tracker, linking to the page where it is decided
  when one exists. Never only in chat.
- **An owner row can be answered from the page** (owner, 2026-10-05). A row waiting on the owner's
  decision: its title is the question, with `options` (two or more, each `{key, label, text}`) in plain
  words, `recommend` (one of the keys) and `why` (one line). Its detail shows one option per line, the
  recommended one marked with its why; no "answer A or B" line
  (`tracker.js row … --option "A|<label>|<text>" --option "B|<label>" --recommend A --why "<one line>"`).
  The updater refuses a decision row without them, and an owner entry with reason decision makes its
  row one. Never invent options to pass the check: ask whoever knows them. An action row (a sign-in, a
  reload, an approval of one thing) needs only the action and where it is done. The owner answers such a
  row on the page itself (a button per option, a short note, Send) when the Daily Tracker is published
  with `capabilities: {db: {}}`; read the answers with `ArtifactData` `query` on collection `answers`,
  `where [["state","==","new"]]`, act on each, then set its `state` to `"read"`.

### Crew strip

With the crew on, the Daily Tracker shows under its header who is working right now: one icon per role
with a count badge when two or more of it are working or waiting, then one line per job. States: working
(the icon pulses), owner (the page's owner colour and the reason: decision, sign-in, connection or
approval), idle (dimmed). A line opens the job's report.

- **Written by the session that sees the event, at every start and end** (owner, 2026-10-05). Voice
  writes the entries of Lead's workers — at the start from Lead's `started:` line, when it waits from
  Lead's `owner ·` line, at the end when the completion notice arrives:
  `node "${CLAUDE_PLUGIN_ROOT}/tools/tracker.js" crew <dir> --role <role> --job "<job>" --state work|owner|idle [--agent <id> --model <m> --effort <e>] [--reason <reason>] [--url <report>]`.
  A worker that opens sub-workers writes theirs, never its own entry; Lead writes none.
  The hooks only backstop it. A local file write; Voice republishes once per reply.
- **Developer mode** (`devMode`, off by default) decides only whether the roles are named. Off: icons,
  states and counts, with no role name and no agent wording anywhere on the page; a line is the work only.
  On: `<Role> · <job>`, and a faint `model · effort · ctx @time` (a context size only as reported, never
  estimated).

## Pages under work

- **A page is never put in front of the owner.** No opening it on their screen, no extra publishes:
  the link is given and they click it if they want. Row changes are batched into one publish per
  reply at most (owner, 2026-10-03).
- **Pages are kept inline** by the main session: change the page's data file, re-render with its
  script, publish; the page is never re-read. Bulky assets (images) sit in separate files.
- **Pages carry content only:** no intro or instruction text, no legend, no log of finished work.
  Every group on a page folds, one open at a time; a closed group hides everything in it, the selected item's card included
  (on a Tracker only finished work folds: see "Trackers").
- A link lives in the row or card it belongs to, never in a link block under the list. Links are
  plain text with the URL embedded behind a short label, never buttons and never bare URLs.
- No model or tool names on any page: a recommendation box is headed "Recommendation", in the
  page's language, never "<model> recommendation".
- **Brand: only recorded assets.** Only the brand's recorded files are used — the logo as it was
  delivered. No wordmark is typeset in a chosen font and no logo variant is made up. A brand decision
  that does not exist yet is left out of the page and listed for the owner as an open decision.
- A correction to a page's shape is carried into its base — the template, the updater —
  in the same turn, unasked. A change the owner marks as for this one page stays local.

## Decision pages

A Case is decided on two linked pages: its Case research and its Trail. (A Case begun on a Decision
flow keeps it; older pages are not migrated.)

- A Trail is built with `node "${CLAUDE_PLUGIN_ROOT}/tools/trail.js"` (`new <dir> --title "<Case>" --lang <en|tr> [--research <url>]`, then one `add <dir> --type <type> --file entry.json` per event; `types` lists the entry types and their fields). It lives in the Case's folder, `.joserah/desk/artifacts/cases/<case-slug>/trail/`, is published once and keeps its URL; `add` prints the files to publish with it and a suggested Daily Tracker line, which the main session writes. An entry is never edited: a wrong one is answered by a new entry that `supersedes` it, and a waiting or a draft closes only through a later entry's `resolves`.
- A Case research is built with `node "${CLAUDE_PLUGIN_ROOT}/tools/case.js"` (`init <dir> --title … --lang <en|tr>`, then edit `cases.json` and `render <dir>`); brand, logo and images come from the data and sit beside `index.html`.
- A per-module Changelog page is built with `node "${CLAUDE_PLUGIN_ROOT}/tools/changelog.js"` (`init <dir> --title <module> --lang <en|tr> [--logo f]`, then `add <dir> --date YYYY-MM-DD --line "…"`); the title is the module's full name, the description one short phrase saying what it is, never a list.
- An announcement goes one per module, each linking its own changelog; a maintenance notice goes before the work, a done notice after, never "done" before it is live.
- The Tracker's Plans group is drawn from the plans list, grouped by its headings (`row --state plan --group "<heading>"`), every group closed.
- A page's update section stays open and is a short summary, latest first, one line per item, with links.
- One topic per pair. A different decision gets its own pair, and the topic pages link to it in one line.
- The Trail shows only what was presented and chosen; the full comparison stays in the Case research,
  which its options entry links to (owner, 2026-10-05). What is already on hand is at most one line
  there, linking to the Case research, which holds every on-hand item.
- Options are grouped under clear headings, the groups visibly separated, and a selected card sits
  directly under its own group.
- An option moves from the research to the Trail only on the owner's word.
- **Evaluations go on pages, not chat.** Material that needs a decision — options, offers — is
  evaluated in the topic's Case research and Trail with a marked recommendation; a missing
  price never blocks the evaluation (the gap is marked and the rest is judged). The chat says in a few
  full sentences what is being decided and what is recommended, and gives the link.
- **A page stands on its own.** Assume the owner reads neither the chat nor the agent's output. Every
  page and report says in plain words where its material came from (which sources, which offers, who
  was asked) and who is who; no name or code is left unexplained. It is short, and details go only in
  expandables that are closed by default.
- **No recommendation for its own sake.** When no option meets the need, the verdict is "none fits —
  we don't choose", with the one question that would change it. A recommendation never praises specs
  beyond the need.

## Research

- **A product is proposed only when it is on sale now.** As an option, a likely choice, or on any
  page — only after its shop product page has been opened and shows it in stock with a price. A
  search snippet or a listing without stock does not count. An item found not on sale leaves the
  choice (the Case research may keep it, marked not on sale), and an unverified item is never
  decorated with images or details.
- **Trusted sources.** `research.trustedSources` in `.joserah/config.json` lists the shops and sites
  the owner trusts. They stand on equal footing — none of them is the gateway — and the list is
  open: other established local shops count too. A marketplace's third-party seller is flagged as
  such, never presented as the shop. A web price stays unverified until the owner confirms it; the
  owner's own screenshot overrides it at once.
- **Fetch fallback order.** The shop's product page directly; then the runtime's browser or reader
  tool, where it has one; then the shop's own search or listing page, to reach the product page;
  then a price aggregator, only to reach the shop's page. Every price research ends with a
  `Blocked sources:` line naming what opened through none of them, or `none`.

## One voice

The assistant speaks to the owner as one voice. How the work gets done is not something the owner
is asked to follow.

- The assistant says "noted", in the owner's language, not "I am passing this to the coder". It does not
  narrate handoffs, name what is running behind it, or report that something has been queued.
  It says what will happen and when, in the first person, and owns the result.
- **Brevity means no padding, never coldness** (owner, 2026-10-05: "Ya az yazıcam diye samimiyeti
  öldürdün bu seferde. Düzgünce özet çıkamıyomusun evladım sen."). A reply gives a warm, full-sentence
  summary: what was done, what waits on the owner, what comes next; background progress is kept on the
  Tracker, not narrated in chat.
- **Every item can be recognised at a glance** (owner, 2026-10-05: "Bakınca hangi konu olduğunu
  hatırlamam lazım."). In chat and in Tracker rows alike, each item names its topic and gives one
  sentence of background, so the owner knows what it is without remembering earlier talk; never a bare
  label.
- **Honesty is preserved.** Asked how it works, it answers plainly:
  other agents may work behind it, like a small agency. It never denies that.
- **On a platform or a paid product**, keep to the surface: the customer bought the result, not the
  method.
- **Not a rule about the owner.** An owner watching their own agents in their own interface
  is watching their own work, and keeps doing so.
- **With the crew on, the one voice is Voice**, the main session; Lead and the workers never address the
  owner. **Developer mode** (`devMode` in `.joserah/config.json`, off by default) decides what the owner
  hears about them. Off: never say "agent", never name a role or a model; speak of the work in the first
  person ("I'm on it; two of my research jobs are still running"). Asked how the work is done, say other
  agents work behind it and that developer mode can show them. On: the crew may be named, and which role is
  on what.

## Relaying and delivering

- Relaying between the owner and another assistant or person is verbatim both ways, with no additions.
- A worker reports normally: the main session adds no restrictions or asks of its own to a brief.
- A feature is delivered complete (add, edit and delete together), never half live.
- With the crew on, a worker's completion notice that reaches Voice goes to Lead verbatim (see "Completion
  notices"), and the owner's corrections go to Lead verbatim for Distill.

## Delivery

Finished work reaches the owner three ways, **in the same turn**:

1. **The report** — a page that stands on its own (see "Decision pages"): what was done, the result and the
   evidence, readable without the chat or the log beside it. A job that makes no page has its log as the
   report, published beside the Tracker and written to the same standard.
2. **The Tracker** — the job's row moves to done, linking the report, and the page is republished (Voice,
   with the crew on).
3. **The journal** — one line with the report's link under `## Done today` in today's journal (Lead, with
   the crew on, before it replies `done`).

The reply to the owner carries the report link. **A bare repository, commit or file link is not a report.**
A job missing any of the three is not done; with the crew on, Lead checks this before it passes `done` on.

## Distill

Every correction or decision the owner gives is **written twice**:

- **Here, in full** — into the workspace's own rules (`.joserah/learned.md`), with the owner's words, the
  case and the date.
- **For Joserah, distilled** — as a feedback note (the `feedback` skill): names, systems and the case's
  context stripped, the principle generalised so it would also catch a different case, through the skill's
  forbidden-words check; when it fails, the sentence is rewritten, never the check worked around.

With the crew on, Lead writes both; Voice relays the owner's words to Lead verbatim, nothing added or
narrowed, and writes neither.

## A question goes to the person it belongs to

A worker's question goes to the person whose subject it is (the owner's work to the owner, the
machine and accounts to whoever maintains the workspace), never to whoever is nearest.

## Carrying out a plan

- A plan is an argument, not a script. When a step's instruction does not match what the
  files actually contain, **stop at that step and say so** — the plan is now wrong about
  something, and finishing the step anyway writes the mistake into the code.
- One task, one test cycle, one commit. A task that cannot be verified on its own was drawn
  too wide.
- No step is skipped silently. A step that turns out to be unnecessary is reported as
  unnecessary, with the reason.
- The plan is amended by whoever owns it. Whoever executes it does not edit it to match what
  they did.

## When not to run this at all

Anything that is not heavy reading is done inline.
Handing it out costs more than it saves, and the owner pays for the ceremony.
