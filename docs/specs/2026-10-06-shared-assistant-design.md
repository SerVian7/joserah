# Shared assistant — design

**Status:** experimental, on branch `exp/shared-assistant`. Not approved, not merged. Open owner decisions in §9.
**Source:** Serkan (owner, developer of Joserah), 2026-10-06 night: "Ortak asistan konusu. Şirket asistanını shared
olarak içeri alabilmeliyim. Ortak hafızayı kurumsal yapıya birleştirme — aynı iş. Yine herkes kendi adına pushlayacak
vs. Karphaty metoduyla belki sweep den kurtuluruz. Sürekli doğru kaydetme olayı. Bunu da başka bir dalda
deneyebilirsiniz." Earlier record (task list, 2026-10-05 11:54): shared memory → shared assistant; a company assistant
runs on the company server; a Joserah user adds it as shared; work goes over ssh plus a job, not a remote session;
guard against conflicts; the choice is asked at setup; hosting is experimental.
**Read for this:** `templates/memory/` (AGENTS.md, README.md, tools/), `tools/lib/memory.js`, `skills/setup/SKILL.md`
(§Shared memory), `skills/sweep/SKILL.md`, [2026-10-05-local-server-design.md](2026-10-05-local-server-design.md) §6–8,
the workspace research note `platform/research/16-kb-maintenance-and-memory-tools.md` (Karpathy's LLM-wiki gist,
avenoxbeyin, mem0, Graphiti).

## 0. In one paragraph

A company keeps **one** record: its Joserah Memory (a git repository). Today members write their own folder and an
inbox, and one sweeper periodically merges the inbox into `knowledge/`. This design changes two things. **Recording
becomes continuous**: whoever writes a fact ingests it at write time — Karpathy's ingest: the touched pages, the index
and the log are updated in the same commit — and a zero-token deterministic gate checks every push, so there is no
backlog to sweep. **The company assistant becomes a member**: a Joserah assistant running on the company server joins
the same memory like any member, keeps the record healthy (lint, the inbox of members without an assistant), and takes
jobs from members' own assistants over ssh — a restricted key per member, so every job and every commit still carries
the member's name. "Merging the shared memory into the corporate structure" and "the shared assistant" are thereby
one piece of work: the company assistant's knowledge *is* the shared memory.

## 1. What exists today (read, not assumed)

- **The memory** (`templates/memory/`, `tools/lib/memory.js`, 0.14.0+): a git repo; `.memory/config.json` holds
  `kind: memory`, `company`, `members`, `sweeper`, `lastSweep`. Members write only `members/<me>/`, `inbox/`,
  `questions/`; only the sweeper writes `knowledge/` (AGENTS.md §2, §6).
- **Joining** (`scaffold.js --join-memory <url> --target <ws>`): clones to `<ws>/.joserah/shared/<name>/`, adds
  `{name, path}` to the workspace config's `shared`, gitignores `.joserah/shared/*`.
- **Pushing** (`tools/sync.js --push`): stages the member's folder, `inbox/`, `questions/` (plus refreshed
  AGENTS/README/tools), prints a push notice, commits only on `--yes` with subject `<member>: <date>`; pulls with
  `--rebase --autostash` before pushing. On a failed rebase it dies **leaving the clone mid-rebase**.
- **Sweeping** (`tools/sweep.js --before/--after`, `sweep-due.js`): the sweeper merges the inbox into `knowledge/`;
  `--after` proves every inbox claim line arrived verbatim; due at 5 inbox files or 7 days.
- **Doctor** (`memoryChecks`): warns when a non-sweeper commit touched anything outside its own folder and `inbox/`.
- **Who is who** (`detect-member.js`): `.memory/me`, else the host workspace's `ownerName`, else `git user.name`;
  only names in `members` count.
- **The company assistant today** is a separate Joserah workspace on the company server (CTRL), reached by the owner
  over ssh and by Remote Control. Its knowledge and the shared memory are two records of the same company.
- **The platform server** (approved 2026-10-05, being built in `server/`) already has a job runner (`jobs.ts`,
  `engine.ts`, `checkpoint.ts`) that runs the logged-in `claude` CLI headless per job, one at a time by default.
- **The wiki operations** (`tools/lib/wiki.js`): index generation, `log.md` lines `## [YYYY-MM-DD] op | title`, and a
  deterministic lint — for a workspace's `.joserah/knowledge/`, not yet for a memory.

## 2. The shape

| Who | Where | Writes |
|---|---|---|
| **Member** (a person) | their own machine, their own Joserah workspace (or any AI reading `AGENTS.md`) | through their assistant, in their own name |
| **Member's assistant** | that workspace; the memory clone at `.joserah/shared/<name>/` | `members/<me>/`, `questions/`, `inbox/`, and — continuous recording — `knowledge/` by ingest |
| **Company assistant** | the company server: its own Joserah workspace, the memory cloned inside it, its own Claude Code login | as member `<assistant>` (e.g. `ctrl`): its folder, ingests of the inbox, lint findings as questions; jobs for members |
| **Steward** | a role, not a person: the member named `sweeper` in config (the company assistant once it exists) | what is left of the sweep (§5.4) |

