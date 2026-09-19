# knowledge/

Splits synthesis from source so the knowledge base never cites itself.

## imports/

**Immutable source material** lives at the **workspace root**, not here — see
`../../imports/README.md`. Drop PDFs, papers, screenshots, articles, exports there. The owner writes
it; the AI reads. The only sanctioned AI writer is `/joserah:import`, which copies your own
sources in verbatim. It sits outside `.joserah/` on purpose: the repository backup covers
`.joserah/` plus the root shell files, so `imports/` is never part of it by construction.

## wiki/

**AI-maintained synthesis.** Entity, concept and topic pages. Every wiki page
cites at least one `imports/` source by relative path. When a page goes stale,
regenerate it from `imports/` rather than editing it in place across many
sessions — that is how a knowledge base rots.

## Which one

- "Keep this article" → `imports/` at the workspace root
- "Write me a synthesis of X from what we have" → `wiki/`
- Loose personal notes → `desk/inbox/` or `desk/daily/`
