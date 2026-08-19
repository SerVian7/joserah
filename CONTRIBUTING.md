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
- Nothing writes into `.joserah/knowledge/raw/` except the import skill, and
  only ever verbatim copies of the owner's own material.
- Every skill declares `name` in its frontmatter; installed plugin paths carry
  the version and change on upgrade.