The memory stays what it is — plain markdown in git, readable without Joserah. The company assistant is not a
second store and not a remote desktop: it is one more member that happens to live on the server and accepts jobs.

## 3. Question 1 — how a member adds the company assistant as shared

**Once, on the server (the admin):**
1. The company assistant's workspace joins the memory like any member: `scaffold.js --join-memory <url>`;
   its member name (e.g. `ctrl`) is added to `members` in `.memory/config.json` by a normal commit.
2. A job gate is installed: one script, the only thing a member's key may run on the server (§3.1).
3. The admin sets `assistant` in the memory's `.memory/config.json` — `{ "member": "ctrl", "ssh": "<host alias
   members use>", "user": "ubuntu", "gate": "<absolute path of the gate on the server>" }` — so every member's
   clone learns that the company has an assistant and where it is. Names and paths only, never a key.

**On a member's machine (the setup question):** joining a memory that names an `assistant` asks one question,
in the member's language: *"Şirketin sunucuda bir asistanı var (ctrl). Onu da ekleyeyim mi? Ekleme: sadece ortak
hafıza. Ekle: sunucudaki asistana iş de verebilirsin; senin için bir anahtar oluşturur, yöneticiye tek satır
gönderirsin."* On yes:
- the workspace config's entry becomes `{ name, path, assistant: { member, ssh } }`;
- an ssh key just for this is made on the member's machine (`~/.ssh/joserah-<company>`), and the setup prints the
  **one public-key line** the admin adds on the server (§3.1) — nothing secret leaves the machine;
- an `~/.ssh/config` host entry is proposed (shown, written on yes) so the alias resolves.
Without Joserah, README tells the member the same in three lines.

### 3.1 The job gate — ssh plus a job, not a remote session

Each member's public key goes into the server's `authorized_keys` with OpenSSH's forced-command options:

```
restrict,command="node /home/ubuntu/joserah-gate/gate.js --member serkan" ssh-ed25519 AAAA… serkan@laptop
```

`restrict` turns off port forwarding, agent forwarding and the terminal; `command=` makes sshd run only the gate,
handing it the member's words in `SSH_ORIGINAL_COMMAND` (OpenSSH `authorized_keys` format, sshd(8); not yet tried on
the company server). The gate parses that text itself — never through a shell — and knows *who* from its own
`--member` argument, never from the request. Commands:

| Member's assistant runs | Gate does |
|---|---|
| `ssh <alias> ask "<question>"` | queues an **ask** job (read-only: the memory plus what the company assistant may read); prints a job id |
| `ssh <alias> ingest <path in memory>` | queues an **ingest** job for a note the member already pushed (members without an assistant, or by choice) |
| `ssh <alias> status <id>` / `result <id>` | the job's state / its answer text and the commit it made, if any |
| `ssh <alias> jobs` | the member's own recent jobs |

Jobs run **one at a time** through the platform server's job runner (decision D3), each a fresh headless `claude`
session in the company workspace, with a per-kind tool allowlist (server design §8): `ask` reads only; `ingest`
writes only `knowledge/**` and the log; nothing a job does reaches a live system in v1 (decision D4). A job's text is
data: the company assistant answers it within that member's scope (standing rules 9 and 12) and never prints a
secret. Remote Control stays the admin's own door to the server and is not part of this.

## 4. Question 2 — every member keeps pushing in their own name

The name is carried in five places, all checkable without a model:

1. **Their own clone, their own git identity** — every member still commits and pushes from their own machine;
   nothing about continuous recording routes their writes through someone else.
2. **Commit subject** `<member>: …` (today's rule) — doctor reads it.
3. **Claim lines** carry `by: <member>`.
4. **Log entries** carry `by: <member>`; the push gate refuses an entry whose `by:` is not the member pushing.
5. **Jobs:** when the company assistant writes something because a member asked (an ingest of their note), the
   commit's **author** is that member (name and address from the memory's `members` list, decision D2) and the
   **committer** is the company assistant, with a trailer `Requested-by: <member> (job <id>)`. Git keeps author and
   committer apart, so "who said it" and "who typed it in" both survive. Its own lint findings are authored by itself.

## 5. Question 3 — continuous, correct recording instead of the periodic sweep

### 5.1 The rule

**Whoever records a fact ingests it, in the same push.** Karpathy's ingest, mapped onto the memory:

