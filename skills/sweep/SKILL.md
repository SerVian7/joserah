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
- **Absent or null** → the first sweep: everything. Say so to the owner **before starting**, with
  the page count, and get a yes. A first sweep on a full workspace is hours of delegated work; a
  weekly one is minutes. They are the same skill and nothing but this line separates them.

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
(`- [measurement|calculation|decision|estimate] <subject> -> <value>` plus `condition:` · `date:` ·
`by:` · `source:`). A number whose source cannot be named **does not become a claim** — it becomes
a line in the report, as a question for the owner. Where two pages disagree, both survive: the
measurement speaks, the calculation is struck and `superseded:` points at it.

Three things this pass never does: rewrite the owner's prose into its own words, delete a line
that carries a fact, or touch anything under `imports/`.

## 3. Delegating it

The reading is wide and shallow — exactly the shape to hand out, and the shape the owner should
not pay top rates for. One agent per folder, never two on the same folder, and effort follows the
**tightest remaining quota** rather than the size of the folder. Each agent writes its report as
its pages finish, not at the end, so an agent that runs out mid-folder still hands over: what is
done · what is left · the single next page.

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

A page whose diff deletes more than it adds is restored from the previous version and re-run, not
patched. Spot-check the numbers too: open the source a claim cites and see the figure inside it. A
claim citing a file that merely exists is worse than no claim, because it looks checked.

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
- pages restored because a delivery deleted more than it added;
- **what the run cost** — the agents used and at what effort. The credit figure itself comes from
  the owner's own client, not from here: report what was spent on, say where the number is, and
  never invent one.
- the questions the sweep could not answer: numbers with no source, contradictions with no
  measurement to settle them, pages whose subject nobody could name.

That last list is the point of the whole exercise. A sweep that reports only "clean" and leaves
its questions in a file has not reported anything.
