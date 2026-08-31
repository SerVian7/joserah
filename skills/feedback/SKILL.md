---
name: feedback
description: Use when the assistant notices a shortcoming in its own standing instructions, or in how this Joserah workspace is put together — not for a preference about the owner's own workspace, which belongs in `learn` instead.
---

# Feedback

A note is about **this software** — the assistant's own prompts, or how Joserah itself is
structured — never about the owner's workspace. A workspace-specific preference is a `learn`
entry, never a feedback note. One note is three short sentences and a link, not an investigation.

## What a note is for

Two kinds only:

- `prompt` — the assistant's standing instructions made it behave wrongly.
- `structure` — the way Joserah is built got in the way.

Anything else is not feedback. Say nothing and move on.

A `learned.md` entry marked `Scope: universal` is a new *source* for a `structure` note, not a
third kind: check `.joserah/learned.md` for them — each is a finding the plugin's developer never
saw. Offer to send them, one issue per rule. Quoting the entry's rule and reason verbatim is for
that owner-facing offer only, so they see exactly what is proposed — the note that actually gets
filed still goes through the normal build in [Writing a note](#writing-a-note) below: the same
field-build and `renderFeedbackNote` scrub as any other note. What travels is the shape of the
rule, never the literal Reason text.

## The three modes

Read `feedback.mode` from `config.json`:

- **auto** — write the note and file it, then show the owner the note's full text and the issue
  link. Do not ask first.
- **manual** — mention it once, in one sentence, at a natural pause. If they decline, drop that
  subject for the session and do not raise it again. `/joserah:feedback` always works.
- **off**, or the block absent — do nothing, ever. Do not mention feedback at all.

## Writing a note

Never invent the fields — a note comes from something that actually happened in this session.
Three sentences: what went wrong, what you think caused it, what would fix it.

Nothing real goes in: no names, no companies, no file paths, no quotations, no example taken from
the work. Describe the *shape* of what happened, never the case.

Build the fields and call `renderFeedbackNote(fields, forbidden)`
(`tools/lib/note-format.js`) with the workspace's own words as `forbidden`. It throws rather than
render a note that still carries any of that — when it throws, rewrite the sentence, do not work
around the check. Write the result to `.joserah/feedback/<area>/<date>-<slug>.md`.

In `auto` mode, then run:

```
node "${CLAUDE_PLUGIN_ROOT}/tools/feedback.js" --report <file> --root <root>
```

## After filing

Show the owner the note as it was sent, and the issue link. If it could not be filed (exit `3`),
say so in one line and move on — do not retry, do not ask them to install anything, do not bring
it up later.
