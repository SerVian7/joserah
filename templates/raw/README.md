# raw/ — IMMUTABLE

Source material, kept at the **workspace root** — deliberately outside `.joserah/`.

The owner drops PDFs, statements, screenshots, articles and exports here. The AI may read them,
but never edits, rewrites or summarizes them in place. Synthesis goes to
`.joserah/knowledge/wiki/`, and every wiki page cites its `raw/` source by relative path.

**This folder is never part of a repository backup.** It holds originals the owner already has
elsewhere — bank statements, vendor PDFs, firmware — and binaries that must not enter a git
history. Keeping it outside `.joserah/` makes the backup scope safe by construction: the backup
is `.joserah/` plus the root shell files, and nothing else. (A zip export still includes it —
a zip carries binaries without consequence.)

Because it is outside the backup, this is also the **working area**. A tool the owner owns reads
its inputs from here and writes its generated artifacts here — spreadsheets, rendered reports,
exports. What must never happen is the assistant rewriting or summarizing source material in
place; that is the immutability rule, and it is what stops a knowledge base from citing itself.

**The code does not belong here.** It lives in `.joserah/tools/`, which is backed up along with
the rest of `.joserah/` — and so do the small data files it needs to run, each grouped into its
own subfolder there. A tool whose inputs travel with it still works after a restore; a tool whose
inputs are here does not.

What belongs here is the bulk: originals, spreadsheets, generated documents, rendered reports,
delivery sets, anything binary. The dividing line is not "code versus data" — it is whether
something is small enough to carry and needed for the tool to run at all.

So: if a rebuild must be reproducible from the repository alone, keep its inputs in
`.joserah/tools/` beside the code. Deciding that in advance is the whole point; discovering it
after a restore is the failure this split exists to prevent.

`/joserah:import` also writes here, copying the owner's own sources in verbatim.
