# Changelog

What changed for someone who already has a workspace, newest first. Run `/joserah:update` after
any of them.

## Unreleased

- **Stop publishing pages, keep the files.** `"artifacts": false` in `.joserah/config.json` ends automatic artifact publishing: the Tracker is no longer held for an unpublished page, finished work is written as a Markdown file instead of a page, replies end with the path of the Tracker's `tracker.md` rather than a link, and the report-freshness reminder stays quiet. Absent or true changes nothing. Every Tracker render now also writes `tracker.md` beside `index.html` (same sections and groups, options with the recommended one marked), whatever the switch says.
- **The crew is off by default.** A workspace without a `crew` key now runs as before the crew existed: the assistant does the work itself, and uses an agent only for heavy reading. Switch the crew on with `"crew": true` in `.joserah/config.json` when the work gets heavy. Workspaces that set `"crew": false` are unchanged; ones that relied on the old default turn it on that way.
- **The Tracker reads in one order.** Each section (Active work, Owner, Waiting, Done today, Plans) is its own framed area; every row stands under its project group, a group of one too, never with a "project ·" prefix; group names are calm and never louder than the section title. A question's options are themselves the choice, every row takes a note from a small reply icon, and a row's conversation (your notes and the assistant's replies) shows in its detail. A row with nothing more to say no longer repeats its title when opened, and long lists lose the fade at the bottom.
- **Rows under their project.** Every Tracker row sits under its project's group; a loose row that is a step of a known project plan is moved there unasked, named as a step of that plan, and the assistant says so in one line.

## 0.18.0

0.18.0 — the crew: the work runs behind the scenes, and the Daily Tracker becomes a board you can answer on. Owner, 2026-10-05.

- **Work behind the scenes.** The assistant you talk to now only talks; the work goes to a crew of five agents (Lead, Architect, Builder, Scout, Sentry), each with its own model and effort. Nothing to learn: you ask as before, and the assistant speaks of the work in the first person ("two of my research jobs are still running"). The Daily Tracker shows a Crew strip while jobs run.
- **Developer mode shows it.** Off by default. Add `"devMode": true` to `.joserah/config.json` to see the crew named: role names on the Tracker strip, and the assistant may say which role is on what.
- **Switching the crew off.** `"crew": false` (or `"crew": { "enabled": false }`) in `.joserah/config.json` brings back the way it worked before; the agent definitions the crew wrote are removed, your own agents never. An optional `crew` block sets a role's model or effort; after any change, `/joserah:update` (or `crew.js`) rewrites the definitions.
- **Install paths.** New workspaces get the five definitions in `.claude/agents/`; `/joserah:update` writes them in existing ones and never overwrites a same-named file of yours (it says so). If that folder is new, restart Claude Code once. Doctor checks the definitions (`crew definitions current`).
- **Memory across compaction.** Lead keeps a Ledger of open jobs, decisions and what waits on you; after a `/compact` the open items come back on their own.
- **Agents on the Tracker by themselves.** A hook puts every agent on the Tracker when it starts and dims it when it ends, with its role, job, model and effort. A second hook (`tracker-guard.js`) holds a reply once when today's Tracker has changed but was not published, when a decision waits on you without options, a recommendation and a reason, or when the reply is a long block with no page link.
- **Tracker board.** Rows sit in groups: running, waiting on you (Sizde), waiting on others, Done today (one closed fold with its count and last time), and Plans below, one closed fold per group. Several lines of one category sit under a category line. A row's link is a label on the line. A date mark such as 30.09 now orders by date, and a page keeps its own heading and palette.
- **Crew strip.** The strip lists only what runs, and says "Nothing running right now" when nothing does. A line's detail opens directly under that line, not below the whole list. Each role icon names its activity on hover, and a running or waiting line reads how long it has been so ("running 7 min").
- **Decision rows.** A question for you is a row with the question, keyed options (A, B, …), the recommended one marked, and one line of why. The updater refuses a decision row without them.
- **Answer on the page.** Publish the Daily Tracker with `capabilities: {db: {}}` and a question row shows a button per option and a short note; your answer is written to the page's database and the line reads "answered: A · HH:MM". Without the database the form stays hidden and the row reads as before.
- **In place, with motion.** After a publish only what changed moves: a new line slides in, a changed one flashes once, a finished one flashes into Done today. The open detail, folds, opened long lists and scroll position are kept across a publish; reduced motion turns the animation off.
- **Trail.** `trail.js new|add|render|types`: one page per Case that shows its whole course — mail in, mail out, offer, options, decision, draft, note, waiting — as typed entries appended to `trail.json` and never rewritten. Open waits and unsent drafts are pinned on top, the newest entry first, past days folded; a decision on an options entry shows the chosen item with its photo, marked SELECTED. Labelled "İş akışı" on Turkish pages. New work uses a Trail instead of a Decision flow; existing Decision flow pages are left as they are.
- **One theme.** The colour tokens, the console rules and the long-list clamp live in one place (`tools/lib/theme.js`); the Tracker and the Trail both take them from there, so a theme change reaches every page on its next render. A page's own palette still wins over the Theme.
- **Warmer replies.** Brevity means no padding, never coldness: a reply is a full-sentence summary of what was done, what waits on you and what comes next; every item, in chat and on the Tracker, names its topic with one sentence of background. The reply that finishes a job closes that job's Tracker row.
- **New workspaces stay clean.** Setup copies only workspace content: `tracker/`, `case/` and `changelog/` template folders (copied to the workspace root by 0.17.0–0.17.10) are no longer created. A folder already there is yours to delete.

The prompt (v28), the orchestrate, feedback, setup, update and doctor skills, new hooks and tools. Run `/joserah:update`, then `/reload-plugins`; restart once if it says the agents folder is new.

## 0.17.10

0.17.10 — a reusable Changelog page, Plans grouped on the Tracker, relay and delivery rules. Owner, 2026-10-04.

- **`changelog.js`.** `init <dir> --title <module> --lang <en|tr> [--logo f]`, `add <dir> --date … --line …`, `render <dir>`: one page per module, logo, name, one sentence, dated sections all closed, 2 to 5 plain lines each; nothing else. The title is the module's full name; the description one short phrase saying what the module is, never a list.
- **Plans by heading.** `tracker.js row --state plan --group "<heading>"`: the Plans fold holds one closed fold per group.
- **Orchestrate.** One announcement per module, each linking its changelog; maintenance notice before, done notice after, never "done" before it is live. Relays are verbatim; a worker's brief gets no restrictions of the main session's own; a feature ships complete.
- **Rule writing.** Rules are written as the principle, not the incident (`learn`, `AGENTS.md`).

The orchestrate skill and `AGENTS.md`. Run `/joserah:update`, then `/reload-plugins`.

## 0.17.9

0.17.9 — Daily Tracker: waiting and plans sit at the top as closed groups, the list carries agent working, owner and done; pages are never put in front of the owner — the link is given, publishes are batched to one per reply. Owner, 2026-10-03.

## 0.17.8

0.17.8 — the stale-report reminder skips a report filed under a past day's folder; a closed day's Wrap is not made stale by the next day's work. Owner, 2026-10-03.

## 0.17.7

0.17.7 — a reusable Case research page. Owner, 2026-10-02.

- **`case.js`.** `init <dir> --title … --lang <en|tr>` and `render <dir>` build a Case research page from `cases.json`: one case card at a time, groups newest first (the first open on load, one open at a time, a closed group hides everything in it), status dot with its reason, specs in a closed expandable, source links. Brand-neutral: logo, accent colour, labels and language come from the data; images and logo are separate files beside the page.
- **Update section rule.** A page's update section stays open and is a short summary, latest first, one line per item, with links.

The orchestrate skill. Run `/joserah:update`, then `/reload-plugins`.

## 0.17.6

0.17.6 — inline by default, no keeper agents, lighter pages. Owner, 2026-10-02.

- **Inline by default.** An agent only for heavy reading, on the cheapest model that fits; related jobs to one agent, resumed by message. Rule writes stay inline; near ~300k of context the assistant leaves a handoff and a new chat continues.
- **No keeper agents.** `tracker-keeper` is removed; the Tracker is kept inline: `tracker.js row` upserts a row by title and re-renders, the page is never re-read. Done rows sort newest first; repeated work on one topic updates its one row.
- **Lighter pages.** `tracker.js init --logo` writes the logo beside `index.html` instead of embedding it. Pages carry content only (no intro, legend or log), every group folds one at a time and a closed group hides everything in it. Row text is a short summary of what happened and the result.

Standing instructions (prompt v25), the orchestrate skill, the manager and learn agents. Run `/joserah:update`, then `/reload-plugins`.

## 0.17.5

0.17.5 — decision pages and reports stand on their own, and a recommendation is never made for its own sake. Owner, 2026-10-02.

- **Pages stand on their own.** The assistant assumes the owner reads neither chat nor agent output: each page or report says in plain words where its material came from and who is who, leaves no name or code unexplained, is short, and keeps details only in expandables that are closed by default.
- **No recommendation for its own sake.** When no option meets the need, the verdict is "none fits — we don't choose" plus the one question that would change it; a recommendation never praises specs beyond the need.
- **The agent-working row is added at once.** The assistant adds the agent-working row to the Daily Tracker in the same turn it starts an agent — never later — and moves it when the agent ends.

Said in the standing instructions (prompt v24), the orchestrate skill and the `tracker-keeper` agent. Run `/joserah:update`, then `/reload-plugins`.

## 0.17.4

0.17.4 — the Daily Tracker is a handoff, and a new day opens a new one. Owner, 2026-10-02: "Sürüyor ne demek? AI'lar mı çalışıyor? … Daily Tracker'da ne yapmaya çalıştığımı algıla … yeni chat'e geçeceğim, bu tarz şeyler sayesinde kayıp yaşamayız."

- **Explicit states.** A row is agent working (only while a background agent is actually on it; it moves when the agent ends), owner (the owner's decision or action, linked to the page where it is decided), waiting (on someone outside, no AI working), done, or plan. `tools/tracker.js` groups the page in that order (`run`, `you`, `wait`, `ok`, `plan`; the state names in rows.json are unchanged, the labels and the groups are new). Every open row ends with the next step and where it happens, so a new chat can continue without loss.
- **A new day opens a new Daily Tracker unasked.** At the first message of a new day the assistant opens that day's Daily Tracker (open rows carried over, marked with the day they came from), freezes the previous day's page (a `.frozen` file in its folder) and makes the previous day's Wrap then. The session briefing carries a once-a-day `[new day]` line while a previous day's Daily Tracker is still open and not frozen (off with `"dailyTracker": false`).
- **Evaluations go on pages, not chat.** Material that needs a decision (options, offers) is evaluated in the topic's Case research and Decision flow with a marked recommendation; a missing price never blocks the evaluation; chat carries one line and the link.

Said in the standing instructions (prompt v23), the orchestrate skill and the `tracker-keeper` agent. Run `/joserah:update`, then `/reload-plugins`.

## 0.17.3

0.17.3 — one job, one row on a Tracker. A Tracker or Daily Tracker never carries a summary row that repeats other rows; separate jobs are never merged into one row; an update changes the existing row instead of adding a repeating one. Said in the standing instructions, the orchestrate skill and the `tracker-keeper` agent; `tools/tracker.js` now refuses, with exit 1, two rows that share a title (case and outer spaces ignored). Prompt v22. Run `/joserah:update`, then `/reload-plugins`.

## 0.17.2

0.17.2 — optional automatic shared-memory pushes. Set `"sharedMemoryAutoPush": true` in `.joserah/config.json` and the assistant pushes a joined shared memory without waiting for a yes, then reports the push notice's file list in one line; it still asks first when something is genuinely problematic (another member's content removed, personal data, a rules change it is unsure of). Default off (absent or false) keeps today's behaviour: the push waits for the owner's yes. Prompt v21. Run `/joserah:update`, then `/reload-plugins`.

## 0.17.1

0.17.1 — nothing left for the owner lives only in chat. Every question or action the assistant leaves for the owner (an approval, a choice, an action such as reloading plugins) now appears at once as an owner-waiting row on the Daily Tracker, linking to the page where it is decided when one exists. Said in the standing instructions, the orchestrate skill and the `tracker-keeper` agent. Prompt v20. Run `/joserah:update`, then `/reload-plugins`.

## 0.17.0

**A Daily Tracker, native and quiet.** Owner, 2026-10-01. The assistant now keeps the owner's Daily Tracker — the day's live page — without being asked and without nagging: it never asks about it or announces it, and every reply ends with its link. It is on by default; `"dailyTracker": false` in `.joserah/config.json` turns it off. A new `tools/tracker.js` builds the page (`init <dir> --title "<Owner> · Daily Tracker" --lang en|tr`, then `<dir>` after each change to `rows.json`): rows.json is the full inventory, groups run running and waiting on the owner → done → plans, every row is stamped once and the stamp is kept, links live in their rows, and only the list and the updated stamp ever change. The header is one small line `<Owner> · Daily Tracker · DD.MM.YYYY`; no footer, no elapsed time. A new `tracker-keeper` agent keeps one page from one-line updates. Every background job gets a running row saying what is awaited.

**Working structures have names.** Case, Case research, Decision flow, Tracker, Daily Tracker, Wrap and Manager are defined in the orchestrate skill and used as they are. A Wrap (the end-of-day report) is made only once the day has ended.

**Pages under work.** A keeper per page; workers send each verified finding to it at once; a closed-by-default job log directly under the page title ("running · N" / "done · log"), kept as a log; process status is never a content section; links live in their rows; no model or tool names on any page. Decision pages: one topic per Case research and Decision flow pair, the flow carries only what is decided, options grouped under clear headings with the selected card under its group. A correction to a page's shape goes into its base — template, keeper, updater — in the same turn.

**Research and brand.** A product is proposed only after its shop page, opened, shows it on sale now; an unverified item is never decorated. Trusted sources are a list in `research.trustedSources` (config), all on equal footing and open to other established shops; a marketplace's third-party seller is flagged. Price research follows a fetch fallback order and ends with a `Blocked sources:` line. Only recorded brand assets are used; a missing brand decision is left out and listed.

**Delegation may nest.** The sub-agent start line no longer says "do not delegate": a sub-agent may open its own under the same rules (a brief each, never two on one folder or file, a checkpoint file for long work). A `manager` agent ships: workers at medium tier by default, parallel within the machine's capacity, a checkpoint per long job and restart from it, a keeper for every page the wave feeds.

**Shared memory.** Nothing assistant-internal goes in (at most a changelog of major releases); every change to the shared record goes through `inbox/`; the company Wrap is built from the memory with every member's data and goes to no one by default, to the whole team when needed. A new memory carries `knowledge/wiki/topics/tracker-and-wrap.md`, the how-to for members without an assistant. Run `--refresh-memory` for the rules; the how-to reaches an existing memory when its sweeper adds it.

**Sweep and doctor.** The sweep's changed-since count comes from version-control history, not file times, so a workspace moved to another machine no longer counts as all-changed. Doctor warns, instead of failing, on links into `projects/` folders absent on this machine.

Prompt v19. Run `/joserah:update`, then `/reload-plugins`.

## 0.16.9

0.16.9 — a published report is kept current: Stop-hook reminder when changes follow the last report publish. A new Stop hook reads the session transcript: once a report-like artifact (title or description says Rapor, Report, Gün Sonu, Takip or Status) has been published, any file edit, other artifact publish or workspace file changed after it holds the turn open once with one line in the owner's language, "Yayınlanan rapor güncel mi? Son yayın HH:MM, sonrasında N değişiklik." The orchestrate skill says the same as a rule. Run `/reload-plugins` to get the hook.

## 0.16.8

0.16.8 — orchestrate: a manager only when the wave is wide; one folder or stage gets none. A wave with a single folder or a single stage is now briefed by the orchestrator directly, because the manager layer costs a full agent's opening and the owner's waiting time. Run `/joserah:update` to get the changed skill.

## 0.16.7

0.16.7 — shared-memory sync: frontmatter keys accept no space after the colon. `to:serkan` was read as "erkan" in the Questions list of `tools/sync.js` (a regex escape slip), so the question never showed for its addressee; `to:x`, `to: x` and `to:  x` now all read "x". Run `/joserah:update` in a joined shared memory to get the fixed tool.

## 0.16.6

0.16.6 — session briefing lists open shared-memory questions for the member from the remote tip. Owner, 2026-10-01. At session start each joined shared memory is fetched (every session, not once a day; read-only, never a merge, capped at 3 s) and the questions under `questions/` addressed to the member with `status: open` are read from the remote tip, so they show before any pull: `Zenger ortak hafızası: 6 yeni commit · size 2 açık soru: “…”, “…”. Oturum başında çekilecek.` A level memory says them on a line of its own. Any error leaves the old line.

## 0.16.5

orchestrate: a manager agent per wave (sub-agents of a sub-agent), status line relay, cap in the brief. When a wave has several independent folders or stages, the orchestrator may brief one manager at heavy tier that briefs its own workers, keeps its running state in one file it deletes at the end, and answers status with one line. The manager writes the report file; the orchestrator still publishes it and reports to the owner.

## 0.16.4

sweep.js counts a struck line as carried. The after-check no longer reports a claim missing when it arrived plain and now stands struck in knowledge (or the reverse). Run `--refresh-memory` for a shared memory.

## 0.16.3

**How the assistant was built stays out of the shared memory.** The memory rules now list notes on building the assistant or its tools — versions, rule debates, who proposed which rule — with private life and gossip: they stay in the member's own workspace. How the company works with the assistant is a record; how it was built is not.

## 0.16.2

**Company pages start from the brand.** The memory's AGENTS.md now says every report, artifact, page or mail about the company is built from `.brand/` (read `REPORTING.md`, start from its template, embed the logo), never an improvised design. Run `--refresh-memory` for a shared memory.

**A refresh brings the memory's .gitignore up to date.** `--refresh-memory` appends the template's `.gitignore` lines the memory lacks (such as `.memory/repos.json`), never removing or reordering its own, and lists `.gitignore` when it grew.

## 0.16.1

**Archived sources are not checked.** ctrl, 2026-09-30. A shared memory's `knowledge/sources/` holds source material archived verbatim (a documentation site, exports); it is never edited, so the link and claim checks skip it (links from other pages into it are still checked) and the memory doctor passes the same exclusion. `verify-links.js` and `check-claims.js` take `--exclude <dir>`, repeatable. Run `--refresh-memory` for a shared memory.

## 0.16.0

**A Joserah Vault window for secrets.** Owner, 2026-09-30. On this machine `secret.js --set <name>` with no value on stdin now opens a small Joserah Vault window (a one-shot page on 127.0.0.1 behind a random token, in an Edge or Chrome app window, strict CSP, no external requests): the name, a masked field, Save and Cancel, and the line "The AI never sees it." The browser is never offered the value to remember. The assistant runs `--set` itself and the owner types into the window; the value goes into the vault and the tool prints only `saved: <name>`. The memory's `secret.js` opens the same window in the company's look (`.brand/`). Over SSH, a VS Code Remote session or a headless machine it falls back to the hidden terminal prompt; `--tty` and `--dialog` force either, `JOSERAH_VAULT_DIALOG=off` turns the window off. A piped value works as before. Prompt v18. Run `/joserah:update` to pick up the window, and `--refresh-memory` for a shared memory.

## 0.15.9

A commit that only updates the record itself no longer asks to record itself (the `[project]` line skips commits touching only docs/status.md, docs/learnings.md, CHANGELOG.md).

## 0.15.8

**Project records keep up.** Owner via ctrl, 2026-09-30, after a module's page in the shared memory lagged 13 hours and 20+ commits behind its repo. A commit or push inside `projects/` now adds one `[project]` line to the session, once per repo HEAD: update `docs/status.md` `Last change:`, record new decisions as `[decision]` with the old one struck, move measurements to the device's page — and, when a joined shared memory has a page whose `repo:` matches the project's origin, update that page through an inbox note (the sweeper writes it itself; the push still waits for the yes). The convention: a project's page carries frontmatter `repo: <remote url>` and a line `Last change: <short hash> · <YYYY-MM-DD HH:MM> <tz> · <subject>`. The memory's new `tools/project-drift.js`, run by every `sync.js` pull, prints `projects: all current` or names the pages behind their repo; doctor maps the workspace's `projects/` checkouts into the memory's local, gitignored `.memory/repos.json` and warns on the same drift. Prompt v17. Run `--refresh-memory` to pick up the tool.

**data: links are not files.** Both link checkers (the plugin's and the memory's) skip `data:`, `mailto:` and `tel:` targets, so a page with embedded base64 images no longer counts as broken.

## 0.15.7

**Shared-memory pushes ask again.** Owner, 2026-09-30: the push to a shared memory is a question again. The assistant shows the push notice, one line per file, waits for the member's yes, then runs it again with `--yes` — template refreshes included. Commits, workspace backups and project pushes stay act-then-report, and pushes still name their target. Prompt v16. Run `--refresh-memory` to pick up the memory text.

## 0.15.6

**Act, then report.** A routine, reversible step that follows from the request — a commit, a push of the assistant's own work to its own remote, a backup, a note in its own folder — is now done and reported in one line, not asked about. Questions are kept for deletions and overwrites, someone else's files, live systems, and requests with two materially different readings; hard rule 2 is unchanged. The backup skill asks once whether a new remote is private, records it in the `backup` object as `remoteConfirmed`, and pushes later backups to that same URL without asking; a different URL, or a secret-scan hit that holds a value, still stops. A hit judged as plan or test prose is reported, not asked about. Prompt v15.

**The push names its target.** Every commit or push report starts with one of three fixed names and the remote: `workspace backup` (the assistant's own memory, to the owner's private backup repository), `shared memory <name>`, or `project <name>`. The memory's `sync.js` prints `Push notice — shared memory <name> (<origin url>): N file(s)` and ends with `pushed to shared memory <name>: <commit>`; the assistant shows the list and pushes, waiting only when it holds a deletion or a file outside the member's own folder, `inbox/` and `questions/`. Run `--refresh-memory` to pick it up.

**The memory reads well to any AI.** The memory's `README.md` and `AGENTS.md` are rewritten for an assistant opening the repository cold, with or without Joserah: what it is, the first three steps (sync, who the member is, their folder and `desk/tasks/now.md`), where to write and where never, claim lines, the push notice, questions, secrets and the sweep. Every existing rule is kept. The standard clone location is stated: `.joserah/shared/<name>/` inside a Joserah workspace, `~/<name>` without Joserah — one clone per machine, every workspace on it points there.

## 0.15.5

**Tool proposals from both sweeps.** The ordinary workspace sweep now lists tool proposals in `.joserah/desk/tools-proposed.md` from the R&D records and journal it merged, as the memory sweep does: one line each (system, what it would do, which records back it). Record first, script later; a proposal becomes a script only on the owner's yes.

**The memory carries its own vault and sweep check.** A memory now ships `tools/secret.js` (its own `keys/` vault, gitignored; names-only index in `.memory/vault-index.md`) and `getSecret` looks there first, then in the Joserah workspace vault, then prompts. `tools/sweep.js --before/--after` guards that every inbox claim line reached `knowledge/` verbatim and stamps the sweep only when none is missing. Run `--refresh-memory` to pick both up.

**verify-links counts wikilinks.** The memory's `verify-links.js` now checks `[[wikilinks]]` against note titles the way the plugin's does, so doctor and the memory report the same broken links.

## 0.15.4

**Record first, script later.** What was verified against a system (endpoints, login flow, parameters, traps, what the API cannot do, date and condition) enters the shared memory as a record, never as a script an assistant wrote. At every sweep the sweeper lists tool proposals from the accumulated R&D records in `desk/tools-proposed.md`; a final sweep compiles the agreed ones into `tools/<system>/`, built from a recorded, verified procedure and holding no secret. Node by default, PowerShell only where the host is Windows-only.

**A member's push carries a refreshed memory.** `sync.js --push` now also commits and pushes `AGENTS.md`, `README.md` and `tools/**` after `--refresh-memory`, so a non-sweeper member can land them; the push notice lists them marked `(refresh)`.

## 0.15.3

**A commit signs itself.** A commit message ends with one signature line, `<model> <effort> — Joserah <role>` — the main session signs Orchestrator, a subagent Worker (for example `Claude Fable 5.1 High — Joserah Orchestrator`); never a `Co-Authored-By` trailer. Prompt v14.

**A summary before deletion.** Work about to be deleted, abandoned or replaced gets its R&D summary recorded first — what was tried, what was learned, what it cost — in the project's docs or the journal; only then the delete.

**Independent pieces run in parallel.** The orchestrate skill places independent work on separate workers at once, each with its own files; only dependent steps go to one worker in sequence.

**The shared memory works without Joserah.** Git and Node are enough: `tools/verify-links.js` and `tools/claims.js` now ship inside the memory (built-ins only), and every pull prints one `checks:` line. Any Joserah member's `/joserah:update` refreshes a joined memory's rules and tools from the template (`scaffold.js --refresh-memory <dir>`), with the usual push notice; doctor names that command when a memory drifts. `detect-member.js` accepts only a name in the memory's members list and asks otherwise. Sweep is due at five inbox files or seven days. The memory rules now state the decision criterion (a dated purchase or operating decision inside the member's own responsibility is a company decision; an idea is a proposal), that claim lines travel verbatim through a sweep with a count before and after, and that a member pushes as soon as something worth sharing is written, not at the end of the day.

