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

**The scripts themselves do not belong here, and the data does not belong with them.** Scripts
live in `.joserah/tools/`, which is backed up along with the rest of `.joserah/` — so the code
survives a restore even though the data it chews on does not. Keep that folder scripts only and
tidy, grouped into subfolders once there are more than a handful: never a spreadsheet, a binary, an
archive or a generated document. Those belong here.

If a rebuild must ever be reproducible from the repository alone, the inputs it needs have to live
somewhere other than this folder. That is a deliberate decision to make in advance, not something
to discover after a restore.

`/joserah:import` also writes here, copying the owner's own sources in verbatim.
