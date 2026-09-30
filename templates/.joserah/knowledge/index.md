# knowledge/

Splits synthesis from source so the knowledge base never cites itself.

## imports/

**Immutable source material** lives at the **workspace root**, not here — see
`../../imports/README.md`. Drop PDFs, papers, screenshots, articles, exports there. The owner fills
it; the assistant reads it and never edits it (AGENTS.md rule 4). `/joserah:import` copies sources in
verbatim. It sits outside `.joserah/` on purpose, so the repository backup never carries it.

## wiki/

**AI-maintained synthesis.** Entity, concept and topic pages. Every wiki page
cites its sources: an `imports/` file by relative path, or the owner and the date for what they said. When a page goes stale,
regenerate it from `imports/` rather than editing it in place across many
sessions — that is how a knowledge base rots.

## Which one

- "Keep this article" → `imports/` at the workspace root
- "Write me a synthesis of X from what we have" → `wiki/`
- Loose personal notes → `desk/inbox/` or `desk/daily/`
