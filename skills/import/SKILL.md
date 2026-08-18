---
name: import
description: Use when someone has existing notes, exports, documents or a large pasted dump they want brought into their Joserah workspace, or asks to import, migrate, or ingest their old data.
---

# Import existing material

Bring a pile of existing data into the workspace without losing any of it and
without inventing anything.

## The rule that governs everything here

**Sources are copied verbatim into `knowledge/raw/`. Nothing else is.**

`knowledge/raw/` is normally off-limits to the AI, because a knowledge base
that cites its own generated content rots. Import is the one sanctioned
writer, and only for the owner's own source material, byte-for-byte. Anything
you *derive* — summaries, extracted tasks, people pages — goes to its proper
home and cites the raw copy by relative path.

## 1. Scope it before touching anything

Ask what they are pointing you at and how big it is. Then look:

```
node -e "const fs=require('fs'),p=require('path');let n=0,b=0;(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())w(f);else{n++;b+=fs.statSync(f).size;}}})(process.argv[1]);console.log(n+' files, '+(b/1048576).toFixed(1)+' MB')" "<source path>"
```

Report the count and size, and list the file types you found. **If it is more
than a few hundred files, propose doing it in batches by folder or type and
get agreement first.** Do not silently truncate — if you decide to skip
something, say what and why.

## 2. Copy the sources in

Create `knowledge/raw/imports/<YYYY-MM-DD>-<short-label>/` and copy the
material there unchanged. Preserve the original folder structure. Never edit,
reformat, or rename a source file. Binary formats (PDF, images, office docs)
are copied as-is even when you cannot read them.

For a pasted dump rather than files: save the paste verbatim as
`source.md` in that same folder before doing anything else with it.

## 3. Classify — one pass, reading only what you can read

For each source, decide what it produces and write it to its home:

| What the source contains | Goes to |
|---|---|
| A person you can name, with context | `knowledge/people/firstname-lastname.md` |
| An active piece of work with an owner and an end | `projects/{Company}/{Project}/docs/status.md` |
| A commitment with a date | `desk/tasks/next.md` (or `now.md` if it is live) |
| A stated preference about how to work | `.joserah/learned.md` |
| Facts about the owner | `personal/profile.md` |
| Reference worth keeping but not actionable | leave in `raw/`, add a `knowledge/wiki/` page pointing at it |
| Anything you cannot classify | `desk/inbox/captures.md`, one line each |

Every derived file cites its source: `Source: [raw/imports/…/file.md](…)`.

Merge rather than overwrite. If `knowledge/people/ali-veli.md` already exists, add to it
and keep the existing content — never replace a file you did not create in
this run.

## 4. Write the report

`knowledge/raw/imports/<date>-<label>/REPORT.md`. **Write the report in the
owner's dialogue language** (`dialogueLanguage` in `.joserah/config.json`) —
it is written for them to read, not for the repository. Keep the headings in
English so the shape stays consistent across workspaces:

```markdown
# Import — <date> — <label>

Source: <original path or "pasted">
Files copied: N (M MB)

## Created
- path — what it holds

## Updated
- path — what was added

## Unclassified
- N items left in desk/inbox/captures.md

## Skipped
- what, and why
```

## 5. Verify

Run `node .joserah/tools/verify-links.js` from the workspace root — the workspace's own
copy, the same one `doctor.js` uses — every citation you just wrote must
resolve. Then show the owner the report's summary and ask them to check the
unclassified pile.

## Rules

- **Never summarize a source away.** The raw copy always survives.
- **Never invent** a name, date, or fact that is not in the source. If a
  document is unreadable, say so and leave it raw.
- Credentials found in the material: do not copy them into markdown. Tell the
  owner they are in the source and belong in `keys/`.
- If the owner asks you to import from a cloud service, that needs an MCP
  connection they set up — say so rather than guessing at file paths.
