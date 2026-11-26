---
name: sweep
description: Use when the owner asks to tidy, consolidate or re-check their notes, a burst of imports has landed, or the briefing carries a `[sweep]` line or doctor reports the sweep overdue. Not for updating Joserah itself, which is `update`.
---

# Sweep the knowledge base

`update` brings the **shell** current — the standing text, the folder layout, the tooling. It
never reads a note; its own rule is that it does not edit prose. So a workspace can finish an
update knowing the claim format and holding no claims: the format moved on and the content did
not. Closing that gap is this skill's whole job, and it is the only thing here that costs real
money, which is why it is never folded into `update`.

Two passes over the same pages, in one reading — tidying them and harvesting their claims open
the same files, and opening them twice is paying twice. A third pass, the records (§2a), rides on the
same reading.

**When it is offered.** A sweep is due a week after the last one, or once five days of journal have
piled up since it, whichever comes first (never swept: counted from the day the workspace was
created). Doctor then warns `knowledge sweep`, and the session briefing carries one `[sweep]`
line, in the owner's language, at most once a day: "Süpürme vakti: 9 gün, 6 günlük not birikti —
istersen başlatayım." Say it once, offer the sweep, and do not start it unasked.

## 1. Decide the scope before anything else

What the sweep reads is a list, and the list is by content, never by date: the notes and records
(knowledge, personal, the journal, the inbox, tasks) whose words differ from the sweep's own ledger,
`.joserah/desk/sweep-ledger.json`, or that are new. Crew logs, artifacts and job files are never in it.
A date cannot say this: a sweep's own commit lands after its own stamp, uncommitted work is counted
every time, and a count gives no list. Nothing outside the list is opened unless a search hit points
into it.

> Plugin tools: if `${CLAUDE_PLUGIN_ROOT}` is empty (PowerShell), resolve it as in `/joserah:doctor`, "Running the plugin's tools".

```
node "${CLAUDE_PLUGIN_ROOT}/tools/sweep-scope.js" <workspace-root> list
```

- **A ledger exists** → the list is the scope. This is the normal case and it is small. Say how many
  files it holds and go.
- **No ledger** → the first sweep with this tool; seed it once, from the last sweep. A missing
  ledger is not evidence that nothing was ever done: **a missing stamp is not evidence either.** This
  work predates the skill: a workspace may have been tidied by hand, or had its numbers harvested by
  a one-off job, and nothing stamped anything. Read `lastSweep` from `.joserah/config.json`, then:
  - **`lastSweep` present, workspace is a git repository** → find the sweep's own commit: the first
    commit made after the stamp (`git log --since=<lastSweep-ISO> --reverse --format="%h %cI" -n 1`).
    If it was made within ten minutes of the stamp it is the sweep's own: seed from it with
    `list --seed-commit <hash>` and the first list is what changed since. If there is none, or it is
    later, seed from the date: `list --seed-since <lastSweep-ISO>`.
  - **`lastSweep` present, no repository** → `list --seed-since <lastSweep-ISO>` (file times).
  - **`lastSweep` absent or null** → possibly the first sweep, and possibly not. Before quoting a
    page count, look:
    - **The pages themselves.** A page already carrying claim lines with `source:` under them has
      been harvested. That record IS the evidence; it does not need a stamp to be true. Such a page
      is still tidied and still checked, but its numbers are not re-derived from its prose.
    - **The owner's own record.** Scan the recent journal — `.joserah/desk/daily/<year>/` — for a
      bulk pass: an import, a backfill, a cleanup. If one is there, say the date you found and ask
      whether to treat it as the starting point. If they say yes, that date is the seed
      (`--seed-since`); with none, seed from the oldest date there is.

    Then say what you are about to read, with the page count, and get a yes. A first sweep on a full
    workspace is hours of delegated work; a delta is minutes. Nothing but this step separates them,
    and getting it wrong spends the owner's money re-deriving what is already written down.

  The seed is read once: the list it gives is the first run's scope, and the ledger keeps what was
  seen, so the next list is small. Once there is a ledger, a seed is ignored.

## 2. The pass, per page

**Tidy** — link sections to one shape; duplicate entries merged; a missing page link written or
removed, never left dangling; a line whose fact has moved on corrected **with its date**; folder
indexes regenerated; `.joserah/desk/inbox/captures.md` triaged to real homes; a question nobody
answered moved to the queue rather than left mid-page.

