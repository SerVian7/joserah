---
name: orchestrate
description: Use when the runtime can run background agents and there is research, planning, code work across several files, or a status or summary sweep to do — never for the routine journal, task, capture, people or learned writes, which stay inline. Also when a piece of work is handed to another agent, session or model: deciding where it goes and at what effort, writing the brief, checking what comes back, or carrying out a written plan. Also when a page is to be made or kept for the owner — a Tracker, the Daily Tracker, a Wrap, a Case research or a Decision flow — or a product or price is researched.
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

A tier asks for at most what has been selected for this session: the selected model is the ceiling,
never a reach for something better. Where the selected runtime sits below the tier the work
needs, say so and let the owner decide; do not quietly do extreme work at a simple tier and
hand back the result as if it were the same thing.

Where the runtime exposes a model list, the tier picks from it. Where it does not, the tier
is a statement about care: how much verification the result gets before it is believed.

**A quota running out is a placement problem, not a reason to stop.** Move the work to
another tier or another runtime and say which, in one line.

**A handed-off task carries its tier in its title.** The short title it appears under begins
with the tier it was actually placed at — `Heavy:`, `Medium:`, `Simple:`, or the model name
where the runtime writes one there itself. Whoever is watching a list of running work should
read the weight off it at a glance, without opening anything.

