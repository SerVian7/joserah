# knowledge/

A two-zone split that prevents the knowledge base from citing itself.

## raw/

**Immutable source material.** Drop PDFs, papers, screenshots, articles,
exports. The owner writes here; the AI reads. The only sanctioned AI writer is
`/joserah:import`, which copies your own sources in verbatim.

## wiki/

**AI-maintained synthesis.** Entity, concept and topic pages. Every wiki page
cites at least one `raw/` source by relative path. When a page goes stale,
regenerate it from `raw/` rather than editing it in place across many
sessions — that is how a knowledge base rots.

## Which one

- "Keep this article" → `raw/`
- "Write me a synthesis of X from what we have" → `wiki/`
- Loose personal notes → `desk/inbox/` or `desk/daily/`