| Karpathy | In the memory |
|---|---|
| raw sources, immutable | the member's note `members/<me>/notes/<date>-<slug>.md` (their words, never edited after ingest — a correction is a new note), archived documents in `knowledge/sources/`, inbox notes once ingested (moved to `knowledge/sources/inbox/`) |
| wiki pages, LLM-owned | `knowledge/wiki/entities|topics/`, `knowledge/people/` — one subject per page, claim lines copied **verbatim** |
| `index.md`, one line per page | `knowledge/index.md`, a generated block — never written by hand |
| `log.md`, append-only | `knowledge/log.md`: `## [YYYY-MM-DD] ingest|fix|lint | <title>`, then `by:`, `source:`, `touched:` |
| lint | the push gate (every push, zero tokens) + the steward's lint (§5.4) |

### 5.2 The write-time steps (in the memory's `RECORDING.md`)

1. `node tools/sync.js` — pull.
2. Write the note in `members/<me>/notes/` (or skip this for a pure fix and log `fix` with the page as source).
3. Update every page the note touches. Search first (index, then text) — never a twin page. Conflict rule from the
   research: correct in place, never add a contradicting copy; a measurement or a later decision by whoever holds
   that responsibility strikes the older claim with `superseded:`; anything else keeps both lines and opens a
   question to the older claim's `by:` member. Never decide another member's claim away.
4. `node tools/ingest.js log --op ingest --title "…" --source <note> --touched <pages>` — the entry, formatted by
   the tool.
5. `node tools/sync.js --push` — regenerates the index, stages `knowledge/` with the member's folder, **runs the gate**,
   then the push notice; refused if the gate fails.

### 5.3 The gate — `node tools/ingest.js check` (deterministic, zero tokens)

Against the remote it last pulled (or the first commit when there is none), on the staged state:
- every log entry added must carry `by:` = the member pushing, a `source:` that exists, and `touched:` pages that exist;
- every changed page under `knowledge/` (except `index.md`, `log.md`, `sources/`) must be named in an added entry's
  `touched:` — **no silent edits** to the record;
- every claim line of each added entry's source stands in `knowledge/` verbatim (the sweep's `--after` rule, now per
  push);
- `knowledge/index.md` equals what `ingest.js index` generates;
- the touched pages have no malformed claim line and no broken link.

This is what makes recording "correct at write time" without a model: the model writes, the gate proves the
mechanical half (nothing dropped, nothing silent, nothing broken), and the push is refused until it holds.

### 5.4 What is left of the sweep