Independent pieces go to separate workers at once, in parallel, each with its own files and no
shared file between them; only steps that depend on each other's output go to one worker in
sequence. Rule 6 (the machine's capacity) still bounds how many run at once.

### A manager for a wave

When a wave has several independent folders or stages, brief **one Manager** for it at heavy
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
- Every page the wave feeds has a keeper (see "Pages under work").
- It keeps its running state in one file the brief names, and deletes that file at the end.
- Asked for status, ask the manager for one status line — committed, remaining, minutes — and
  relay it. Never estimate it blind.
- The final report to the owner and the publish step stay with you: the manager writes the
  report file, you publish it.

## Briefing

A brief is four things and nothing else: the job, the rules it must not break, how it will
be verified, and the exact shape of the report it must return. A worker that has to guess
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
  You are a worker: you may open sub-agents of your own under these same rules. Sign a commit `<model> <effort> — Joserah Worker`.
  (For a manager instead: You are a manager: you may brief workers (max N at once, one folder each).)
  Checkpoint: <progress file> — one line per finished unit; on start, read it and skip what is done.
Verified by: <the command or check that proves it>
Report: <the exact shape of what comes back>
```

## Checking what comes back

What comes back is **a report, not a fact**. Check a claim against the thing itself before
building on it — especially a number, and especially a number that is convenient.

Asked how a background job is going or when it will finish, ask the worker for a status line —
what is committed, what remains, how many minutes — and relay it. Never estimate it blind.

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
| **Decision flow** | The page holding only what is being decided in that Case: what was chosen, in the order it was decided, and what is still open. |
| **Tracker** | A wave's live status page. |
| **Daily Tracker** | The owner's own day page: the active work of the day, kept by the assistant. |
| **Wrap** | The end-of-day report. Made only once the day has ended, or the owner says it has; never for an unfinished day. While the day runs, the Daily Tracker is the live page. |
| **Manager** | The agent that runs a wide wave (above). |

## Trackers

**The Daily Tracker is native.** It is on unless `.joserah/config.json` says `"dailyTracker": false`.
When the first piece of work of the day starts, the assistant opens it without being asked and keeps
it through a keeper (the `tracker-keeper` agent) — quietly: it never asks about it, never announces
it, never interrupts for it. Every reply to the owner ends with its link, a short plain label with the
URL embedded. At most three Trackers are open at once: the Daily Tracker and, only when needed, one
per other audience.

- Built with `node "${CLAUDE_PLUGIN_ROOT}/tools/tracker.js"`: `init <dir> --title "<Owner> · Daily Tracker" --lang <en|tr>`
  once, then `<dir>` after every change to `<dir>/rows.json`. `rows.json` is the full inventory of
  rows (`state`, `title`, `small`, `url`, `label`, `time`); the page is rebuilt from it.
- Groups in this order: running and waiting on the owner → done → plans. One line per row; every
  row carries a time, stamped once and kept; a done row shows when it finished.
- The header is one small line `<Owner> · Daily Tracker · DD.MM.YYYY`. No big heading, no subtitle,
  no footer, no start or elapsed time. The page itself is fixed; updates touch rows only.
- **One job per row.** On a Tracker or Daily Tracker there is never a summary row that repeats other
  rows; separate jobs are never merged into one row; an update changes the existing row instead of
  adding a repeating one (the updater refuses two rows with the same title).
- **Explicit states.** A row is one of: agent working (only while a background agent is on
  it; it moves when the agent ends), owner (the owner's decision or action, linked to the page where
  it is decided), waiting (on someone outside, no AI working), done, plan — grouped in that order
  (`run`, `you`, `wait`, `ok`, `plan` in rows.json).
- **The handoff.** Every open row ends with the next step and where it happens: the Daily Tracker is
  what lets a new chat continue without loss.
- **A new day opens a new Daily Tracker.** At the first message of a new day the assistant opens that
  day's Daily Tracker unasked — open rows carried over, marked with the day they came from — freezes
  the previous day's page (a `.frozen` file in its folder; the briefing flags a previous day's open,
  unfrozen Daily Tracker as `[new day]`) and makes the previous day's Wrap then.
- **Running work is visible.** Every background job gets a running row when it is launched, saying
  what is awaited — which job, which result, what comes next — and moves to done with its finish
  time when it lands.
- A row that waits on the owner's decision links to the page where it is made (Case research,
  Decision flow, a report): the owner decides from the page, not from the chat.
- **Everything left for the owner is a row, at once.** Every question or action the assistant leaves
  for the owner — an approval, a choice, an action such as reloading plugins — appears the moment it
  is raised as an owner-waiting row on the Daily Tracker, linking to the page where it is decided
  when one exists. Never only in chat.

## Pages under work

- **A keeper per page.** Every page that work feeds has a keeper agent while the work runs.
  Workers send each verified finding to it the moment it lands, and the keeper adds it to the page
  and to its job log at once — the page grows during the work, never only at the end.
- **A job log under the title.** Directly under the page title, one expandable line, closed by
  default: `running · N` while anything runs, `done · log` after (in the page's language). It lists
  the page's jobs with state and time; a job is added when it starts, and the line stays as a log.
  `<details><summary>running · 2</summary><ul><li>…</li></ul></details>` is enough.
- Process status is never a content section of the page.
- A link lives in the row or card it belongs to, never in a link block under the list. Links are
  plain text with the URL embedded behind a short label, never buttons and never bare URLs.
- No model or tool names on any page: a recommendation box is headed "Recommendation", in the
  page's language, never "<model> recommendation".
- **Brand: only recorded assets.** Only the brand's recorded files are used — the logo as it was
  delivered. No wordmark is typeset in a chosen font and no logo variant is made up. A brand decision
  that does not exist yet is left out of the page and listed for the owner as an open decision.
- A correction to a page's shape is carried into its base — the template, the keeper, the updater —
  in the same turn, unasked. A change the owner marks as for this one page stays local.

## Decision pages

A Case is decided on two linked pages: its Case research and its Decision flow.

- One topic per pair. A different decision gets its own pair, and the topic pages link to it in one line.
- The Decision flow carries only what is being decided. What is already on hand is at most one line
  there, linking to the Case research, which holds every on-hand item.
- Options are grouped under clear headings, the groups visibly separated, and a selected card sits
  directly under its own group.
- An option moves from the research to the flow only on the owner's word.
- **Evaluations go on pages, not chat.** Material that needs a decision — options, offers — is
  evaluated in the topic's Case research and Decision flow with a marked recommendation; a missing
  price never blocks the evaluation (the gap is marked and the rest is judged). Chat carries one line
  and the link.

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
- **Honesty is preserved.** Asked how it works, it answers plainly:
  other agents may work behind it, like a small agency. It never denies that.
- **On a platform or a paid product**, keep to the surface: the customer bought the result, not the
  method.
- **Not a rule about the owner.** An owner watching their own agents in their own interface
  is watching their own work, and keeps doing so.

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

A single small edit whose shape is clear gets done directly.
Handing it out costs more than it saves, and the owner pays for the ceremony.
