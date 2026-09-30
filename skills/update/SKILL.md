---
name: update
description: Use when Joserah or its standing instructions should be brought current: the owner asks to update Joserah, the briefing carries an `[update]` line, or doctor reports the prompt behind or hand-edited. Not for tidying notes, which is `sweep`.
---

# Update a workspace

Two things update on different schedules, and the owner should never have to know which is which:

- **The standing instructions** (`AGENTS.md`, `JOSERAH-ROLE.md` and the workspace's copies of the
  plugin tools) come from the plugin's checkout and take effect in a **new conversation**. No
  restart. `directives.md` and `.joserah/agent.md` are the owner's: created once if missing, never
  rewritten.
- **The plugin's code** (hooks, tools, skills) is a git checkout linked into `~/.claude/skills/`
  and loaded in place. Step 1 pulls it; `/reload-plugins` loads it. This skill is the only way
  Joserah updates itself.

> Plugin tools: if `${CLAUDE_PLUGIN_ROOT}` is empty (PowerShell), resolve it as in `/joserah:doctor`, "Running the plugin's tools".

## 1. Pull the checkout

The checkout is `${CLAUDE_PLUGIN_ROOT}` with the link resolved — its realpath:

```
node -p "require('fs').realpathSync(process.argv[1])" "${CLAUDE_PLUGIN_ROOT}"
git -C "<checkout>" pull --ff-only
git -C "<checkout>" diff --name-only ORIG_HEAD HEAD
```

If the pull fails (offline, local commits), say so in one line and continue on the code as it is.
If `<checkout>` has no `.git`, this is not the linked install: doctor's
`plugin loaded from the skills dir` line says what to move, and the steps below still bring the
workspace current.

## 2. See what is behind

```
node "${CLAUDE_PLUGIN_ROOT}/tools/check-update.js" <workspace-root>
```

- `prompt.behind` true → the standing instructions are behind. Fixed below, no restart.
- `behind` true → this workspace was built by an older plugin than the one installed: `migrate.js`
  below brings it up.
- `null` anywhere → could not tell; say nothing about that one and do not retry.

## 3. Migrate

```
node "${CLAUDE_PLUGIN_ROOT}/tools/migrate.js" <workspace-root> --dry-run
```

Show the owner the counts in plain words — notes that gain frontmatter, files that will be created
(`created`: `directives.md`, `JOSERAH-ROLE.md`, `.joserah/agent.md`, `AGENTS.md`, `CLAUDE.md`), files
refused (`skipped` — an owner-written `CLAUDE.md` is never rewritten; doctor names the lines it lacks) —
and what `prompt` says. On yes, run it again without `--dry-run`. Migrate is
additive and idempotent: it never edits prose and never touches an existing `directives.md`.

Once per workspace (below 0.15.0) it also imports an old vault it finds in `keys/` — `vault` in the report: say the counts, and name any file under `vault.kept` (a conflict) or `vault.needsPrefix` (a record array that needs `--prefix <scope>`) as one the owner resolves; `vault.notVault` and `vault.inUse` were left untouched on purpose — name them in one line. Sources are never moved; imported ones are listed in `config.json` under `vault.imported`. Never open those files.

`prompt.action`:

- `install` / `record` — done; `AGENTS.md` is current and recorded.
- `none` — already current.
- `refused` — the workspace's `AGENTS.md` differs from anything the plugin ever installed
  (hand-edited, or from before prompt versioning). Go to step 4.

## 3b. The structure notes

`migrate.js` does only what someone wrote code for. A release that changes what a workspace should
**look like** — where the source material lives, what a load-bearing number is written as — needs a
sentence saying so, and that sentence is a note in the plugin's own `docs/migrations/`, one file per
such release, named for its version.

Read `migratedTo` in `.joserah/config.json` (when absent, `createdByPluginVersion`). Every note with
a higher version is pending. Take them **oldest first** and do what each says — some steps are a
command, some are a decision that is the owner's to make, and a note says which. Never batch the
decisions into one question at the end: ask each where it arises, in their words.

When every pending note is done, and only then:

```
node -e "const f=require('fs'),p=process.argv[1],{stampKey}=require(process.argv[2]);const r=stampKey(f.readFileSync(p,'utf8'),'migratedTo',process.argv[3]);if(r.changed)f.writeFileSync(p,r.text);" "<workspace-root>/.joserah/config.json" "${CLAUDE_PLUGIN_ROOT}/tools/lib/config-stamp.js" "<installed-version>"
```

A note the owner declined is still not done: leave the stamp where it is, say which note is open and
why, and let doctor keep asking. A stamp that runs ahead of the work is how a workspace reports itself
current while sitting a release behind.

## 4. The prompt, when migrate refused

Do not overwrite. Show the owner what differs:

```
git -C <workspace-root> diff --no-index -- AGENTS.md "${CLAUDE_PLUGIN_ROOT}/templates/AGENTS.md"
```

(or read both files). Ask which of *their* lines should survive; move those into
`.joserah/directives.md` — the file that overrides `AGENTS.md` and survives every update. Then,
on their yes only:

```
node "${CLAUDE_PLUGIN_ROOT}/tools/refresh-prompt.js" <workspace-root> --force
```

The displaced text is kept beside the file as `AGENTS.md.replaced-<date>`. Delete it only when the
owner says so.

## 5. The other plugin-owned files

Run doctor and act on these lines only:

- `local verify-links.js current` or `local secret.js current` FAIL → run
  `node "${CLAUDE_PLUGIN_ROOT}/tools/migrate.js" <workspace-root>`. It copies all three files the
  workspace keeps its own copy of — `tools/verify-links.js`, `tools/lib/untouchable.js` and
  `tools/secret.js` — and touches nothing else. Copying by hand works too, but all three have to
  travel: the link checker requires the library, and doctor compares each one separately.
- `exists: JOSERAH-ROLE.md` FAIL with "does not match the role template" → delete it and run
  `migrate.js` again; it reinstalls the right one for the workspace's `kind`.

## 5b. Shared memories

After migrate, for every entry under `shared` in `.joserah/config.json`, refresh that memory's own
rules and tools from this plugin's templates (a memory works without Joserah, so its copy is renewed
by whichever member updates first):

```
node "${CLAUDE_PLUGIN_ROOT}/tools/scaffold.js" --refresh-memory <workspace-root>/<entry path>
```

It prints the files it changed, or `up to date`, and never touches `knowledge/`, `members/`,
`inbox/`, `questions/`, `.memory/` or `.brand/`. When files changed, run `node tools/sync.js --push`
inside that memory and show the owner its push notice as always; on their yes, run it again with `--yes`.

## 6. Verify and report

```
node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <workspace-root>
```

Every check `ok` or the update is not done — report what is still red, in the owner's language,
one line each. When it is clean, tell the owner in one or two lines: what changed, and that a
**new conversation** picks up the new instructions. If step 1 pulled anything, ask them to run
`/reload-plugins` — that is enough (owner, 2026-09-30, checked on two machines). Never say
"restart" unless the new version demonstrably is not active after the reload.

**Then say what an update is not.** Nothing here read a single note: this moved the shell, and the
owner's own pages are untouched by design. If doctor's `knowledge sweep` warned — or the workspace
just gained a format its content does not use yet — say so in one line and offer `/joserah:sweep`,
with the warning that the first one on a full workspace is the expensive one. Offer; do not start it.
