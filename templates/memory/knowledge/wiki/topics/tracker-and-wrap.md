# Tracker and Wrap

How {{COMPANY}}'s status pages are made, by hand or by an assistant. No assistant is needed.

## Tracker

A live status page for a piece of work, kept while the work runs.

- Header: one small line, `<Name> · Tracker · DD.MM.YYYY`. No big heading, no subtitle, no footer, no
  start or elapsed time.
- Rows in three groups, in this order: running and waiting on someone → done → plans. One line per row;
  every row carries a time, written once and kept; a done row shows when it finished.
- A running row says what is awaited: which job, which result, what comes next.
- A row that waits on a decision links to the page where it is made. A link lives in its own row, as a
  short plain label with the address embedded.
- The page itself does not change; only its rows do.

## Wrap

The end-of-day report. Made only once the day has ended, never for an unfinished day.

- {{COMPANY}}'s Wrap is built from this memory, with every member's data — never from one member's own
  session or report.
- It goes to no one by default. When it is needed, it goes to the whole team, never to a subset.
- Built from `.brand/`: read `.brand/REPORTING.md`, start from its template, embed its logo. Only the
  brand's recorded assets are used; a missing brand decision is left out and listed as open.
