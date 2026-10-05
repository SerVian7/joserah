# Crew off vs crew on: three jobs (plan Tasks 8.2, 8.3)

Same machine, same day, one run at a time, same main-session model and effort, same prompts, same
starting workspace. Each figure was read from the runtime's own transcripts with `tools/measure-run.js`
(main transcript plus every `subagents/agent-*.jsonl`, window = process launch to process exit).
Total tokens = input + output + cache read + cache write. One run per cell: there is no variance figure.

Shared conditions (written out in full on every line below): Claude Code 2.1.289, headless print mode
(`-p --output-format stream-json --verbose --include-hook-events`), main session claude-opus-5-5 at
effort high, Windows 11 Pro 10.0.26200, plugin 0.17.10 loaded live from the working tree at 96e0082,
2026-10-05. Crew on means the default crew definitions: lead opus/medium, architect opus/high,
builder opus/high, scout sonnet/medium, sentry haiku/low.

Transcripts are under `~/.claude/projects/` in the folder named after the run's workspace path
(`C--Users-Atay-PC-AppData-Local-Temp-claude-C--Users-Atay-PC-Documents-atay-cf7e7c61-35c0-5ca4-8958-21f96a8e8c8c-scratchpad-crew-compare-runs-<run>/`).
`<run>` is j1-off, j2-off and so on.

## Results

- [measurement] crew off, job 1 (research + report page) -> 73.5 s wall · 1 session · input 16 · output 7119 · cache read 345227 · cache write 43135 · total 395497 tokens
  condition: Claude Code 2.1.289 · main claude-opus-5-5 effort high · crew off (`"crew": {"enabled": false}`, no crew definitions) · Windows 11 Pro 10.0.26200 headless print mode · scratch synthetic workspace · Daily Tracker off · no MCP, no web, no Artifact tools
  date: 2026-10-05 09:55:55Z–09:57:08Z · by: Builder · source: ~/.claude/projects/<j1-off folder>/f5f934e2-4845-48fd-8999-1e63eb218885.jsonl
- [measurement] crew off, job 2 (multi-file code change with tests) -> 65.4 s wall · 1 session · input 18 · output 4814 · cache read 318624 · cache write 30156 · total 353612 tokens
  condition: Claude Code 2.1.289 · main claude-opus-5-5 effort high · crew off (`"crew": {"enabled": false}`, no crew definitions) · Windows 11 Pro 10.0.26200 headless print mode · scratch synthetic workspace · Daily Tracker off · no MCP, no web, no Artifact tools
  date: 2026-10-05 09:57:09Z–09:58:15Z · by: Builder · source: ~/.claude/projects/<j2-off folder>/b88e3317-36a6-49ac-8df9-0a1a017144a2.jsonl
- [measurement] crew off, job 3 (status sweep, four projects) -> 31.1 s wall · 1 session · input 8 · output 1538 · cache read 115361 · cache write 24078 · total 140985 tokens
  condition: Claude Code 2.1.289 · main claude-opus-5-5 effort high · crew off (`"crew": {"enabled": false}`, no crew definitions) · Windows 11 Pro 10.0.26200 headless print mode · scratch synthetic workspace · Daily Tracker off · no MCP, no web, no Artifact tools
  date: 2026-10-05 09:58:16Z–09:58:47Z · by: Builder · source: ~/.claude/projects/<j3-off folder>/23f38386-7a87-49a8-a36e-4df28671e933.jsonl
- [measurement] crew on, job 1 (research + report page) -> 121.5 s wall · 3 sessions (main, lead, scout) · input 54 · output 16482 · cache read 735455 · cache write 115232 · total 867223 tokens
  condition: Claude Code 2.1.289 · main claude-opus-5-5 effort high · crew on, default definitions (lead opus/medium, scout sonnet/medium used) · Windows 11 Pro 10.0.26200 headless print mode · scratch synthetic workspace · Daily Tracker off · no MCP, no web, no Artifact tools
  date: 2026-10-05 09:58:54Z–10:00:56Z · by: Builder · source: ~/.claude/projects/<j1-on folder>/64d7fb56-7dc5-4bd3-9db2-8a9932bc61da.jsonl and its subagents/
