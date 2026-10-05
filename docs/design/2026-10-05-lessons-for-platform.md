# Lessons for the platform server — 2026-10-05

Checked against the server spec. "[inferred]" marks my consequence, not a source's claim. Under `.joserah/`: SO, MS, AR, AQ = knowledge/wiki/topics/ (subagent-orchestration, zenger-control-modul-sozlesmesi, zenger-control-arge-kararlari, ai-tooling-quotas); ZC = knowledge/wiki/entities/zenger-control.md; L = learned.md; T, D7 = platform/design/ (02-tensions, 07-local-model-decisions); Rnn = platform/research/nn-*.md. Numbers are lines.

## A. Already in the spec (evidence agrees)

- Files are truth, any index derived (T 89-93) → §6.
- Deterministic first, model only over the changed set, cost shown (R16 10-14, 127: ~$0.65/night cached, ~$3.1 uncached) → §6, §7.
- Routing by job type, never a classifier (R24 57-60, 148-155) → §7.
- Strict login with rate limit (ZC 766); SSE, since WebSocket fails behind a proxy (MS 125-127) → §3, §5.
- Pages are tool-filled templates (L 985-989); third-party skills only as session tools (L 429-434) → §1, §5.

## B. Missing from the spec

1. **Cancel by process tree, never by name.** An agent's `taskkill /IM workerd.exe` killed both client-facing servers (SO 25-27). Consequence, §1 Jobs: spawn without a shell, own process group, cancel by PID; job text over stdin, forced UTF-8 (R20 250-251; L 553-558).

2. **Snapshot before a job, diff after.** Snapshot-first (R13 59); manifest diff (R16 118); every changed or deleted line checked (L 377). Jobs write through the CLI, so Store is not the "only writer" [inferred]. Consequence, §2: checkpoint commit before; after, list changed files and raise an owner row on any deletion (rule 8.2).

3. **Separate reading from acting.** An outsider's text must never become authorisation (T 321-329; AGENTS rules 9, 11). Dropped files and mail feed an `acceptEdits` job [inferred]. Consequence, §3/§6: tool allowlist per job type (ingest, query, lint: write only under `knowledge/**`, no Bash, network or `.mcp.json` mail tools); mail only as draft plus owner row; invalid output fails closed (R23 82).

4. **Secrets out of the job's reach; fail loudly.** "The model never receives them" (T 115-120); deny rules are "a guardrail, not a sandbox" (AGENTS §3); an empty key silently skipped registration (MS 107-108); header trust held only while no port was open, and one module opened one (MS 79-81; ZC 748). The spec keeps `keys/server/` in the job's workspace [inferred]. Consequence, §3/§4: hash, cookie key, setup token outside the workspace volume, scrubbed child env; refuse to start with empty auth; one published port; `/api/devices` gets per-device tokens, never the cookie.

5. **Destructive upsert.** A payload missing a key deletes it (MS 102-105). The answers doc holds choice, `--n` and the assistant's `--r` (spec §2); a page `set()` would erase the reply [inferred]. Consequence, §2: PUT merges by field owner or uses If-Match (409); add a test.

6. **Job state survives restarts.** A cron fired zero times overnight; sessions die (SO 20-24, 35-38); persist the queue, resume (D7 43-50); a dead worker stayed "running" 30 minutes (L 1049-1052). Consequence, §1/§5: queue on disk; `session_id` saved at first event; boot turns running into interrupted; strip entry cleared on every end, usage limit included; nightly job with lock and catch-up (R23 92); engine `health()`.

7. **Health proves work, not a 200.** A green dot is no live socket; unknown `/api/` returns 200 plus HTML (MS 61-64, 131-133); a black card passed as a preview (AR 99-101); stream formats change (R20 49-51). Consequence, §4/§5: wizard check is one real one-turn job; `/healthz` separates alive, signed in, last job ok; CLI version in each job log; defensive parsing.

8. **Job logs stay out of the backup.** Raw transcripts are ~210× the knowledge base, readable text ~3.5% of raw (R20 245, 364); the backup is `.joserah/` only (L 607-611); the CLI deletes transcripts after 30 days (R20 53-56). Spec §2 puts `.joserah/desk/jobs/…jsonl` inside it. Consequence: raw stream gitignored and rotated; the backed-up record is a text digest; "reply" starts a new job from it when resume fails.

9. **Scan uploads before any model reads them.** One import held 8 credential files; no scanner is validated on Turkish prose (R20 262, 286-303; AGENTS 8.3). Redaction covers logs, not the model's context [inferred]. Consequence, §6 Ingest: `secret-scan.js` on upload, quarantine hits with an owner row, then queue the job.

10. **A job is not done until row and page are.** Close the row; every deliverable is a page; chat never ahead of the Tracker (L 846-851, 967-972, 994-999); an owner row carries options and a recommendation (L 1013-1017). Spec §5 makes approvals "fail" [inferred]. Consequence: brief carries the row id; zero-token check afterwards, else an owner row; approval becomes a "needs approval" state resumed by `--resume`.

11. **Automation and spend are the owner's to switch on.** No unrequested scheduled task (L 343-347); one High-effort job ended a 5-hour window in 5 min 15 s (AQ 122); cost ≈ agents × ~120k tokens (AQ 192-206). Spec: `answerStartsJob` default on, nightly pass, no budget stop. Consequence, §7: nightly LLM pass and answer jobs off by default (lint stays on); answers needing no judgement start no model; daily budget stop; unknown job types route heavy (R24 155); claim-touching jobs not on Haiku (SO 134). R24's figures are unusable: Gemini's 16 flagged figures were all unsourced (AQ 48).

12. **Wiki claim lint.** Measurement outranks calculation (L 447-452). Consequence, §6: lint the four kinds, `condition:` on measurements, `superseded:` on struck lines; size guards (ZC note 64.8 KB, `learned.md` 101 KB would flag; R16 124-126); claims view shows measurement beside calculation; brief composer prints `[cut]` markers (R23 196). Native `joserah serve` prints its URL and opens no window (L 839).
