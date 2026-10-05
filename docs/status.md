---
title: Joserah — status
type: status
---

# Joserah — status

Last change: ebf8a29 · 2026-10-06 02:01 +0300 · status: T11 merged (T11)

- Released: 0.18.1 on main, 889 tests (`node --test tests/*.test.js`), prompt v28.
- Installed: this machine via the skills-dir junction; ctrl and Yusuf are updated by the owner (pull, `/joserah:update`, `/reload-plugins`).
- What changed, per release: [CHANGELOG.md](../CHANGELOG.md).
- Open: getSecret's terminal-prompt branch is untested (no TTY in the suite); memory `claims.js` lacks the workspace tool's calculation-vs-measurement and conflict checks.

## Changes since 0.17.0

- 0.17.1 (prompt v20): whatever is left for the owner is an owner-waiting row on the Daily Tracker at once.
- 0.17.2 (prompt v21): optional `sharedMemoryAutoPush` config key; off by default.
- 0.17.3 (prompt v22): one job per Tracker row; `tools/tracker.js` refuses duplicate titles.
- 0.17.4 (prompt v23): Daily Tracker as handoff; explicit row states; a new day opens a new one.
- 0.17.5 (prompt v24): decision pages stand on their own; no recommendation for its own sake; agent-working row added in the same turn.
- 0.17.4 (prompt v24): Daily Tracker as handoff; explicit row states; a new day opens a new one.
- 0.17.5 (prompt v24): decision pages stand on their own; no recommendation for its own sake; agent-working row added in the same turn.

## Crew comparison (2026-10-05)

Six runs, same model and prompts, crew off vs on; details and caveats: [measurements/2026-10-05-crew-compare.md](measurements/2026-10-05-crew-compare.md). The owner decides from these whether crew stays the default.

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

## Decisions

- [decision] Joserah local server -> thin Hono/TypeScript server inside the plugin, beside the terminal plugin, driving the user's own Claude Code; Docker self-contained (no host folders) or native; access local/tailnet/internet by setting; OpenRouter later
  date: 2026-10-05
  by: Serkan
  source: chat 2026-10-05; docs/specs/2026-10-05-local-server-design.md

- [decision] Everything left for the owner is a Daily Tracker row at once, never only in chat -> in force since 0.17.1
  date: 2026-10-01
  by: owner
  source: CHANGELOG.md 0.17.1
- [decision] A shared-memory push waits for the owner's yes unless `sharedMemoryAutoPush` is true in config -> in force since 0.17.2
  date: 2026-10-01
  by: owner
  source: CHANGELOG.md 0.17.2
- [decision] A Tracker row is one job: no summary row that repeats other rows, no separate jobs merged into one row, an update changes the existing row -> in force since 0.17.3; the updater refuses two rows with the same title (case and outer spaces ignored)
  date: 2026-10-01
  by: owner
  source: CHANGELOG.md 0.17.3