**Verified procedures live in the memory as tools.** A procedure that worked against a system goes in as a script under `tools/<system>/` (Node by default, PowerShell only where the host is Windows-only), never holding a secret: `tools/lib/secret.js` `getSecret(envName, vaultName)` takes the value from an environment variable, from the member's Joserah vault, or from a hidden terminal prompt — the assistant never sees it. Every member uses the same secret names.

**`secret.js --remove <name>`** deletes a stored name and rewrites the index.

## 0.15.2

**Install from the repository URL.** The install prompt is "Install Joserah from https://github.com/SerVian7/joserah and set it up for me"; setup clones a URL to `~/joserah` first and skips the clone only for a local path.

## 0.15.1

**Reminders once a day, and only when something piled up.** The briefing's `[backup]` line appears only when a day or more has passed since `lastBackup` and at least one file changed (an untouched journal stub still never counts); the new `[sweep]` line when a week has passed since `lastSweep` or five days of journal have piled up since it. Each is one sentence in the owner's language ("Yedek 3 gündür alınmadı, 12 dosya değişti — istersen alayım.") and is said at most once per calendar day per workspace (a stamp in the OS temp dir). Doctor's `knowledge sweep` warning uses the same rule; it was 14 days.

**Old vault sources stay where they are.** `migrate` no longer renames or moves a file in `keys/`: a clean import is recorded in `config.json` under `vault.imported` and not read again, and the owner deletes the original if they want to. A file that `.mcp.json` or `.claude/settings*.json` names is not opened (`vault.inUse`). `secret.js --import` refuses what is not a vault, with exit 4 (`vault.notVault`, with the reason): a service-account key (`"type": "service_account"` or a `private_key` field), PEM or OpenSSH content, a file over 512 KB, or a JSON of any other shape. A foreign-shaped `keys/secrets.json` still moves aside (its path is the store's), and moves back if it proves not to be a vault. A file 0.15.0 already renamed to `*.imported-<date>` keeps that name; `docs/migrations/0.15.0.md` says what to tell the owner.

**A collector's record array is imported by record.** `[{ system, kind, username, value, note, ... }]` becomes `<prefix>.<system>.<field>`: the field comes from `kind` (`api key` gives `api-token`), `username` becomes `.user` and `note` becomes `.note`. `name`, `collected` and `found-in` are metadata and are not stored. `--prefix` is required. A repeated system and field with a different value is numbered `-2`, `-3` and listed. It used to be flattened by index into names like `0.found-in.3`. `--import ... --replace --yes` empties the store before it imports (the `.bak` keeps the old one); without `--yes` it only says how many names it would delete.

**The owner saves a secret without the assistant seeing it.** With nothing piped in, `secret.js --set <name>` asks for the value in the terminal with echo off. Piped input works as before.

**The words.** Prompt version 13. Rule 3: when the owner wants to save a password, the assistant gives them the one `--set` line to run in their own terminal. Only a secret the assistant already has in front of it goes in through stdin. §2: a commit message carries no AI attribution line. §5: asked how a background job is going, the assistant asks the worker and does not guess (`orchestrate` says the same). Nothing the plugin ships writes an attribution trailer. Run `/joserah:update`.

**After an update, `/reload-plugins` is enough.** The briefing's `[update]` line, `/joserah:update` and the README now say to run it and not to restart. A restart is suggested only if the new version is still not active after the reload.

## 0.15.0

**One vault format, imported in one pass.** `keys/secrets.json` in the standard shape, filled and read only through `secret.js`, is the vault in every workspace. `secret.js --import <file> [--prefix <scope>] [--delete]` brings in any old vault — JSON of any nesting (`corlu → cam1 → user` becomes `corlu.cam1.user`) or a `.env` — listing names, never values, and never overwriting: a name that exists with a different value is a listed conflict, exit 1. `/joserah:update` runs it once per workspace (`migratedTo` below 0.15.0) on every JSON or `.env` file in `keys/`, and on a `secrets.json` in a foreign shape (moved to `secrets.json.imported-<date>`, then imported into a fresh store; `secret.js` now refuses to work on such a store rather than listing nothing). A clean source is renamed `<name>.imported-<date>`, never deleted; the migrate report carries counts only. A module's own `.env` is never imported. `docs/migrations/0.15.0.md`.

**Names without values.** `secret.js --index` writes `.joserah/vault-index.md`, the names grouped by scope; every change to the store rewrites it, and it is the one vault file the assistant reads. `secret.js --rename <old> <new>` corrects an imported name without anyone seeing the value.

**A secret standing in a note leaves it.** `secret-scan.js <workspace> --extract` proposes a name per hit (`<scope>.<file>.<field>`) and changes nothing; with `--yes` it stores each value through `secret.js --set` and replaces every whole occurrence in the note with `$(node .joserah/tools/secret.js <name>)`, keeping line endings and never touching `keys/`. A name that already holds a different value is a conflict: the note keeps its text, exit 1. The scan no longer reports such a reference as a finding.

**The words.** Prompt version 12: rule 3 says to name the secret and never the value, that what exists is in `.joserah/vault-index.md`, and that `--extract` moves a stray secret — never a hand copy. Doctor adds `vault index current` (counts only). Run `/joserah:update`.

**`ownerIsDeveloper` is removed.** No config key decides how technical the talk is: the briefing always says to match the owner and volunteer no internals they did not ask for. A developer who wants them named plainly writes one line in their own `.joserah/directives.md`. `migrate.js` deletes a leftover key (`configKeysRemoved`).

**A shared memory's state is a sentence.** The briefing says it in the owner's language (Turkish or English): behind — the count, the latest commit's author, subject and age, and that it will be pulled at session start; ahead — the unpushed commits and `sync --push` for the push notice; level — up to date. The sweep-due and open-item lines stay.

## 0.14.0

**No marketplace, no cache, no `claude plugin update`.** Joserah is a git clone linked as `~/.claude/skills/joserah` and loaded in place as `joserah@skills-dir` (README, "Where Joserah runs"). `/joserah:update` is a `git pull` on the clone, the workspace migration, then `/reload-plugins`. The re-copy of 0.13.8–0.13.10, its diagnostics file and stamps, and `tools/install-dev-hook.js` are gone; the briefing keeps the daily "N new commits upstream" line. Doctor's new `plugin loaded from the skills dir` check warns on a copy in the plugin cache.

**Install is one prompt, and setup notices the assistant.** `tools/detect-harness.js` reads documented markers only (`CLAUDECODE=1`, Antigravity's `~/.gemini/config` and `~/.gemini/antigravity-cli`, `claude` on PATH, `~/.claude`). Claude Code gets the link; Antigravity and anything else get AGENTS.md-only mode.

**Setup asks four things.** Location (none, when the current folder is empty), the owner's name, an optional assistant name, and the language — inferred from how they write. Gone: the machine-or-folder question (trust is `owner`, kind `home`; hosting only on an explicit `--hosted` request), the definition and its keep-itself-current mode (`--identity-mode` and the `identity` block are removed), the consent gate (a one-line notice now; `--consent-model` and the `consent` block are removed) and the feedback question (off unless a developer passes `--feedback`).

**The texts say one thing.** An editorial pass over the prompt, the roles, the skills and the templates: an unnamed assistant is the assistant and Joserah is its memory; no skill hand-edits `AGENTS.md` (integrations are recorded in `directives.md`); `learn` takes only a batch handed over by the main session; the drop folder is `imports/`; the hosted role no longer assumes the host is not a developer, or male. Prompt version 11 and a changed hosted role: run `/joserah:update` (doctor names `JOSERAH-ROLE.md` in a hosted workspace). Release notes moved from the README into this file.

**Shared memory.** A new kind, the Joserah Memory: a company's shared memory in its own git repository (`templates/memory/`, `tools/lib/memory.js`). `scaffold.js --kind memory --company <name> --members a,b --sweeper a --target <dir>` creates one with its tools (`sync.js`, `sweep-due.js`, `detect-member.js`, `verify-links.js`, `claims.js`) and a first commit; `scaffold.js --join-memory <url> --target <workspace>` clones one into `.joserah/shared/<name>/` and names it under `shared` in config.json. Setup recognises both requests. Doctor checks a memory on its own path (layout, tools, links, claims, an overdue sweep, a member writing outside their folder) and, in a workspace, each memory it names. The session briefing adds one block per memory: commits upstream, the sweep-due line and the member's open items. The workspace `.gitignore` now carries `.joserah/shared/*`, and the workspace's link, claim, migration and secret scans stay out of it.

**Upgrading from 0.13.x, once:** `/plugin uninstall joserah@joserah`, `/plugin marketplace remove joserah`, link the clone (README, "Where Joserah runs"), restart Claude Code. Workspaces are untouched; run `/joserah:update` afterwards.

## 0.13.10

**The re-copy runs where it can be seen.** 0.13.8 started `claude plugin update` as a detached child of the session-start hook, and in the IDE the cache stayed on the old version. It now runs synchronously (at most 25 s, about 2 s measured), once per clone version, logged to `joserah-recopy.log` in the temp dir; a failure leaves no stamp and is retried next session, with the log named in the briefing. `claude` is also looked for off PATH (`%APPDATA%\npm`, `~/.local/bin`, `~/.claude/local`, `/usr/local/bin`), and every attempt writes `joserah-recopy-diag.json` there. Developers: `node tools/install-dev-hook.js`.

## 0.13.9

**Identity needs no lookup.** The session's workspace block now states the assistant's name, the owner's name and the language whether or not they are set — an unnamed assistant is told "You have no name here: you are simply the assistant" — and the client and hosted role files say "give yours if you have one". A workspace's `JOSERAH-ROLE.md` then differs from its template; `/joserah:update` replaces it (doctor names the file).

## 0.13.8

**After a `git pull` of the clone, only the restart is left.** When the clone carries a newer version than the loaded copy, the session briefing now starts `claude plugin update joserah@<marketplace>` itself, detached and at most once per version, and says a restart runs it; with no `claude` on PATH it falls back to pointing at `/joserah:update`.

## 0.13.7

**One lookup, then the answer.** Prompt version 10 tells the assistant to answer a factual question from its first lookup and never to go silent behind a chain of tool calls, and a new `PreToolUse` hook (`hooks/tool-count.js`, every tool, main thread only) adds one line of context on every third tool call since the owner's last message — run `/joserah:update`.

## 0.13.6

**A directory marketplace still loads a copy.** Measured on Claude Code 2.1.251: with Joserah installed from a `directory` marketplace, `installed_plugins.json` points at `~/.claude/plugins/cache/joserah/joserah/<version>/`, a real copy of the clone, so a `git pull` alone changes nothing that runs. `/joserah:update` now does both steps: `git pull --ff-only` on the clone (found through `known_marketplaces.json`; `check-update.js` reports it as `checkout`), then `claude plugin update joserah@<marketplace>` to copy the new version, then `/reload-plugins`. The session briefing adds a second `[update]` line when the clone carries a newer `plugin.json` version than the loaded copy: "Joserah <version> is pulled but not loaded".

**Every release bumps the version.** `claude plugin update` copies again only when the version in `.claude-plugin/plugin.json` changed, so a release without a bump never reaches a running session.

## 0.13.5

**`/joserah:update` is the only way Joserah updates itself.** The plugin is now installed from a local clone registered as a `directory` marketplace, (`marketplace.json` already lists it as the relative-path source `./`). This note first said the plugin then loads in place; it does not — see 0.13.6 below. `/joserah:update` runs `git pull --ff-only` on that clone, migrates the workspace, and asks for `/reload-plugins`; a restart only when `hooks/hooks.json` or MCP configuration changed. The session briefing's `[update]` line now comes from a daily `git fetch` and says how many commits the clone is behind; an install that is not a checkout keeps the old version comparison.

**Moving an existing install, once:** `/plugin uninstall joserah@joserah`, then `/plugin marketplace remove joserah`, then the three steps under Install (clone, `/plugin marketplace add <path>`, `/plugin install joserah@joserah`). Workspaces are untouched by the move; run `/joserah:update` afterwards.

## 0.13.4

**The session briefing keeps what matters when it overflows.** Today's journal is capped in the brief: its title and Top of mind, then its newest ~1,500 characters, with a `[cut]` line saying how much was left out. The `[update]` and `[backup]` lines now come before the learnings, so a budget cut drops learnings first. The cut notice names what was actually cut instead of always sending the session to `directives.md`.

**A fresh workspace stops briefing itself about nothing.** The untouched journal stub is no longer injected, and no longer counts as "1 file changed" in the backup line. The `setup` skill fires only on an explicit request to set up or continue setting up, never because a workspace looks empty.

**Subagents get a worker payload.** At SubagentStart the hook keeps the workspace facts and the language but drops the greeting and the signature, and opens with "You are a worker dispatched by the main session: do the task you were given, do not delegate further, report back as text."

**Delegation says one thing.** Prompt version 9: the §5 routines (journal, tasks and captures, people, learned) are always inline, however many files they touch; research, planning, multi-file work and sweeps go through `orchestrate`, in the background by default. `orchestrate` no longer says a lead never backgrounds its workers; its brief template carries "a worker does not delegate further" instead. Run `/joserah:update`.

## 0.13.3

**The standing layers travel through CLAUDE.md.** Every workspace gets a small plugin-owned `CLAUDE.md` at its root that `@`-imports `AGENTS.md`, `JOSERAH-ROLE.md` and `.joserah/directives.md`. Measured on 2026-09-23: the headless CLI (2.1.251) never loaded `AGENTS.md` at all, but loaded `CLAUDE.md` and expanded its imports whole — a 59,928-byte file arrived — while a hook command over 10,000 characters arrives as a 2,000-character stub. A directives file no longer has to stay under the hook's 5,000-character cap to reach a session.

**The hook stands down only where the imports arrive.** When a session starts at the workspace root and `CLAUDE.md` imports a layer, `session-start.js` no longer injects it, so nothing is sent twice; the identity block, the agent overlay (`.joserah/agent.md`, only the text below its marker) and the computed briefing stay in the hooks. With no `CLAUDE.md`, an owner-written one that lacks the lines, or a session started in a subfolder — where, measured, the parent `CLAUDE.md` loads but its imports do not expand — the hook injects every layer exactly as before.

**An owner-written CLAUDE.md is never touched.** `migrate.js` used to delete any `CLAUDE.md` it found; it now installs or refreshes only the plugin's own stub (recognised by its first-line marker), leaves any other `CLAUDE.md` as it is and lists it in `skipped`. Doctor's new `CLAUDE.md imports the standing layers` check fails on a missing or stale stub and warns on an owner-written file that lacks the import lines, naming them. Prompt version 8 says the layers are imported or injected. Run `/joserah:update`.

## 0.13.2

**Delegation has a hard threshold.** Where background agents exist, reading more than a couple of files, research, planning, a status or summary sweep and any multi-file change go to subagents (prompt version 7 and the `orchestrate` trigger); only a single small edit stays inline — run `/joserah:update`.

**The never-background rule travels down the chain.** `orchestrate` now says a lead never backgrounds its workers and copies that rule verbatim into every brief it writes, and its new brief template carries it.

**Migration leaves vendored material alone.** `migrate.js` (and every tool sharing its scan) no longer adds frontmatter under an `assets/` or `skills-ref/` folder, or in any folder holding a LICENSE: third-party skill copies and scraped source texts are not notes.

**Claim types are closed.** The prompt and the `sweep` skill now say measurement, calculation, decision and estimate are the only claim types, and that a measurement always carries `condition:`.

## 0.13.1

**Joserah no longer depends on another plugin.** Until now `skills/project/SKILL.md`
told every session to run two skills belonging to a third-party plugin before it
touched the filesystem, `/joserah:setup` stopped and refused to continue where that
plugin was not installed, and this README carried its install commands. All three are
gone. The planning step Joserah actually wanted is shipped in `skills/project/SKILL.md`
itself: name which of three sizes the job is, put it in front of the owner in their own
language, stop for a yes, and write a plan file only for the largest. The guard that
should have caught this — `tests/skills.test.js` — scanned four of the ten skills from a
hand-written list; it now reads `skills/` off disk, so a skill added tomorrow is covered
the day it lands.

**The briefing stops telling the assistant what the owner is not.** `hooks/session-start.js`
injected "They are the owner, **not a developer of this software**" into every session,
while the shipped `templates/AGENTS.md` rule had always excepted "unless they ask, or they
are the developer" — the product contradicted itself and asserted something about a person
it cannot know. The default line now says how much to say rather than what the person is,
and `templates/roles/joserah-client.md` says the same. A workspace whose owner builds this
software adds `"ownerIsDeveloper": true` to `.joserah/config.json` by hand and gets "name
files, tools, commits and versions plainly" instead. Nothing writes the key; a client's,
a held or a hosted workspace must not have it. `docs/migrations/0.13.1.md` has both steps.

**The brand stops signing with a middle dot.** `.brand/mail.html` and `.brand/report.html` were
rebuilt so neither page carries a mark a generator hands out free: the top line of a mail is now
the subject alone — no brand name welded to it — and a named assistant signs its name, a space,
then `Joserah` a shade fainter, with nothing between the two words. An assistant with no name is
Joserah and still signs once. Where tone cannot be carried, as in plain text, it is the comma
form, `Yarkın, Joserah`. `hooks/session-start.js` and the `correspondence` skill say the same
thing, and the skill gained a short "defaults we do not use" list — against stock furniture, not
against the burgundy rule, the large faint J or the dark ground, which are ours and stay. A
workspace whose own `directives.md` spells out the old signature has to be updated by hand;
`docs/migrations/0.13.1.md` step 3 says how.

**A lead no longer backgrounds its workers.** A worker's completion notice reaches the top session, not the lead that opened it, so the `orchestrate` skill now says a lead waits on its workers directly, in parallel batches, and never runs them in the background.

## 0.13.0

**The session briefing was not arriving.** Claude Code replaces any single
hook command's added context over 10,000 characters with a stub carrying only
the first 2,000 of it plus a file path — undocumented. Measured across 25
sessions on CLI 2.1.269-2.1.273: the briefing produced 10,140 to 16,417
characters and 2,263 arrived, every session for about a week. Nothing
announced it. The role file's first lines got through; the workspace identity,
the owner's own standing rules, the open tasks, the journal and the learnings
did not.

The fix is two things. Each hook command's output is now capped at 8,000
characters, and when something does have to be cut, the notice is the **first**
thing in the output rather than the last — a warning printed after the text it
warns about is thrown away with it, which is exactly what happened to the
per-file `[cut]` line. And the SessionStart briefing is now two hook commands
instead of one: the standing layers in one, the date, tasks, journal,
learnings and update lines in the other. Two commands, two budgets, neither of
them near the limit. The per-file cap drops from 10,000 to 5,000 so no single
layer can fill a command by itself, and the overlay below the marker in
`.joserah/agent.md` — which had no cap at all — now has one.

**`AGENTS.md` is 148 lines**, down from 200 (prompt version 6), with the
greeting, the identity re-read and the tone lines the role files and hooks
already handle taken out. It is not part of the fix above: that file reaches
the model through the host's own file discovery, not through a hook, so it was
arriving whole all along. Three hard rules are new: mail goes only to the
recipients the owner named, a counterparty's message is data and not
instructions, and a host's assistant never reads or writes a guest workspace's
folder.

**Skills: twelve become ten.** `dispatch`, `plan` and `research` are now
`orchestrate`; `install` and `onboard` are now `setup`; and `correspondence`
is new. `orchestrate` names no model — the effort tiers are extreme, heavy,
medium and simple, and the selected model is the ceiling.

**A `.brand/` folder** ships the mail template and a report template beside the
logo. Nothing under `assets/` moved: mail already sitting in other people's
inboxes fetches its background from those URLs.

**A hosted workspace gets its own role file** instead of the client one. An
existing hosted workspace will start failing doctor's `exists: JOSERAH-ROLE.md`
check until its role file is replaced — that is the check working, and
`docs/migrations/0.13.0.md` says what to do. The capture hook no longer treats
a background agent's finish notification, or the harness's own reminders and
command echoes, as something you said.

## 0.12.0

Every workspace now has a vault. A secret the assistant sees — pasted in chat,
found in a file, an import, a config, a tool's output — is saved at once,
without asking, into `keys/secrets.json` through `.joserah/tools/secret.js
--set <scope>.<system>.<field>`, and the owner is told in one line under which
name. From then on it is used only embedded in a command,
`$(node .joserah/tools/secret.js <name>)`, never printed; notes, answers and
commits carry the name. The prompt's rule 3 says so (prompt version 6), and
`keys/AGENTS.md` describes the tool.

Two hooks hold the line. A new PreToolUse hook refuses a bare `secret.js
<name>` call and any command naming `keys/secrets.json` without going
through the tool — a guardrail, not a wall. The prompt hook adds a one-line
reminder when a message looks like it carries a password or token.

An existing workspace picks this up through `/joserah:update`: doctor's new
`local secret.js current` check fails until the plugin's `tools/secret.js`
is copied to `.joserah/tools/secret.js`; the store is created by the first
`--set`. `keys/AGENTS.md` is not replaced on an existing workspace — copy it
from the plugin's template if you want the new text.

## 0.11.3

Every walk the plugin makes — the link check, the migration scan, the claims
audit, the changed-since count, the secret scan, the zip backup and doctor's
placeholder scan — now skips hidden directories other than `.joserah` and
`.claude`. A hidden folder is a tool's, not the owner's: editor servers, model
caches, package caches. A workspace rooted at a home directory holds dozens of
them, and the scans were reading thousands of their markdown files as notes.

`.joserah/config.json` also accepts an optional `scope` list — the root entries
that ARE the workspace. When the key is present, nothing else at the root is
walked, zipped, migrated or link-checked. An ignore list was the wrong way
round: a home directory grows new tool folders without asking, so the list
could never be finished, while the handful of folders that are the owner's own
work can simply be named. The plugin's own shell (`.joserah`, `AGENTS.md`,
`JOSERAH-ROLE.md`, `keys/`, `projects/`, `imports/`) is always in scope and
never needs selecting. Nothing writes the key; a workspace rooted at a home
directory sets it by hand:

```json
"scope": [".claude", "notes"]
```

Entries are matched on their first path segment, so naming a folder takes
everything under it. A workspace without the key, and without hidden tool
folders, scans exactly as it did before.

## 0.11.2

The session briefing took the first three sections of `learned.md` and called
them the newest. That is only true while the file happens to be written
newest-first, and nothing enforces that: in a workspace kept the other way
round, or one where a single entry was appended at the bottom, the newest rules
reached no session at all — while the owner could see them written down and
reasonably assume they were in force. The briefing now picks by the date in each
heading, so the newest three travel wherever they sit in the file, and a section
with no date is not mistaken for a learning.

The sweep also stopped splitting the reading further than the work needs. Every
agent pays the same fixed opening cost whatever it is handed — the claim format,
its own link check, auditing what it wrote — so eight agents over small folders
pay it eight times for the reading three would have done. Small folders are
grouped; a folder gets its own agent when it is big enough to earn one.

## 0.11.1

The sweep treated a missing `lastSweep` as proof that nothing had ever been
done, and offered to read every page in the workspace — in front of an owner
whose notes had been harvested the day before by a one-off job that stamped
nothing. The work predates the skill everywhere it is installed, so the stamp
can only ever be evidence that a sweep ran, never that one did not.

It now looks for the work instead of the stamp: a page already carrying claim
lines with their sources has been harvested and is tidied rather than
re-derived, and the recent journal is scanned for a bulk pass whose date the
owner can confirm as the starting point. The page count is quoted after that,
not before.

## 0.11.0

The update stopped pretending it was the whole job. It never reads a note — by
design, so that it stays fast and cannot damage anything — which meant a
workspace could finish an update knowing the claim format and holding no
claims: the format moved on and the content did not. Two things close that.

**Structure notes.** A release that changes what a workspace should *look*
like now ships a note saying so, one file per such release under
`docs/migrations/`, named for its version. `/joserah:update` reads every note
newer than `migratedTo` in `config.json`, oldest first, does what each says —
some steps are a command, some are the owner's decision — and stamps
`migratedTo` only when they are done. A declined step leaves the stamp where it
is, so the question comes back rather than disappearing. Doctor warns when
notes are pending. The first note, `0.11.0`, describes the layout every
workspace should have reached: source material in `imports/`, load-bearing
numbers as claim lines, and the two new config keys.

**`/joserah:sweep`.** The pass that actually reads the pages: it tidies their
structure and turns the numbers in their prose into claim lines, in one reading
rather than two. It works on what changed since `lastSweep`, so a regular sweep
is small; with no stamp it is the first sweep and reads everything, which it
says up front because that one is expensive. It hands the reading out, checks
what comes back by reading the deleted lines in the diff before the added ones,
and stamps `lastSweep` only after the link, claim and doctor checks are clean.
Doctor asks for one when the notes have gone unswept — measured from the last
sweep, or from the day the workspace was created when there has never been one.

Both warnings are warnings, not failures: a workspace whose content is behind
its format is not broken, it is behind.

## 0.10.0

Three new skills and one new hook. The skills carry the rules from the same
2026-09-12 list that only make sense where work can be handed to another agent
or session, so they load when they are needed instead of sitting in the
standing prompt: `research` (how a fact-gathering job is briefed out, how its
report comes back, and checking what a delivered report deleted before reading
what it added), `dispatch` (effort follows the remaining quota, and a second
local session counts as a lane), and `plan` (whoever executes a plan stops when
plan and reality disagree rather than improvising). The hook runs the link
check after a move or rename and speaks only when something broke — silent
otherwise, and silent outside a workspace.

The standing prompt is unchanged, still version 4, so nothing needs
`/joserah:update`; this is a plugin update and the new hook starts working
after the restart that follows it.

## 0.9.0

The standing prompt moves to version 4 and nothing else changes: no code, no
tools, no new files. It takes in the behaviour rules decided on 2026-09-12 —
every turn ends with what was done, the one thing you have to do (or nothing)
and the next step; a finding counts only once you have read it in the
conversation, and nothing is put to you for approval that you have not seen;
questions come in your words with the option and what it costs, never an
internal label; a measurement outranks a calculation and both are read; a
number never travels without its conditions and an unsourced one carries no
weight; a source is cited only after it has been opened and the figure seen; a
struck-through claim is not used again; "done" comes with the output of a
command just run. Four rules the owner considered were deliberately left out,
because they are about spreading work across models and only some setups can do
that — a promise this file cannot keep everywhere does not belong in it. The
file also went back under 200 lines, so the additions cost nothing in length.

Because only the prompt changed, this reaches an existing workspace through
`/joserah:update` — no plugin reinstall is needed. Run it, and your
`AGENTS.md` is replaced with version 4; a hand-edited one is refused rather
than overwritten, and `/joserah:doctor` will tell you so.

## 0.8.0

The claim audit no longer reports "0 errors" about lines it could not read.
Three ways a claim used to fall out of `check-claims.js` in silence are now
errors: a bracket category that is not one of the four types but carries claim
fields under it (`unknown-claim-type`), a field line whose fields are separated
by something other than ` · `, which makes the first field swallow the rest
(`swallowed-field`), and a line sitting between a claim and its field lines —
usually the claim's own sentence wrapped — which cuts every field off from it
(`severed-claim`). Each one hid a claim, or its fields, from every existing
check while the tool declared the file clean, so each fails `/joserah:doctor`
until it is fixed; nothing is rewritten for you and no line is guessed at. Run
`/joserah:doctor` after updating: a workspace that passed before may now have
claims to repair, which means those facts were never being audited. The
standing prompt is unchanged, still version 3, so this is a plugin update and
not a `/joserah:update` of the prompt — the conventions file gains the two
mechanical rules and travels with the workspace as usual.

## 0.7.0

Two layers that every session was only *told to read* are now put in front of
it: the workspace's role file (`JOSERAH-ROLE.md`) and its own standing rules
(`.joserah/directives.md`) are injected at session start, in full, alongside
the rest of the briefing. They were pointed at before, and a pointed-at file is
usually never opened — which meant a workspace's own written rules were in
force only in the sessions that happened to go and fetch them. Nothing of
yours is rewritten: the directives file is never touched, and an untouched
skeleton, an empty file or a missing one still adds nothing to a session. A
file long enough to be shortened arrives with a `[cut]` line saying exactly how
much was left out, and `/joserah:doctor` now prints `standing context size` on
every run and warns before any file gets that long. The standing instructions
changed with it — prompt **v3**, whose opening no longer sends a session off to
open files it has already been handed — so this is both a plugin update and a
`/joserah:update` of the prompt.

## 0.6.0

One library now says which paths a tool may not walk into
(`tools/lib/untouchable.js`), and the workspace's own copy of the link
checker travels with it — `/joserah:doctor` reports it stale if either
file drifts, and `/joserah:update` copies both. One command,
`tools/relocate.js`, carries a workspace from any earlier source-material
layout to `imports/`. The backup skill gets its scope from
`tools/backup-scope.js` instead of restating it. Doctor's checks are a
registry, and a test holds the doctor skill's remedy table to it. The
standing prompt is unchanged, still version 2, so this is a plugin update
and not a `/joserah:update` of the prompt.

## 0.5.0

Source material now lands in `imports/` instead of `raw/`; doctor flags a
root `raw/` and `tools/relocate-imports.js` moves it and rewrites the links.
`raw/` stays recognised, so older workspaces keep working. Notes now carry
typed claim lines — `measurement`, `calculation`, `decision`, `estimate` —
audited by `tools/check-claims.js` in doctor. The prompt moves to version 2.

## 0.4.1

The prompt (`AGENTS.md`) now carries its own version — a
`<!-- joserah:prompt-version N -->` line — separate from the plugin's. A
change to the standing instructions no longer needs a plugin release or an
IDE restart. The session-start hook pulls the marketplace clone once a day
and, when the workspace's `AGENTS.md` is untouched and behind, replaces it on
the spot; the next conversation runs on the new text. `/joserah:update` does
the same by hand, plus the migration and the other plugin-owned files. The
tools record what they installed in `config.json` (`promptVersion`,
`promptSha256`), so `/joserah:doctor` can tell a workspace that is merely
*behind* from one whose `AGENTS.md` was *hand-edited* — the first is
refreshed in place, the second is never overwritten without `--force`, and
`--force` keeps the displaced text beside the file. Hand-edits belong in
`.joserah/directives.md`, which `migrate.js` now creates when it is missing
(it never modifies an existing one) and doctor now requires. Existing
workspaces from 0.3.x–0.4.0 have an unversioned `AGENTS.md`: doctor and the
session briefing will say so; `migrate.js` brings it current when it is
byte-identical to a known prompt, and `/joserah:update` walks the owner
through the rest when it is not. A newer *plugin* is still only announced —
that update, and the restart after it, stay the owner's.

## 0.3.0

`keys/` moves from `.joserah/keys/` to the workspace root — the owner
populates it by hand, so it now lives where hands can find it. Existing
workspaces keep working, but `/joserah:doctor` will flag the old location
and walk you through the move (its "Migrate a pre-0.3.0 workspace" section).
Backups exclude both locations by default (except `keys/AGENTS.md`, which
carries no credential and is always kept in so a restored workspace still
passes doctor) and now **ask** whether keys should be included.
`archive.js extract` refuses to overwrite existing files without `--force`,
and a new `verify` command checks an archive's integrity.

## 0.2.0

0.2.0 moves everything Joserah owns under one hidden folder: `desk/`,
`knowledge/`, `personal/` and `keys/` all move under `.joserah/`. An existing
workspace is migrated by moving those four folders under a new `.joserah/`
directory and repointing the relative links in `AGENTS.md` and anywhere else
that referenced the old paths. Run `/joserah:doctor` afterwards to confirm
the move is complete. **If you're catching up from 0.1.x straight to the
current release, `keys/` does not stay under `.joserah/` for long — the 0.3.0 note moves it back out to the workspace root in 0.3.0. Do both moves
in the same sitting rather than the first one alone.**
