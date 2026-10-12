# JSON-driven pages: Tracker first, then every page template

Date: 2026-10-13 · Status: approved in conversation, awaiting owner review of this file
Owner words (verbatim): "tracker oluşturma promptunda bariz sorunlar var çok şişti akrıştı baştan düşünülmeli bu yapı. sürekli toke yemeden bir json atıp yenileyebilmelisin." · "Tracker jsonları günlük oluşturmayı da hızlandıracak. emin ol. bittikçe loga." · "tüm şablonlar kalıplar böyle olmalı senden token yememeliyim. En hızlı en iyi işini bekliyorum."

## Problem (measured 2026-10-13)

- `tools/tracker.js` 1,065 lines, `hooks/crew.js` 497 lines, ~1,500 words of Tracker rules in `skills/orchestrate/SKILL.md` that the model must hold on every update.
- Every row change is a long CLI call; the model re-derives layout rules each time; rules contradict as they accumulate. In one night: stale "running" rows, rows titled with agent ids, loose rows outside their group, a frozen day page kept open, duplicated date in the header.

## Decisions (owner, 2026-10-13)

1. **Who writes:** the model writes jobs; only hooks write agent state; the page merges both. (Option A of three.)
2. **Shape:** one small JSON file per job; an update overwrites that one file, no read first. (A of two.)
3. **Days:** one living page, no day folders, no midnight copy/freeze; done jobs filter by finish date; older ones in an archive view. (A of two.)
4. **Journal:** when a job reaches `done`, a line is appended to that day's journal automatically, once. The Wrap is built by filtering the day's job files.
5. **Scope:** every page template (Case research, Trail, Changelog, decision and test pages) follows the same pattern: data file(s) in, a static page renders itself; no model-run render step.

## Design

### Units

| Unit | Path | Written by | Purpose |
|---|---|---|---|
| Job file | `.joserah/desk/jobs/<slug>.json` | model (Voice, Lead, workers) | one job: `title, project, state (run/you/wait/done/plan), unattended?, note, url, label, options[]/recommend/why (decisions only), started, finished` |
| Agent file | `.joserah/desk/jobs/_agents.json` | hooks only | `{agentId: {job: <slug>, role, state, model, effort, ctx, since}}`; matched by agent id from the launch result, never by description text |
| Page | `templates/jobs/index.html` (static) | nobody at runtime | polls the folder index + `_agents.json` every few seconds and builds the list itself; all layout rules (groups, header style, ordering, folding, icon summary with count badges, equal row height) live here |
| Checker | `tools/jobs-check.js` | runs on write (hook) | schema + rules: valid state, decision rows carry options, child title does not repeat the project name, slug unique; an invalid file shows as a red "unreadable job" line on the page and warns the writer |
| Journal hook | in the checker's write path | — | on transition to `done`: append one line to `.joserah/desk/daily/YYYY/YYYY-MM-DD.md` under `## Done today`, idempotent per job+finish time |
| Server | existing serve-desk | — | serves the folder listing as JSON (`/jobs/index.json`) so the page needs no build |

### Prompt

The ~1,500-word Tracker section is replaced by 10–15 lines: the job-file fields, the five states, "write the whole file atomically, one file per job", and "the page and checker enforce the rest". Visual rules are removed from prompts entirely.

### Error handling

- Malformed/partial JSON: written via temp file + rename; if still unreadable the page shows a red line for that job only; checker warns.
- Agent ended without a notice: hook reconciles `_agents.json` against the live agent list and idles finished agents.
- Unattended machine work (bench chains): `unattended: true` → active, no AI icon, no "nobody on it" text.
- Agent with no job match: no line is created; checker warning only.
- Journal line written once per job completion; a repeated `done` does not duplicate it.

### Testing

- Fixture job folders → page screenshot in a real browser at desktop and phone width (headers, equal row height, folding, icon counts).
- Checker: one pass and one fail example per rule.
- Hooks: recorded real payload shapes — two agents started together, a resumed agent, an agent ending without a notice.
- Measurement: cost of one update (bytes written, commands, tokens) old tool vs new, shown as numbers.

### Migration

Today's open Tracker rows are converted once into job files. `tracker.js` stays read-only for the archive of old day pages. The other page tools (case, trail, changelog) move to the same pattern after the Tracker, one at a time, each with its own short plan.

## Out of scope

Shared viewing beyond the Tailscale-served page; artifact publishing (the Tracker is served locally, learned 2026-10-12).

## Carried requirements (from the stopped tracker-headers job, 2026-10-13; the plan must cover each with a test)
Source: `.joserah/desk/crew/2026-10-13/builder/0050-tracker-headers.md` "Left undone".
1. Every line has the same height and rhythm, verified by a real browser render at desktop and 390 px phone width.
2. The page header never repeats the date (the old `init --date` doubled it).
3. One entry per agent: an agent id match always wins over a description match; a hook never creates a second entry for an id that already has one.
4. A group header shows each role icon once with a corner count of that role working under it; hover gives role, count and job names.
5. An agent is paired with its description through the launch call's own result (tool_use_id -> agentId), never by order or time; no entry is ever created for an agent that already finished; a created entry attaches to its row or named project, never loose.
6. A child line never repeats its parent's name (a leading "<parent>" / "<parent>:" is stripped).
7. No entry stays "running" after its agent finished: state comes from agent events plus a sweep on every hook event (transcript end, or the job's report written with its done line).
