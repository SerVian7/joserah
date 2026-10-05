# Trail — design

**Status:** design, not built; the name "Trail" is provisional (open question 1).
**Source:** Serkan (owner, developer of Joserah), in chat, 2026-10-05: "her işin akışı kalıbı olmalıydı.
Yeniler eklenir, eskiler de görünür. eski verileri güncellemene gerek yok … mail geldi mail gitti, şu
sunuldu vs. … Kalıplar baştan kodlanmamalı. toollar ile fill edilmeli. Yani yapılar tek olmalı."
Standing rule behind it: workspace learned.md, 2026-10-05 "Page structures are built once and filled by tools".
**Read for this design:** `skills/orchestrate/SKILL.md` (Working structures, Trackers, Decision pages),
`tools/tracker.js` (header, init, render, exports), `tools/case.js`, `templates/tracker/index.html` (token
block), the workspace's Daily Tracker `upd.js`. **Not read:** `templates/case/client.js` beyond its image
line, `templates/changelog`, any existing hand-written Decision flow page.

## Goal

One page per Case that shows the work's whole course as a timeline of typed entries — mail in, mail out,
offer, options presented, decision, reply drafted, note, waiting. New entries are appended; old ones stay
visible and are never rewritten. It replaces the Decision flow **for new work only**; existing Decision
flow pages are left as they are.

Built once: a fixed template plus `tools/trail.js`, which validates one typed entry from JSON, appends it
and re-renders. No HTML is written per page, so adding "a selection with a photo" costs one small JSON
object, not a page edit.

## Entry types

Every entry has `id` (`e1`, `e2`… assigned by the tool), `type`, `time` (ISO with offset, stamped by the
tool), `title` (one line, required) and may have `links` [{label, url}] (http(s) only), `resolves` [ids]
and `supersedes` id.

| type | Required | Optional | Renders as |
|---|---|---|---|
| `mail-in` | `from` | `subject`, `summary`, `attachments` [file] | sender · subject, summary line, thread link |
| `mail-out` | `to` | `subject`, `summary`, `text` | recipients · subject; sent text in a closed expandable |
| `offer` | `from` | `item`, `price`, `currency`, `validUntil`, `image`, `note` | vendor, item, price (or "price missing"), thumbnail |
| `options` | `items` [{title, status ok\|wait\|no, price?, image?, note?, links?}] | `rec` (item index), `research` (Case research url) | a strip of items, thumbnail + title + price + status tag; the recommended one marked "Recommendation" |
| `decision` | `choice` | `ref` (options/offer id), `why`, `by` | the chosen item large (image, title, price, link), "SELECTED" tag |
| `draft` | `to`, `text` | `subject`, `ref` (mail-in id) | text in a plain box with a Copy button; becomes "sent" when a later `mail-out` resolves it |
| `note` | — | `text` | one line, text in an expandable if long |
| `waiting` | `on` | `what` | an open item until a later entry lists it in `resolves` |

Append-only rules: an entry is never edited. A wrong entry is answered by a new one with `supersedes`; the
old one renders struck through (the same convention as claim lines). A `waiting` or `draft` is closed only
by a later entry's `resolves`. Mail bodies are summarised; a full mail text appears only in `mail-out.text`
and `draft.text` (the owner's own words). No secret ever goes into an entry (the tool runs the existing
secret scan pattern over the JSON and refuses a hit).

## Data file

One `trail.json` per Trail, beside `index.html`:

```json
{ "kind": "trail", "version": 1, "title": "…", "lang": "tr",
  "research": "https://…", "brand": { "logo": "logo.png" },
  "entries": [ { "id": "e1", "type": "mail-in", "time": "2026-10-05T10:12:00+03:00", "title": "…", "from": "…" } ] }
```

Entries are stored in append order (oldest first) so an append never moves anything; display order is the
renderer's job. Images live in `img/` beside the page (`img/e7-1.jpg`), referenced by relative path, never
embedded. A Trail lives in its Case's folder, not a dated one, because a Case spans days:
`.joserah/desk/artifacts/cases/<case-slug>/trail/`.

## CLI

```
node tools/trail.js new <dir> --title "<Case>" [--lang en|tr] [--logo f] [--research <url>] [--force]
node tools/trail.js add <dir> --type <type> (--file entry.json | --json '<obj>' | stdin)
node tools/trail.js render <dir>
node tools/trail.js types
```

- `add` validates against the type table, assigns `id` and `time`, copies every local image path in the
  object into `img/` and rewrites it to the relative name, appends, renders. It prints
  `entry: e7`, `files: img/e7-1.jpg …` (what must be published with the page) and a suggested Tracker line
  `small: "<type label>: <title> · next: <oldest open waiting>"`. Refuses, exit 1, on an unknown type, a
  missing required field, an unknown `ref`/`resolves`/`supersedes` id, a non-http link, a missing image.
- `--file` / stdin is the normal path; `--json` exists for short entries (Windows quoting makes it awkward).
- `types` prints the type table, so a worker filling a Trail need not open this spec.

