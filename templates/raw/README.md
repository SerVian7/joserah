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

The one thing that writes here is `/joserah:import`, copying the owner's own sources in verbatim.