Not the merge — there is no backlog to merge. Three small duties, all the steward's, all over the change set only:
1. **The inbox of members without an assistant.** `inbox/` stays: anyone can drop a note there with git alone. The
   steward ingests each one (author = the note's member, §4) and moves the note to `knowledge/sources/inbox/`.
   `sweep-due.js` then says "N inbox note(s) waiting for ingest", not "sweep due".
2. **Lint.** Nightly, the deterministic whole-memory check (links, claims, orphans, duplicate names, size); the LLM
   pass reads only pages changed since the last run and **quotes conflicting sentences into `questions/`** to the
   members whose claims disagree — it never picks a side.
3. **Tool proposals** (`desk/tools-proposed.md`, record first, script later) — weekly, from the log, not from a
   re-read of everything.

The cost scales with the change set, as the research measured for the workspace's nightly pass; with no change the
run stops at the zero-token layer. `tools/sweep.js` stays for memories that keep `recording: sweep`.

## 6. Question 4 — how conflicts between members are prevented

Layered, cheapest first:
1. **Separate files where possible** — own folders, one question per file (today's rule, unchanged).
2. **Small edits** — an ingest appends a claim line or strikes one; it never rewrites a page. Git merges different
   lines of one page by itself.
3. **The two files every ingest touches never conflict.** `knowledge/log.md` and `knowledge/index.md` carry
   `merge=union` in `.gitattributes` (git's built-in driver: both sides' lines are kept, no stop); the index is then
   regenerated by `sync.js` after every pull, which removes whatever the union left.
4. **A real conflict never leaves a half state.** When the pull before a push hits the same lines another member just
   changed, `sync.js` aborts the rebase, names the files, keeps the member's commit, and exits 4.
   `node tools/sync.js --redo` then puts the clone on the remote's state, keeps a backup branch, brings back the
   member's own files (their folder, their inbox and question files), drops only their `knowledge/` edits, and prints
   the notes whose ingest must be re-applied — onto the fresh page, by the assistant, from the untouched raw note.
   The record is re-derived, never hand-merged.
5. **Meaning conflicts** (two members, two values) are not git conflicts and are never resolved by whoever pushes
   second: §5.2 step 3 — the measurement speaks, otherwise a question to the other member.
6. **The company assistant serialises its own work** — one job at a time, each starting from a fresh pull.
7. **Doctor watches.** A member commit that changes `knowledge/` without a log entry in the same commit is flagged.

## 7. Question 5 — migration from today's shared memory

Per memory, in order, each step reversible:
1. **Refresh** the memory's tools and AGENTS.md (`scaffold.js --refresh-memory`) from a Joserah that carries this work.
2. **The sweeper finishes the last sweep** — the inbox empty, `lastSweep` stamped — so no half-merged notes cross over.
3. **`node tools/ingest.js init`** (the sweeper): sets `recording: continuous` in `.memory/config.json`, adds the
   `merge=union` lines, creates `knowledge/log.md` with one `migrate` entry, generates the index block. One commit,
   pushed with the notice.
4. **Members pull**; their next session reads `RECORDING.md` (AGENTS.md points at it when the config says
   continuous). Nothing in `members/` moves; old notes are not re-ingested.
5. **The company assistant** (separately, decision D2): its workspace joins the memory; facts about the company that
   live only in its own knowledge are ingested into the memory one page at a time, each with its log entry; its own
   workspace keeps only what belongs to the server (vault, job logs, runbooks for itself).
6. **Members opt in to the assistant** at their next setup or join (§3).

**Rollback:** set `recording` back to `sweep` — the log, the index block and the union lines are harmless to the
old tools; nothing is deleted.

## 8. Prototype on this branch

Built where the design is clear and independent of the open decisions — the recording half, all Node built-ins,
working without Joserah:
- `templates/memory/tools/ingest.js` — `init`, `index`, `log`, `check` (§5.3, §7.3).
- `templates/memory/tools/sync.js` — in continuous mode: stages `knowledge/`, regenerates the index, runs the gate
  before the notice; on a conflicting pull aborts the rebase (exit 4) — in every mode, so no clone is left mid-rebase;
  `--redo` (§6.4).
- `templates/memory/tools/sweep-due.js` — continuous mode reports inbox notes waiting for ingest instead of a sweep.
- `templates/memory/RECORDING.md` — the member's rules for continuous recording; AGENTS.md points at it.
- `tools/lib/memory.js` — `--kind memory --recording continuous`; `--refresh-memory` carries `RECORDING.md`; doctor
  accepts a member's `knowledge/` edit when the same commit adds a log entry.

Not built (depends on §9): the job gate, the server side, the setup question, the `assistant` config entry.

## 9. Open owner decisions

**D1 — Who writes `knowledge/` at write time?**
(A) each member's assistant, in the member's own commit, behind the gate; the inbox stays for members without one.
(B) only the company assistant: members push notes, it ingests them as jobs (author = member).
(C) the member chooses per note.
*Recommendation: A.* The writer has the context, it works when the server is down or absent ("hosting is
experimental"), and the gate plus `--redo` keep it safe. B is A's fallback for the inbox, so nothing is lost.

**D2 — Where does the company assistant live?**
(A) its own Joserah workspace on the server, joined to the memory as member `ctrl`.
(B) it runs inside the memory clone itself; the memory is its whole home.
*Recommendation: A.* It reuses join as it is, keeps server-only state (vault, job logs) out of the shared repo, and
lets the company assistant be one member among others. Needs each member's commit address in `members` (today only
names) for §4.5.

**D3 — What runs the jobs on the server?**
(A) the platform server's job runner, behind the ssh gate.
(B) a small stand-alone queue script now, replaced later.
(C) plain `ssh host claude -p "…"` with no gate — rejected: no identity, no serialising, a shell on the server.
*Recommendation: A*, once the platform server runs on the company server; B only if the shared assistant must work
before that.

**D4 — May a member's job change a live system through the company assistant?**
(A) not in v1: ask and ingest only; actions stay with the person.
(B) yes, as plan-then-confirm: the job returns a plan, a second job with the member's yes carries it out.
*Recommendation: A.* Standing rule 2 needs a human yes per change, and the job channel has no screen to show it on yet.

**D5 — The raw note after ingest:** (A) kept forever in `members/<me>/notes/` (Karpathy's immutable raw); (B) deleted
like an inbox note today. *Recommendation: A* — it is what `--redo` re-derives from and what a claim's `source:` points at.

**D6 — Which Claude account runs the company assistant's jobs, for several people?** Not a design choice but a
licence check: before it is switched on, the company's plan terms for one account doing work several employees ask
for must be read — not verified here (server design decision 3 rests on each user's own login).

## 10. Risks and limits

- `merge=union` keeps both sides line by line; for the log that is the point, for the index the regeneration after the
  pull cleans it. Any other file must never get it.
- The gate proves claims were carried and nothing was silent; it cannot prove a page *means* the same as its note — the
  steward's changed-set LLM lint is the second line.
- A member who edits `knowledge/` without Joserah and without the tools is refused by nothing on the remote (GitHub has
  no pre-receive hook here); doctor's check (§6.7) and the steward's lint catch it after the fact.
