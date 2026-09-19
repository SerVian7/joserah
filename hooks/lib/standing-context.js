/**
 * The standing layers a session is given before it does anything: the role
 * file (JOSERAH-ROLE.md) and the workspace's own rules (.joserah/directives.md).
 *
 * Both used to be *pointed at* by AGENTS.md's "read next" sentence rather than
 * injected. A session either opened them or it did not, and a measurement of
 * real transcripts showed that most did not — so a workspace's own written
 * rules were in force only in the minority of sessions that chose to go and
 * read them. They are injected now, at the cost of their length on every
 * session, and that cost is why the size guard below exists.
 *
 * Shared by hooks/session-start.js (which injects the blocks) and the doctor's
 * standing-context-size check (which measures exactly what that hook injects).
 * One file, so the two can never disagree about what reaches a session.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// The byte sequence below which .joserah/agent.md is the owner's overlay on the
// assistant's character, and above which it is the shipped explanation. Lives
// here because both the hook and the doctor need it and neither owns it.
const AGENT_OVERLAY_MARKER = '<!-- joserah:agent-overlay-below -->';

// Per-file cap. These files are the owner's, not the plugin's, and nothing
// stops one from growing without limit — a pasted transcript, a whole
// procedure manual — which would push everything after it out of a session's
// attention. Five thousand characters is roughly a long chapter of rules, and
// deliberately well under MAX_HOOK_CHARS: no single layer may fill a whole hook
// command by itself and starve the others. It was 10,000 until 0.13.0, the same
// number as the harness's own cliff, which is how one workspace's directives
// file came to sit exactly on it. It is still never cut silently: see capped().
const MAX_LAYER_CHARS = 5000;

// Where the doctor starts saying the standing context is getting expensive.
// It is a TOTAL — the router the host loads by itself, plus the per-workspace
// layers — and it is not a truncation point: since 0.13.0 the cut that matters
// is MAX_HOOK_CHARS, per hook command. The number stays at 25,000 through the
// 0.13.0 slimming on purpose. The router drops to about 13,000 and each layer
// is capped at 5,000, so a healthy workspace lands near 19,000 and is quiet,
// while a workspace carrying a 22,000-character directives file still reports
// itself — which is the whole point, because that file is the one being cut.
const WARN_TOTAL_CHARS = 25000;

// What ONE hook command may hand back. Claude Code replaces any single hook
// command's additionalContext over 10,000 characters with a stub carrying only
// the first 2,000 of it plus a file path — undocumented, read in the CLI binary
// as `M9n=1e4` / `$De=2000`. Measured across 25 sessions on CLI 2.1.269-2.1.273:
// this plugin's SessionStart hook produced 10,140-16,417 characters and 2,263
// arrived, every time, for about a week; no directive of any workspace reached a
// session in that period. 8,000 leaves 2,000 characters of headroom under the
// cliff on purpose: one live workspace measured its whole briefing at 9,750
// characters, and a budget set just under 10,000 would be crossed by two more
// lines of the owner's own rules and would need a release to move.
const MAX_HOOK_CHARS = 8000;

// Reserved at the FRONT of the output for the notice below. A warning printed
// after the text it warns about is discarded together with it — that is exactly
// how a week of lost briefings went unremarked, because the per-file `[cut]`
// line sat at character ~11,000 of a briefing the harness truncated at 2,000.
// The notice is about 310 characters; 400 is slack, not a measurement.
const NOTICE_RESERVE = 400;

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

// Everything the plugin writes into these files as guidance is an HTML comment
// addressed to the owner, so comments never count as rules — but they are only
// stripped for the decision below, never from what is injected: what the owner
// wrote is passed on as they wrote it.
function withoutComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

// Does this file carry a rule at all, or is it still the skeleton it shipped
// as? Nothing is compared against the template: an old workspace's copy of a
// since-reworded skeleton must read as a skeleton too, and a missing or
// unreadable templates/ tree must not silently change the answer (the same
// trap the agent-overlay marker exists to avoid). The question asked instead
// is wording-independent — is there any text under a section heading? The
// skeleton's sections hold only comments, so it has none; one line written
// under any heading is enough to make the file real. A file with no section
// headings at all is judged on everything below its title, since a hand-made
// file is under no obligation to use sections.
function carriesRules(text) {
  const stripped = withoutComments(text);
  const firstSection = stripped.search(/^##\s/m);
  const body = firstSection === -1
    ? stripped.replace(/^#[^\n]*\n?/, '')
    : stripped.slice(firstSection);
  return body.split('\n').some((line) => line.trim() && !/^#{1,6}\s/.test(line.trim()));
}

// A cut rule is worse than an absent one — a session that reads half a
// sentence as the whole rule follows a rule the owner never wrote. So the cut
// is part of the injected text: what was lost, from which file, and what to do
// about it. The cut lands on a line boundary where one is near enough, so a
// rule is at least never severed mid-word.
function capped(relPath, body) {
  if (body.length <= MAX_LAYER_CHARS) return body;
  const kept = body.slice(0, MAX_LAYER_CHARS);
  const lastBreak = kept.lastIndexOf('\n');
  const text = lastBreak > MAX_LAYER_CHARS / 2 ? kept.slice(0, lastBreak) : kept;
  return `${text}\n\n[cut] ${relPath} is longer than ${MAX_LAYER_CHARS} characters: ` +
    `${body.length - text.length} character(s) of it were not injected and are missing from the text above. ` +
    'Open the file yourself before relying on any rule from it, and tell the owner it has outgrown the session briefing.';
}

// The whole of one hook command's output, kept under the harness's cliff. The
// per-file cap above cannot guarantee this on its own — several layers, each
// legally under their own cap, still add up — so this is the guarantee and the
// cap is only good manners. Unlike capped(), the notice goes FIRST: see
// NOTICE_RESERVE.
function withinBudget(text, budget = MAX_HOOK_CHARS) {
  if (text.length <= budget) return text;
  const room = text.slice(0, budget - NOTICE_RESERVE);
  const lastBreak = room.lastIndexOf('\n');
  const kept = lastBreak > room.length / 2 ? room.slice(0, lastBreak) : room;
  return `[cut] This session briefing was ${text.length} characters, over the ${budget}-character ` +
    `budget: ${text.length - kept.length} character(s) were dropped from the end and are missing ` +
    'below. Open .joserah/directives.md yourself before relying on any rule from it, and tell the ' +
    'owner their standing rules have outgrown the session briefing.\n\n' + kept;
}

// One standing layer, built the way every other block in the session-start
// hook is built: a heading naming the file, the file's own text below it, and
// nothing at all when there is nothing to say.
function layerBlock(root, relPath, heading, { skipUnlessRules = false } = {}) {
  const body = readText(path.join(root, ...relPath.split('/'))).replace(/\r\n/g, '\n').trim();
  if (!body) return '';
  if (skipUnlessRules && !carriesRules(body)) return '';
  return `\n## ${heading} (${relPath})\n${capped(relPath, body)}`;
}

function roleBlock(root) {
  return layerBlock(root, 'JOSERAH-ROLE.md', 'Your role in this workspace');
}

// The owner's own standing rules, and the last word: they win over AGENTS.md
// and over everything else injected above them.
function directivesBlock(root) {
  return layerBlock(root, '.joserah/directives.md', 'Standing rules for this workspace',
    { skipUnlessRules: true });
}

function agentOverlayBody(root) {
  const text = readText(path.join(root, '.joserah', 'agent.md'));
  const at = text.lastIndexOf(AGENT_OVERLAY_MARKER);
  if (at === -1) return '';
  // Capped like the other two layers, and for the same reason: until 0.13.0
  // this one was the only standing layer with no limit at all, so a procedure
  // pasted under the marker was injected whole into every session.
  return capped('.joserah/agent.md', text.slice(at + AGENT_OVERLAY_MARKER.length).trim());
}

// What every session pays before any work happens: the standard router the
// host loads by itself, plus the per-workspace layers this file injects. The
// computed block (date, open tasks, today's journal) is deliberately not
// counted — it is bounded by the hook and is not the thing that grows.
// Measured from the owner's files, never from the capped blocks the hook
// injects. Until 0.13.0 the two were the same thing; once every layer is
// capped at MAX_LAYER_CHARS, summing the injected text can only ever report
// the cap back at you. A 22,284-character directives file — the real size of
// one live workspace's — would be counted as 5,000 and called healthy while it
// was being cut, which is the one workspace this warning exists for. A warning
// that measures the truncation instead of the content is worse than no
// warning, because it actively reassures.
//
// The block functions still decide WHETHER a layer counts: a file that is
// still the skeleton it shipped as carries no rules, is injected by nobody,
// and must not be billed to the owner. Only the length comes from the file.
function standingContextSize(root) {
  const overlay = readText(path.join(root, '.joserah', 'agent.md'));
  const at = overlay.lastIndexOf(AGENT_OVERLAY_MARKER);
  const parts = [
    ['AGENTS.md', readText(path.join(root, 'AGENTS.md')).length],
    ['JOSERAH-ROLE.md', roleBlock(root) ? readText(path.join(root, 'JOSERAH-ROLE.md')).length : 0],
    ['.joserah/agent.md', agentOverlayBody(root) && at !== -1
      ? overlay.slice(at + AGENT_OVERLAY_MARKER.length).trim().length : 0],
    ['.joserah/directives.md',
      directivesBlock(root) ? readText(path.join(root, '.joserah', 'directives.md')).length : 0],
  ].filter(([, n]) => n > 0);
  return { total: parts.reduce((n, [, len]) => n + len, 0), parts };
}

module.exports = {
  AGENT_OVERLAY_MARKER, MAX_LAYER_CHARS, WARN_TOTAL_CHARS, MAX_HOOK_CHARS, NOTICE_RESERVE,
  carriesRules, roleBlock, directivesBlock, agentOverlayBody, standingContextSize, withinBudget,
};
