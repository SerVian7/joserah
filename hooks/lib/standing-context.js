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
// attention, or out of its context window. Ten thousand characters is well
// past any standing rule set that could still be read as rules (AGENTS.md, the
// whole standard router, is about seventeen thousand), so a file that reaches
// it has stopped being a rule sheet and become a document. It is still never
// cut silently: see capped() below.
const MAX_LAYER_CHARS = 10000;

// Where the doctor starts saying the standing context is getting expensive.
// Deliberately below "AGENTS.md + one file at the cap": the warning must
// always arrive while every layer is still whole, so an owner hears that their
// directives are getting long *before* anything of theirs is ever cut. Below
// this, the injection costs about as much as a short chapter and buys the
// guarantee that the owner's rules are actually in force.
const WARN_TOTAL_CHARS = 25000;

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
  return at === -1 ? '' : text.slice(at + AGENT_OVERLAY_MARKER.length).trim();
}

// What every session pays before any work happens: the standard router the
// host loads by itself, plus the per-workspace layers this file injects. The
// computed block (date, open tasks, today's journal) is deliberately not
// counted — it is bounded by the hook and is not the thing that grows.
function standingContextSize(root) {
  const parts = [
    ['AGENTS.md', readText(path.join(root, 'AGENTS.md')).length],
    ['JOSERAH-ROLE.md', roleBlock(root).length],
    ['.joserah/agent.md', agentOverlayBody(root).length],
    ['.joserah/directives.md', directivesBlock(root).length],
  ].filter(([, n]) => n > 0);
  return { total: parts.reduce((n, [, len]) => n + len, 0), parts };
}

module.exports = {
  AGENT_OVERLAY_MARKER, MAX_LAYER_CHARS, WARN_TOTAL_CHARS,
  carriesRules, roleBlock, directivesBlock, agentOverlayBody, standingContextSize,
};
