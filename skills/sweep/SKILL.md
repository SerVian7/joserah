---
name: sweep
description: Use when the knowledge base itself should be brought current — the owner asks to tidy or consolidate it, a burst of imports has landed, doctor reports the sweep overdue, or a schedule fires. Reads the notes and rewrites their structure; `update` never does.
---

# Sweep the knowledge base

`update` brings the **shell** current — the standing text, the folder layout, the tooling. It
never reads a note; its own rule is that it does not edit prose. So a workspace can finish an
update knowing the claim format and holding no claims: the format moved on and the content did
not. Closing that gap is this skill's whole job, and it is the only thing here that costs real
money, which is why it is never folded into `update`.

Two passes over the same pages, in one reading — tidying them and harvesting their claims open
the same files, and opening them twice is paying twice.

## 1. Decide the scope before anything else

Read `lastSweep` from `.joserah/config.json`.

- **Present** → only what changed since it. This is the normal case and it is small.
- **Absent or null** → possibly the first sweep, and possibly not. **A missing stamp is not
  evidence that nothing was ever done.** This work predates the skill: a workspace may have been
  tidied by hand, or had its numbers harvested by a one-off job, and nothing stamped anything.
  Before quoting a page count, look for that:
  - **The pages themselves.** A page already carrying claim lines with `source:` under them has
    been harvested. That record IS the evidence; it does not need a stamp to be true. Such a page
    is still tidied and still checked, but its numbers are not re-derived from its prose.
  - **The owner's own record.** Scan the recent journal — `.joserah/desk/daily/<year>/` — for a
    bulk pass: an import, a backfill, a cleanup. If one is there, say the date you found and ask
    whether to treat it as the starting point. If they say yes, that date is the window.

  Then say what you are about to read, with the page count, and get a yes. A first sweep on a full
  workspace is hours of delegated work; a delta is minutes. Nothing but this step separates them,
  and getting it wrong spends the owner's money re-deriving what is already written down.

> **Running the plugin's tools.** The commands below use `${CLAUDE_PLUGIN_ROOT}`. That expands in
> bash; in PowerShell it is variable syntax, not an environment lookup, and expands to nothing —
> leaving you running `node "/tools/…"`. Verify before relying on it:
> `node -e "process.exit(require('fs').existsSync(process.argv[1])?0:1)" "<path>"`. If it is empty
> or missing, locate the plugin under the user's Claude plugin cache —
> `~/.claude/plugins/cache/<marketplace>/joserah/<version>/`, on Windows
> `%USERPROFILE%\.claude\plugins\cache\…` — and use that absolute path. A command that failed
> because the path was empty is a failure: say so rather than reporting the step as done.

The changed set comes from the tool the backup skill already uses for the same question:

```
node "${CLAUDE_PLUGIN_ROOT}/tools/backup-scope.js" <workspace-root> --changed-since <lastSweep-ISO>
```

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

Where the session cannot dispatch, the sweep still runs — inline, one folder at a time, and the
owner is told it will take longer.

## 4. Checking what comes back — deleted lines first

**Read the removed lines in the diff before the added ones.** An agent told to add a claim block
overwrites the end of the page while adding it, and the loss is invisible in the added text: this
has happened on every delivery so far, in both directions, to two different agents.

```
git -C <workspace-root> diff --stat
git -C <workspace-root> diff -- <file>
```

**A page that got shorter is not the same as a page that lost something.** Merging duplicates is
this pass's own job and it shortens pages by design, so size is the wrong question. The question is
whether **every fact it removed exists at the place it was moved to** — open that place and see it
there. A page that removed a fact which is now nowhere is restored from the previous version and
re-run, not patched. Spot-check the numbers too: open the source a claim cites and see the figure
inside it. A claim citing a file that merely exists is worse than no claim, because it looks checked.

## 5. Finish

In this order, and the sweep is not done until all four pass:

```
node .joserah/tools/verify-links.js
node "${CLAUDE_PLUGIN_ROOT}/tools/check-claims.js" <workspace-root>
node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <workspace-root>
```

Then stamp the run, so the next sweep knows where to start and doctor stops asking:

```
node -e "const f=require('fs'),p=process.argv[1],{stampKey}=require(process.argv[2]);const r=stampKey(f.readFileSync(p,'utf8'),'lastSweep',new Date().toISOString());if(r.changed)f.writeFileSync(p,r.text);" "<workspace-root>/.joserah/config.json" "${CLAUDE_PLUGIN_ROOT}/tools/lib/config-stamp.js"
```

Stamp **only after** the checks are clean. A stamp on a half-finished sweep silently narrows the
next one to a window that never covered the damage.

## 6. What the owner is told

Four numbers and one list, in their language, in a few lines:

- pages read, and over what window;
- claims added, and how many were spot-checked against their sources;
- pages restored because a fact they removed turned out to be nowhere else;
- **what the run cost** — the agents used and at what effort. The credit figure itself comes from
  the owner's own client, not from here: report what was spent on, say where the number is, and
  never invent one.
- the questions the sweep could not answer: numbers with no source, contradictions with no
  measurement to settle them, pages whose subject nobody could name.

That last list is the point of the whole exercise. A sweep that reports only "clean" and leaves
its questions in a file has not reported anything.
