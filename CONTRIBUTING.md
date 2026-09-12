# Contributing

Improvements to the structure are welcome — better templates, clearer routines,
a skill that earns its place, support for a tool we have not thought about.

## The one hard rule

**No personal data, ever.** Not yours, not an example person's, not a
"realistic" sample. Everything in this repository is a blank template or a
mechanism. If a contribution contains a real name, a real company, a real
credential, a real file path from your machine, or the contents of your own
workspace, it will be closed rather than edited down.

Placeholders are `{{UPPER_SNAKE}}`. Use them.

## How

1. Fork, or ask for a branch.
2. Branch from `main`, one topic per branch.
3. Before opening a pull request, run:
   - `node tools/scaffold.js --target /tmp/check --owner "A B" --workspace Check --language English --role ""`
   - `node tools/doctor.js /tmp/check` — must exit 0
   - `grep -rn "{{" templates/` — only the five documented placeholders may appear

   (These commands assume Git Bash — on Windows run them there, not in
   PowerShell, where `/tmp` and `grep` do not exist.)
4. Say in the pull request what changed and what you ran.

## What we are careful about

- Skills keep trigger-shaped descriptions ("Use when …"), never workflow
  summaries — an agent that reads the description instead of the skill will
  follow the description.
- Hooks are a **single `command` string** with `"shell": "bash"`. There is no
  exec form — Claude Code has no `args` field, and it runs every hook command
  through a shell. Quote the script path
  (`node "${CLAUDE_PLUGIN_ROOT}/hooks/x.js"`) and keep `shell` set to `bash`,
  so `${CLAUDE_PLUGIN_ROOT}` expands the same way everywhere; in PowerShell
  that syntax means something else entirely.
- Nothing writes into `imports/` at the workspace root except the import skill,
  and only ever verbatim copies of the owner's own material. It lives outside
  `.joserah/`, gitignored, so a repository backup never carries it (the zip
  route still does).
- Every skill declares `name` in its frontmatter; installed plugin paths carry
  the version and change on upgrade.

## Changing the prompt

`templates/AGENTS.md` is versioned apart from the plugin. Every change to its
text **must** bump the `<!-- joserah:prompt-version N -->` line on line 1 —
that number is the only thing a workspace compares against, so a change
without a bump reaches no existing workspace (doctor reports it as
`prompt source drift`). The plugin's own version bumps only when code changes:
hooks, tools, skills, other templates. Run `node --test tests/*.test.js`
before every release.

## Releasing

The plugin's version lives in three hand-written places and they must agree:

- `.claude-plugin/plugin.json` → `version`
- `.claude-plugin/marketplace.json` → `metadata.version`
- `.claude-plugin/marketplace.json` → `plugins[0].version`

To cut a release: change all three to the new number, add a
`### Upgrading to <version>` section to `README.md` saying what changed for
someone who already has a workspace, then run `node --test tests/*.test.js`.
`tests/version.test.js` fails if the three disagree, and fails if the release
note for the current number is missing — three numbers that were all forgotten
together agree with each other perfectly, so the note is the part that cannot
be satisfied by copying.

The prompt's version (`templates/AGENTS.md`, line 1) is separate and bumps only
when that file's text changes; see above. A release that changes only the
prompt reaches workspaces through `/joserah:update`; one that changes code
needs a plugin update.