**Harvest** — every load-bearing number in that page's prose becomes a claim line
(`- [measurement|calculation|decision|estimate] <subject> -> <value>` plus `condition:` (mandatory for a
measurement) · `date:` · `by:` · `source:`); these four are the only types — never `[fact]`,
`[inventory]` or one of your own. A number whose source cannot be named **does not become a claim** — it becomes
a line in the report, as a question for the owner. Where two pages disagree, both survive: the
measurement speaks, the calculation is struck and `superseded:` points at it.

Three things this pass never does: rewrite the owner's prose into its own words, delete a line
that carries a fact, or **write anything under `imports/`** — no edit, no rename, no tidy-up, no
"corrected" copy. **Reading it is required**, not merely permitted: §4 asks you to open the source a
claim cites and see the figure inside it, and a claim that was never checked against its source is
the thing this whole pass exists to stop.

## 2a. The records pass

A record is a page of its own for something with a name — a person, an animal, a machine, a place, a
project, anything else. There is **no list of kinds**: nothing is sorted into one, and nothing a record
says depends on one. Anything that needs a record of its own gets one, and a record is split further as
what is known about a part of it grows. Two folders hold records, because they are the two the core's
names index reads (a record anywhere else is not found by name): people in `.joserah/knowledge/people/`,
anything else in `.joserah/knowledge/wiki/entities/`, a new file named in English kebab-case.

**The head** is the page's frontmatter (the workspace's conventions, "Record heads"): `title` the name;
`type` as the page has it (`person`, `entity`); `aliases: [a, b]` every other name it goes by —
nicknames, spellings, the name in another language — on one line in brackets (a name with a comma in it
cannot be carried); `about:` one sentence of what it is to the owner, in his language; `kind:` optional,
one or two words taken from the page's own words, **never from a list**. Every other key stays byte for
byte. A name is written only where a line of the notes says it; none comes from your own knowledge.