- [measurement] crew on, job 2 (multi-file code change with tests) -> 147.3 s wall · 3 sessions (main, lead, builder) · input 48 · output 14220 · cache read 759761 · cache write 105633 · total 879662 tokens
  condition: Claude Code 2.1.289 · main claude-opus-5-5 effort high · crew on, default definitions (lead opus/medium, builder opus/high used) · Windows 11 Pro 10.0.26200 headless print mode · scratch synthetic workspace · Daily Tracker off · no MCP, no web, no Artifact tools
  date: 2026-10-05 10:00:57Z–10:03:24Z · by: Builder · source: ~/.claude/projects/<j2-on folder>/bde0cb1d-71b8-4d18-be2a-6a067936f738.jsonl and its subagents/
- [measurement] crew on, job 3 (status sweep, four projects) -> 102.2 s wall · 3 sessions (main, lead, scout) · input 36 · output 9452 · cache read 536527 · cache write 98847 · total 644862 tokens
  condition: Claude Code 2.1.289 · main claude-opus-5-5 effort high · crew on, default definitions (lead opus/medium, scout sonnet/medium used) · Windows 11 Pro 10.0.26200 headless print mode · scratch synthetic workspace · Daily Tracker off · no MCP, no web, no Artifact tools
  date: 2026-10-05 10:03:27Z–10:05:09Z · by: Builder · source: ~/.claude/projects/<j3-on folder>/71e18f8b-a70d-4a84-8a15-ac8b8d2faeae.jsonl and its subagents/

| Job | Crew off: wall · total tokens | Crew on: wall · total tokens | On ÷ off (wall · tokens) |
|---|---|---|---|
| 1 Research + report page | 73.5 s · 395,497 | 121.5 s · 867,223 | 1.65× · 2.19× |
| 2 Code change + tests | 65.4 s · 353,612 | 147.3 s · 879,662 | 2.25× · 2.49× |
| 3 Status sweep | 31.1 s · 140,985 | 102.2 s · 644,862 | 3.28× · 4.57× |

The ratios are a [calculation] from the six measurements above. The runtime's cost figure (the final
`total_cost_usd` in each stream, which is a running total) was 0.558, 0.402 and 0.248 USD with the crew
off, and 0.965, 1.070 and 0.771 USD with the crew on.

## Did each run finish?

All six finished inside the 15-minute cap, exit code 0, and no hook reported an error.

- Job 1: both wrote `reports/switch-report.html` and recommended the Lumen LX-2402, the only sheet
  that meets all six requirements. Off: an 18.4 kB page, committed to the workspace. On: a 7.2 kB page
  (written by Scout), left uncommitted.
- Job 2: both pass `npm test` (off: 14 tests, on: 16) and committed in the project's repository. An
  independent probe (120.00 subtotal, 10 % off, 20 % tax) returned discount 1200, tax 2160, total 12960,
  the line `Discount (10%): -12.00 USD` and a RangeError for 101. Off: 3 commits (feature, status, a
  status-timestamp fix). On: 2 commits (feature, status).
- Job 3: in both runs all four `Last change` lines name the project's HEAD, in the existing format,
  uncommitted, and the summary table covers all four projects.

## Prompts (identical in both modes, byte for byte)

1. `Compare the five switch datasheets in imports/switch-sheets/ against the requirements in imports/switch-sheets/requirements.md and recommend one. Use only those files, no web. Write the result as a report page: a local HTML file at reports/switch-report.html (do not publish it anywhere). Then tell me the recommendation in one line.`
2. `` In projects/Lab/invoicer, add an optional invoice-level percentage discount: buildInvoice takes `discountPercent` (0 to 100, default 0); the discount is taken off the subtotal before tax, rounded half-up to the cent, and returned as `discount`; tax and total are computed on the discounted amount; formatInvoice prints a line like `Discount (10%): -12.00 USD` between Subtotal and Tax when the discount is above zero; a discountPercent outside 0 to 100 throws a RangeError. Write the tests first, make them pass with npm test, and commit in the project's own git repository. ``
3. `` Sweep my four projects in projects/Testco/ (alpha, beta, gamma, delta): bring the `Last change` line in each project's docs/status.md up to date with that project's latest commit, in the same format the line already uses, and do not commit those edits. Then give me one short summary: where each project stands and what is open. ``