**Shape choice — input format.** (a) One flag per field: no JSON to write, but each type's fields become
flags and `parseArgs` grows with every new type. (b) One JSON object per entry: one validator, new types cost
a table row. **Pick (b).**

## Ordering

**Newest on top**, with one pinned "Open" block above the list holding every unresolved `waiting` and
unsent `draft`. Why: the owner opens the page to see what changed; every other Joserah page already reads
latest-first (Tracker done rows, Case research update and groups); the open block keeps the next step
visible however long the Trail grows. Long lists use the Tracker's clamp (first rows, fade, open in place).
Entries group under day headings (DD.MM); only past days fold, one open at a time.
The alternative — story order, newest at the bottom — reads like a roadmap but makes the owner scroll to the
end on every visit (open question 2).

## Selection with a photo

An `options` entry shows its items side by side (square thumbnail, no radius, no shadow; title; price or
"price missing"; status tag; link). A later `decision` with `ref` to it renders the chosen item at full width
under the decision line — image, title, price, link, "SELECTED" — and marks that item "SELECTED" in the
options strip too (computed at render, the options entry itself is not changed). A decision without `ref`
renders its own `choice`/`image`. An option goes into a `decision` only on the owner's word (unchanged rule).

## Theme

The Theme today is the token block in `templates/tracker/index.html` (light, dark, `data-theme`) plus
`CONSOLE_CSS` in `tracker.js`, whose selectors are Tracker-specific.

| Option | Cost |
|---|---|
| A. Move tokens and base console rules into `tools/lib/theme.js`; `tracker.js` and `trail.js` both inject it on render (the Tracker already re-injects its CSS each render) | touches `tracker.js`, its template and tests once; one source for every later template (`case`, `changelog`) |
| B. Copy the token block into the Trail template | a fork — two places to change; rejected by the brief |
| C. `trail.js` reads the token block out of the Tracker template by regex | no Tracker change, but couples to another template's text |

**Pick A**, as the first build step, with the Tracker suite green before Trail work starts.

## Tracker link

A Trail is published once and keeps its URL. Its Daily Tracker row carries `--url <trail url> --label
"Trail"` and the `small` line `add` suggests. `trail.js` never writes the Tracker: the Tracker belongs to the
main session (directives, 2026-10-05), so the tool only prints the line. An open `waiting` makes the row
`wait`; an options entry awaiting the owner makes it `you`, linked to the Trail.

## Skills text changes

- `skills/orchestrate/SKILL.md` frontmatter description: "a Case research or a Decision flow" → "a Case
  research or a Trail".
- Working structures table: add **Trail** ("the page holding a Case's course: every mail, offer, option,
  decision and draft, in order, appended and never rewritten"); Decision flow row gets "older pages only;
  new work uses a Trail".
- Decision pages: "decided on two linked pages: its Case research and its Trail"; add the `trail.js` build
  line; "An option moves from the research to the flow" → "to the Trail".
- Trackers: "links to the page where it is made (Case research, Trail, a report)"; Crew table Scout row.
- `templates/AGENTS.md` §5 orchestrate row and its names list: Decision flow → Trail.
- CHANGELOG entry; the plugin version bump follows the release rules.

## Test plan

`tests/trail.test.js`, written first, run with `node --test tests/*.test.js`, clock fixed by `JOSERAH_NOW`:

1. `new` writes `trail.json` and `index.html`; refuses an existing one without `--force`.
2. `add` per type: required field missing → exit 1; valid entry → id `eN`, time stamped, page re-rendered.
3. Append-only: a second `add` leaves the earlier entries byte-identical in `trail.json`.
4. Images: a local path is copied to `img/eN-k.ext` and rewritten; a missing file refuses; `files:` lists it.
5. `resolves`/`supersedes`/`ref` to an unknown id refuse; a resolved `waiting` leaves the Open block; a
   superseded entry renders struck.
6. Order: newest entry first, Open block above; past days fold.
7. Decision with `ref`: chosen item rendered large and marked SELECTED in the options strip.
8. Theme: the page carries the shared token block (light, dark, `data-theme`), no `border-radius` other than
   0, no `box-shadow`; Tracker tests still pass after the theme move.
9. Escaping: `<script>` in a title renders as text; `javascript:` links dropped.
10. Secret scan: a token-shaped value in an entry refuses.

## Open questions for the owner

1. **Name** — "Trail", "Akış", or "Roadmap"? Recommended: **Trail** in English structure, labelled "İş
   akışı" on Turkish pages; "Roadmap" suggests a plan of the future, which this is not.
2. **Order** — newest on top with the open items pinned, or story order with the newest at the bottom?
   Recommended: **newest on top**, as every other page reads.
3. **Case research** — keep it as a separate page for full option comparison, with the Trail showing only
   what was presented and chosen, or fold it into the Trail? Recommended: **keep it separate**; the Trail's
   `options` entry links to it, so the timeline stays short.
