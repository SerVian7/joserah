---
name: import
description: Use when the owner wants existing notes, exports or documents brought into the workspace, or asks to import, migrate or ingest old data. Not for a pasted mail or log that is to be read or answered.
---

# Import existing material

Bring a pile of existing data into the workspace without losing any of it and
without inventing anything.

## The rule that governs everything here

**Sources are copied verbatim into `imports/` at the workspace root. Nothing else is.**

`imports/` holds the owner's source material verbatim. The assistant reads it freely and never
edits it. Import is the one skill that writes there, and only byte-for-byte copies. Anything
you *derive* — summaries, extracted tasks, people pages — goes to its proper
home and cites the raw copy by relative path.

## 1. Scope it before touching anything

Ask what they are pointing you at and how big it is. Then look:

```
node -e "const fs=require('fs'),p=require('path');let n=0,b=0;(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())w(f);else{n++;b+=fs.statSync(f).size;}}})(process.argv[1]);console.log(n+' files, '+(b/1048576).toFixed(1)+' MB')" "<source path>"
```

If the source is a single file rather than a directory, skip the listing —
read the one file and continue from step 2 with it.

Report the count and size, and list the file types you found. **If it is more
than a few hundred files, propose doing it in batches by folder or type and
get agreement first.** Do not silently truncate — if you decide to skip
something, say what and why.

## 2. Copy the sources in

Create `imports/<YYYY-MM-DD>-<short-label>/` at the workspace root and copy the
material there unchanged. Preserve the original folder structure. Never edit,
reformat, or rename a source file. Binary formats (PDF, images, office docs)
are copied as-is even when you cannot read them.

For a pasted dump rather than files: save the paste verbatim as
`source.md` in that same folder before doing anything else with it.

## 3. Classify — one pass, reading only what you can read

For each source, decide what it produces and write it to its home:

| What the source contains | Goes to |
|---|---|
| A person you can name, with context | `.joserah/knowledge/people/firstname-lastname.md` |
| An active piece of work with an owner and an end | `projects/{Owner}/{Project}/docs/status.md` — **ask first**, see below |
| A commitment with a date | `.joserah/desk/tasks/next.md` (or `now.md` if it is live) |
| A stated preference about how to work | `.joserah/learned.md` |
| Facts about the owner | `.joserah/personal/profile.md` |
| Reference worth keeping but not actionable | leave in `imports/` at the workspace root, add a `.joserah/knowledge/wiki/` page pointing at it |
| Anything you cannot classify | `.joserah/desk/inbox/captures.md`, one line each |

Every derived file cites its source: `Source: [text](path)`. Write the source
link relative to the file you are writing it into — from
`.joserah/knowledge/people/<name>.md` the raw import is
`../../../imports/<date>/<file>.md`, not `imports/…`. Step 5's link check
is the referee.

### Anything under `projects/` is outside backup

Before writing into `projects/`, say plainly that it is outside every backup, and offer
`.joserah/knowledge/` instead or a git repository for that project. The owner decides.

Merge rather than overwrite. If `.joserah/knowledge/people/ali-veli.md` already exists, add to it
and keep the existing content — never replace a file you did not create in
this run.

## 4. Write the report

`imports/<date>-<label>/REPORT.md`, in the owner's `dialogueLanguage` with English headings. It
stays beside its sources, although `imports/` is outside the repository backup:

```markdown
# Import — <date> — <label>

Source: <original path or "pasted">
Files copied: N (M MB)

## Created
- path — what it holds

## Updated
- path — what was added

## Unclassified
- N items left in .joserah/desk/inbox/captures.md

## Skipped
- what, and why
```

## 5. Verify

Run `node .joserah/tools/verify-links.js` from the workspace root. Every citation you wrote must
resolve; links inside `imports/` are not checked. Then show the owner the report's summary and
ask them to check the unclassified pile.

## Rules

- **Never summarize a source away.** The raw copy always survives.
- **Never invent** a name, date, or fact that is not in the source. If a
  document is unreadable, say so and leave it raw.
- Credentials found in the material: never copy them into markdown. Save each
  at once with `node .joserah/tools/secret.js --set <name>` (value on stdin),
  write only the name into the notes, and tell the owner in one line what was
  saved under which name. The source in `imports/` stays verbatim.
- If the owner asks you to import from a cloud service, that needs an MCP
  connection they set up — say so rather than guessing at file paths.