**The names list.** One search over the head lines of both folders — `title`, `aliases`, `about` — and,
for a page with no head, its first heading (the search tool, not a page opened per record; skip the
folders' `README.md` and `index.md`). That is the list every name below is matched against.
**Once, on the run that was seeded:** open the head and first lines of every people and entity page,
because no record but one carries its names yet; fill `aliases` and `about` only where the page itself
says them (a line such as "Goes by **Sam**." is the line "Sam" stands on). Pages that do not
say are left as they are.

Then, over the listed notes and the records that moved:

1. **A name with no record.** A thing with a name of its own and at least one fact of its own in the
   owner's notes: where the notes themselves say what it is, write its record — the head, that sentence
   and what the lines say, nothing more, and `source:` the file and line it stands on. Where they do not
   say, the name goes on the one list for the owner ("Bunlar kim, ne?") and nothing is written. A single
   unclear mention is never a record. A confident wrong record is worse than a missing one.
2. **A new name for something that has a record** — a line says they are the same thing: add it to
   `aliases` and note the line. A short form that more than one record could take is put on none of them
   (three machines can be called by one short name): it goes on the list for the owner.
3. **Two records that are one thing:** listed for the owner, never merged.
4. **A page with no head** gets one, as above.
5. **A line the chat wrote** (it ends `(<who>, <date time>, chat)`) is put in its section of the record,
   and a number in it becomes a claim line as in §2.
6. **Splitting.** A record is split when a named part of it has facts of its own: the part has a name
   of its own and at least four lines about it alone (a section, or a run of lines). The lines move, byte
   for byte, into a new record in `.joserah/knowledge/wiki/entities/` (its head as above, `source:` the
   page they came from); the parent keeps **one link line** where they stood, in the page's own link
   style; the part's names leave the parent's `aliases` and stand on the new record's `aliases` only, so
   a name finds one record. A part with no name of its own, or with fewer lines, **is left**; so is any
   part whose lines are not clearly about it alone. Nothing is forced. Each split is reported with the
   lines it stands on. A split is never undone, and never merged back, by the sweep.

For each subject that moved, its names are searched once across the whole workspace before a line of
its record is judged or struck: a search returns lines, not files, so the rule that every subject is
looked up everywhere and a refuted line is struck in the same pass costs a search, not a reading.

## 3. Delegating it

The reading is wide and shallow — exactly the shape to hand out, and the shape the owner should
not pay top rates for. **Never two agents on one folder**: they write the same files and one
overwrites the other's work.

**Where the run's state lives.** A sweep that spans sessions keeps one file,
`.joserah/desk/sweep-state.md`: the window, the folders done, the folders outstanding, and the
questions collected so far. One file, that path, no other. It is working state, not knowledge — it
is never linked from a page and is never swept itself, and when the run finishes and `lastSweep` is
stamped, **delete it**. It does not belong in the inbox, which is for things the owner has to look at.

**But do not split further than the work needs.** Every agent pays the same fixed opening cost
whatever it is given — learning the claim format, checking its own links, auditing what it wrote —
and that cost is paid per agent, not per page. Eight agents over small folders pay it eight times
for the same reading three would have done. So: group the small folders together and give a folder
its own agent only when it is big enough to be worth one. The few pages at the workspace root are
the exception in the other direction — they decide how every session opens, so read those yourself
rather than handing them out.

Effort follows the **tightest remaining quota** rather than the size of the folder. Each agent
writes its report as its pages finish, not at the end, so an agent that runs out mid-folder still
hands over: what is done · what is left · the single next page.

The records pass (§2a) crosses folders — it reads the names of every page and writes records and
heads beside the pages the folder workers write — so it is one worker's, started only after the
folder workers have handed over, never beside them. Every worker's report ends with the files it
wrote or created, one path per line: the finish needs that list.

Where the session cannot dispatch, the sweep still runs — inline, one folder at a time, and the
owner is told it will take longer.

## 4. Checking what comes back — deleted lines first

**Read the removed lines in the diff before the added ones** (see orchestrate, "Checking what
comes back").

```
git -C <workspace-root> diff --stat
git -C <workspace-root> diff -- <file>
```

**A page that got shorter is not the same as a page that lost something.** Merging duplicates is
this pass's own job and it shortens pages by design, so size is the wrong question. The question is
whether **every fact it removed exists at the place it was moved to** — open that place and see it
there (a line a split moved stands in the new record, and counts there). A page that removed a fact which is now nowhere is restored from the previous version and
re-run, not patched. Spot-check the numbers too: open the source a claim cites and see the figure
inside it. A claim citing a file that merely exists is worse than no claim, because it looks checked.

## 5. Finish

In this order, and the sweep is not done until all three pass:

```
node .joserah/tools/verify-links.js
node "${CLAUDE_PLUGIN_ROOT}/tools/check-claims.js" <workspace-root>
node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <workspace-root>
```

Then settle the ledger, with every file the sweep wrote or created (the workers' lists), so those
never come back and what anyone else changed meanwhile does:

```
node "${CLAUDE_PLUGIN_ROOT}/tools/sweep-scope.js" <workspace-root> stamp --wrote <path> <path> ...
```

Then stamp the run, so the due rule and doctor know when it was done:

```
node -e "const f=require('fs'),p=process.argv[1],{stampKey}=require(process.argv[2]);const r=stampKey(f.readFileSync(p,'utf8'),'lastSweep',new Date().toISOString());if(r.changed)f.writeFileSync(p,r.text);" "<workspace-root>/.joserah/config.json" "${CLAUDE_PLUGIN_ROOT}/tools/lib/config-stamp.js"
```

Stamp, ledger and date, **only after** the checks are clean. A stamp on a half-finished sweep silently narrows the
next one to a window that never covered the damage.

**Tool proposals.** From the R&D records and journal merged in this sweep, list tool proposals in
`.joserah/desk/tools-proposed.md` — one line each: system, what it would do, which records back it.
**Record first, script later**: a proposal becomes a script only on the owner's yes.

## 6. What the owner is told

Three numbers, the cost and one list, in their language, in a few lines:

- files read — the list's size, and whether it came from the ledger or from a seed (which);
- claims added, and how many were spot-checked against their sources;
- pages restored because a fact they removed turned out to be nowhere else;
- **records written**, each with the line it stands on; **names added** to a record, each with its
  line; **splits**, each with the lines it moved and where they stand now;
- **what the run cost** — the agents used and at what effort. The credit figure itself comes from
  the owner's own client, not from here: report what was spent on, say where the number is, and
  never invent one.
- the questions the sweep could not answer, one list: numbers with no source, contradictions with no
  measurement to settle them, pages whose subject nobody could name, names nothing explains ("Bunlar
  kim, ne?"), short forms several records could take, and records that look like one thing. Nothing
  is written for these.

That last list is the point of the whole exercise. A sweep that reports only "clean" and leaves
its questions in a file has not reported anything.

## 7. Shared memory sweep

When the sweep is a shared memory's (the sweeper merging `inbox/` into `knowledge/`), one more thing
is derived at every sweep: **tool proposals**. From the R&D records merged in the run, list the
procedures recorded and verified more than once, or run by hand repeatedly, in `desk/tools-proposed.md`
— one line each: system, what it would do, which records back it. **Record first, script later**:
assistants never write a script on their own; verified findings enter as records, and a final sweep
compiles the accepted proposals into `tools/<system>/`, only where the sweeper and the member who
verified the procedure agree. The sweep that does it notes the decision in the record.
