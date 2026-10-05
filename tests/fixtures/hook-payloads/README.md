# Hook payloads, captured

Real payloads, captured 2026-10-05 by a hook that appended its stdin to a file:
- Claude Code 2.1.289, print mode (`claude -p`), Windows 11.
- Session and agents on Haiku 4.5, agent type `probe`.
- `fg-*`: one foreground Agent call. `bg-*`: two background Agent calls in one message.
- The number in each name is the order of that event in its run.

Only the machine paths (`transcript_path`, `cwd`, `agent_transcript_path`) and long texts (`prompt`,
`content`, `outputFile`) are replaced. Every field name and every other value is as captured.

Measured order:
- **bg:** PreToolUse ×2 → SubagentStart(1) → PostToolUse(1, `async_launched`) → PostToolUse(2) →
  SubagentStart(2) → SubagentStop(2) → SubagentStop(1) → Stop (×2: one after launch, one after the
  completion notices).
- **fg:** PreToolUse → SubagentStart → SubagentStop → PostToolUse(`completed`) → Stop.
