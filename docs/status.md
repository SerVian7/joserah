---
title: Joserah — status
type: status
---

# Joserah — status

Last change: 3a49dd7 · 2026-10-03 05:08 +0300 · 0.17.9: tracker folds waiting and plans at the top; pages never opened on the owner's screen

- Released: 0.17.10 on main, 683 tests (`node --test tests/*.test.js`), prompt v25.
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

## Decisions

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