Command, the same for all six runs (cwd = the run's own copy of the workspace):
`claude -p "<prompt>" --model claude-opus-5-5 --effort high --permission-mode bypassPermissions --session-id <uuid> --output-format stream-json --verbose --include-hook-events --strict-mcp-config --disallowedTools "Artifact ArtifactComments ArtifactData WebFetch WebSearch PushNotification RemoteTrigger DesignSync"`

## Starting state

A workspace made by `tools/scaffold.js` (owner "Test Owner", English, feedback off, `--git`), plus
`"dailyTracker": false`, then synthetic content only: five invented switch datasheets with a
requirements note, a four-module Node invoicing library with 7 `node:test` tests in its own git
repository, and four invented projects, each with three commits and a `docs/status.md` whose
`Last change` names the first commit. That folder was kept untouched; every run started from a fresh
copy of it at its own path (so no run could see another run's auto-memory).

## How the plugin's activity was checked

In every run's stream:
- the `init` event lists the plugin `joserah@skills-dir` 0.17.10 (path `~/.claude/skills/joserah`, a
  link to this repository) and no MCP servers, and has no Artifact tool;
- four SessionStart hook responses, one of them the Joserah workspace block ("The owner of this
  workspace is **Test Owner**"), and the UserPromptSubmit hook's time line;
- crew off: `crew.js` printed `removed` for all five roles and `--check` printed `skipped-off`; the
  `init` agent list has no lead, architect, builder, scout or sentry; the SessionStart context has no
  "Crew: on" line;
- crew on: `crew.js` printed `wrote` for all five roles and `--check` printed `ok`; the `.claude/agents/`
  folder holds the five stamped files; the `init` agent list has all five; the SessionStart context
  carries "Crew: on — you only talk; … every other job goes to Lead"; the SubagentStart hooks fired for
  lead, scout and builder, and Lead's Ledger was written under `.joserah/desk/crew/`.

## What makes the comparison unfair or narrow

- **One run per cell.** No repeat, so no spread; differences of a few seconds mean nothing.
- **Order.** All crew-off runs came first, then all crew-on runs, within 10 minutes. One trivial warm-up
  run in each mode before its three jobs equalised the first job's prompt cache, but later runs may
  still have read cache written by earlier ones.
- **Daily Tracker off in both modes.** Publishing was not allowed, so the Tracker, the Crew strip and
  the safety-net writes were not exercised. Real use with the crew on would add Voice's Tracker work.
- **No MCP, web or Artifact tools.** Both modes worked only on local files.
- **Small jobs.** Each finishes in a minute with the crew off. The crew's fixed cost (Lead's start-up and
  the briefs) weighs most on small jobs. Job 3 shows the largest ratio (4.57×) and is the smallest.
  These numbers say nothing about large jobs, where the main session's context would grow without the
  crew.
- **The work was not identical.** With the crew on, Lead ran in the background in job 1 and in the
  foreground in jobs 2 and 3. With the crew off, job 1 made a larger page and job 2 made one extra
  commit. No quality score was taken.
- **A small uncounted call.** The runtime's own usage summary also lists one claude-haiku-4-5 call per
  run, about 1,000 input and 15 output tokens, in every run of both modes. It is in no transcript, so
  `measure-run.js` does not count it. Otherwise the tool's sums match the runtime's per-model totals
  exactly for opus and sonnet in all six runs.
- **Synthetic owner.** English, empty journal, no tasks, no learned rules. A real workspace injects more
  context into every session in both modes.
- **Wall time is from launch to exit.** It includes CLI start-up and hooks, about the same in both modes.
- **Live plugin tree.** Another Builder was editing `tools/tracker.js` during the runs. With the Daily
  Tracker off, the crew hook never loads that file, and none of the 325 hook responses reported an
  error.

## Side findings

- `tools/scaffold.js` copies `templates/case`, `templates/changelog`, `templates/crew` and
  `templates/tracker` into the new workspace's root, because `COPY_SKIP_DIRS` holds only `roles` and
  `memory`. Those four folders were deleted from the scratch template before any run.
- Depth-2 agents (Scout and Builder opened by Lead, `spawnDepth: 2`) write their transcripts into the
  main session's `subagents/` folder, so `measure-run.js` counts them. This closes the open point in the
  Task 8.1 log.
