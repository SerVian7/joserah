#!/usr/bin/env node
/**
 * SessionStart hook, first command: the standing layers. Silent unless the
 * working directory is inside a Joserah workspace. Injects the role file, who
 * this workspace belongs to and who the assistant is in it, the owner's
 * character overlay, and the owner's own standing rules.
 *
 * The same script also runs at SubagentStart, so an agent spawned by the Agent
 * tool stands in the same workspace the main session does. Only the envelope
 * differs: the contract wants the literal of the FIRING event, so the event
 * comes from argv, not from stdin — a hook that reads its piped JSON can wait
 * on an `end` that never arrives on Windows and hang every spawn. Exit code 2
 * blocks the spawn, so every path here exits 0.
 *
 * What is true only of this moment — date, open tasks, today's journal,
 * learnings, backup staleness, update lines — is the second command,
 * hooks/session-brief.js. Two commands, two budgets: see MAX_HOOK_CHARS.
 *
 * This file reads nothing outside the workspace. A path resolved against the
 * plugin's own install directory is forbidden here, and tests/hooks.test.js
 * guards it by grepping this file for the module-directory global — which is
 * why that global is not spelled out anywhere in this comment. A
 * plugin-relative read is what once let a missing templates/ tree silently
 * inject boilerplate as if it were the owner's rules.
 */
'use strict';
// Closed set on purpose: argv is not an event name, it only selects one.
const EVENT = process.argv[2] === 'subagent' ? 'SubagentStart' : 'SessionStart';
const { findWorkspace, readConfig } = require('./lib/workspace');
const { roleBlock, directivesBlock, agentOverlayBody, withinBudget, layersViaClaudeMd, MAX_HOOK_CHARS } = require('./lib/standing-context');

const ROOT = findWorkspace(process.cwd());
if (!ROOT) process.exit(0);

const cfg = readConfig(ROOT) || {};
// 0.13.4: a subagent is a worker, not a second main session. It keeps the
// facts it works in — name, owner, language, trust, the owner's layers — and
// loses what only the conversation with the owner needs: the greeting and the
// signature. Never told it was a worker, it read a workspace rule such as
// "Default: delegate" as its own and delegated again.
const WORKER = EVENT === 'SubagentStart';

// Context arrives in layers, and the order is deliberate — it is how the
// model weighs what it reads. Each one is more specific than the one above it,
// and the last is true only of this moment:
//   1. AGENTS.md   the system prompt: the same in every workspace, never varies.
//   2. role block   JOSERAH-ROLE.md — who you are talking to, from the
//                   workspace's `kind`. Supplements AGENTS.md, so it is read
//                   directly after it.
//   3. this block   what is TRUE of this workspace: who it belongs to, who you
//                   are in it, what language, what you may touch.
//   4. agent block  the owner's overlay on the assistant's default character
//                   — empty unless the owner wrote to it.
//   5. directives   .joserah/directives.md — the owner's own standing rules,
//                   which win over AGENTS.md and over everything above them,
//                   so they are the last standing layer and are read last.
//   6. next block   what happens to be true RIGHT NOW: the date, open tasks,
//                   today's journal — computed per session, true of no other.
// Identity belongs in layer 3 and is injected, never left to AGENTS.md to be
// read: a file the model may or may not open cannot override the name it
// already believes it has. On 2026-08-30 an assistant with
// `assistantName: "Yarkın"` on record still introduced itself as Claude.
// Layers 2 and 5 are injected for the same reason and were not always: until
// 0.7.0 AGENTS.md only *pointed* at those two files, and measuring real
// session transcripts showed that a pointed-at file is usually never opened —
// which meant a workspace's own rules were in force only in the sessions that
// happened to go and read them. Both files are the workspace's own, never the
// plugin's: one is written at scaffold time from the role template that
// matches `kind`, the other is the owner's and nothing here ever writes it.
const who = [];
// 0.13.9: every identity fact is stated, present or absent. Left unsaid, an
// empty `assistantName` sent three fresh sessions to grep config.json before
// they greeted anyone.
who.push(cfg.assistantName
  ? `**Your name in this workspace is ${cfg.assistantName}.** Introduce yourself as ${cfg.assistantName} — never as the model or tool you happen to be running on.`
  : 'You have no name here: you are simply the assistant. Do not look it up, do not invent one.');
who.push(cfg.ownerName
  ? `The owner of this workspace is **${cfg.ownerName}**.`
  : 'No owner name is on record: do not look it up; ask them once if you need it.');
who.push(cfg.dialogueLanguage
  ? `Speak **${cfg.dialogueLanguage}** to them.`
  : 'No dialogue language is on record: answer in the language they write in.');
if (cfg.ownerName && !WORKER) {
  who.push(`Open by greeting them by name${cfg.assistantName ? ' and giving yours' : ''} — short and warm, the honorific the language calls for — then go straight to the work. Never open by describing yourself as software, the tool you run on, or the folder you are in.`);
}
// How much to say, never what the person is. 0.15.0 (owner, 2026-09-30):
// no config key flips it — a developer who wants plain internals writes one
// line in their own .joserah/directives.md, which reaches the session below.
who.push('Match them: speak at the level they speak, and do not volunteer file paths, folder names, repository names, config keys, tool or model names, or version numbers they did not ask for. Few words, concrete data.');
// 0.13.0: the signature is the assistant's — never the owner's, never the
// host's. An unnamed assistant IS Joserah and signs once; "Joserah" twice
// over is what the second branch avoids. Only the name is decided here.
// Which template a mail or a report is built from is the correspondence
// skill's business: naming a plugin file here would mean resolving a path
// relative to the install at hook runtime, and this file may not do that
// (see the header).
// 0.13.1: the middle dot is gone. A named assistant writes its name, a
// space, then Joserah, and the template carries the second word a shade
// fainter — nothing else joins them. This briefing is plain text, so it
// also hands over the comma form for anywhere the tone cannot travel.
if (!WORKER) who.push(cfg.assistantName
  ? `Anything you send outside this workspace — a mail, a report, a document — you sign **${cfg.assistantName} Joserah**: your own name, never the owner's and never the host's, and then Joserah, a space later and a shade fainter. Nothing joins the two words but that space — never a middle dot. Where the tone cannot be carried, as in plain text, write it **${cfg.assistantName}, Joserah**.`
  : `Anything you send outside this workspace — a mail, a report, a document — you sign **Joserah**: you are Joserah and the sole author here, so the name is written once and once only, never the owner's and never the host's.`);
// Owner decision 2026-10-01: the Daily Tracker is native and automatic, quiet,
// and opt-out. Main session only (a worker does not keep it); on unless
// config.json says `"dailyTracker": false`.
if (!WORKER && cfg.dailyTracker !== false) {
  who.push('Daily Tracker: on — keep the owner\'s Daily Tracker for today without being asked and without nagging (never ask about it, never announce it); end every reply with its link. How: the orchestrate skill, "Trackers". Off when `"dailyTracker": false` in .joserah/config.json.');
}
// Owner decision 2026-10-01: a per-workspace opt-in. Off (absent or anything but
// true) keeps the standing rule: a shared-memory push waits for the owner's yes.
if (!WORKER && cfg.sharedMemoryAutoPush === true) {
  who.push("Shared-memory pushes: automatic — push a joined shared memory without waiting for a yes and report the push notice's file list in one line; ask first only when something is genuinely problematic (another member's content removed, personal data, a rules change you are unsure of). Off when `sharedMemoryAutoPush` is not true in .joserah/config.json.");
}
// 0.18.0 (owner, 2026-10-05): the crew. On unless `"crew": false` or
// `"crew": { "enabled": false }`; a block with a typo still counts as on here —
// the generator refuses it loudly and doctor reports it. Voice is the main
// session: it only talks, and the work goes to Lead. Lines kept short: they share
// the 8,000-character budget with the owner's layers. Read inline, not through
// the plugin's crew-config module: this file reads nothing outside the workspace.
const CREW_ON = !(cfg.crew === false || (cfg.crew && typeof cfg.crew === 'object' && cfg.crew.enabled === false));
if (!WORKER && CREW_ON) {
  const tracker = cfg.dailyTracker !== false ? ' The Daily Tracker is yours.' : '';
  who.push('Crew: on — you only talk; a one-lookup question you answer, every other job goes to Lead (opened at the first job, resumed by message after).' + tracker + ' A worker\'s completion notice goes to Lead verbatim; it is done when Lead says so. How: the orchestrate skill.');
}
// Developer mode decides only whether the owner SEES the crew (owner, 2026-10-05:
// "like a dev mode"). Off — the default, crew on or off — no agent talk at all.
// On with crew off, agents are named as before, so there is nothing to say.
if (!WORKER && cfg.devMode !== true) {
  who.push('Developer mode: off — speak of the work in the first person and never name an agent, a role or a model to the owner.');
} else if (!WORKER && CREW_ON) {
  who.push('Developer mode: on — the crew may be named to the owner.');
}
if (cfg.trust === 'guest') {
  who.push('Trust: **guest** — stay inside this workspace folder; do not read, write or act on anything else on this machine.');
}
// 0.13.0: in a hosted workspace either the owner or the host may have opened
// the session and nothing announces which. Saying so is cheap and stops the
// failure it names: a maintenance session that greeted the host as the owner
// and wrote its own round into the owner's journal.
if (cfg.kind === 'hosted') {
  const host = cfg.hosting && cfg.hosting.host ? `**${cfg.hosting.host}**` : 'a host';
  who.push(`This workspace is **hosted**: the machine and the accounts belong to ${host}, the workspace belongs to the owner. Either of them may be at the keyboard and nothing here tells you which — where the answer would differ, ask in one line rather than assume. A maintenance or service session is the host's: nothing from it goes on the owner's desk (journal, tasks, notes) unless the owner asked for it.`);
}
// In the order above. What is true of this workspace outranks what is true
// only of this moment, so it is read first and never buried under a date.
// Every block that reads a file is skipped whole when that file is missing,
// empty, or still the skeleton it shipped as — an empty heading would spend
// context saying nothing, and doctor is what reports a file that should exist
// and does not.
const parts = [];

// 0.13.3: a layer the workspace-root CLAUDE.md imports reaches the session
// through CLAUDE.md, whole and without this command's 10,000-character cliff,
// so it is not sent a second time here. Everything else stays: the identity
// block and the agent overlay are always this hook's, and a workspace with no
// stub, an owner-written CLAUDE.md that imports nothing, or a session started
// in a subfolder (where the imports do not expand) gets every layer from here
// exactly as before. See CLAUDE_MD in lib/standing-context.js.
const viaClaudeMd = layersViaClaudeMd(ROOT, process.cwd());

const role = viaClaudeMd.has('JOSERAH-ROLE.md') ? '' : roleBlock(ROOT);
if (role) parts.push(role.trim());

parts.push(
  '## This workspace',
  who.join('\n'),
);

// Layer 4 (see the list above) — the owner's overlay on the assistant's
// default character. Shipped
// empty; injected only when it has real content, so an untouched workspace
// spends no context on it. Detection is a wording-independent marker, never
// a comparison against the plugin's own template file: an earlier version of
// this hook diffed the workspace copy against a template it read from disk
// at `../templates/.joserah/agent.md` — a missing or unreadable templates/
// tree made that read return '', every workspace file trivially "started
// with" the empty string, and the entire untouched essay got injected as if
// it were the owner's own rules. A future reword of the shipped prose had
// the same failure mode from the other direction: an old, already-scaffolded
// workspace would no longer match the new wording and would leak its own
// stale essay into context. Neither is possible once nothing is compared
// against anything — only text after the last marker occurrence is ever
// read, whatever the prose above it says, and there is no runtime read of
// the plugin tree at all. No marker at all (a hand-made or hand-edited
// file) means there is no reliable boundary between explanation and rule,
// so nothing is injected — silence is the safe default for an owner who
// never asked for any of this, not a guess at which lines are "prose".
// (The marker and this read live in lib/standing-context.js, beside the other
// two per-workspace layers and the doctor check that measures all of them —
// still a workspace-relative read, with no path into the plugin tree.)
const agentBody = agentOverlayBody(ROOT);
if (agentBody) parts.push('\n## This assistant\n' + agentBody);

// Layer 5 — the owner's own standing rules. Last of the standing layers
// because they win over every one of them, AGENTS.md included.
const directives = viaClaudeMd.has('.joserah/directives.md') ? '' : directivesBlock(ROOT);
if (directives) parts.push(directives);
// First, ahead of the budget cut, so a cut can never take it; the budget
// shrinks by its length.
// 0.17.0 (owner, 2026-10-01): delegation may nest — a Manager opens workers
// and they may open their own — so the line names the rules, never "do not delegate".
// 0.18.0, crew on: the result lives in a log, not in the reply — a completion
// notice may land in another conversation than the launcher's (spec "Message
// protocol"), so the file is written first and the reply is its path + one line.
const NESTING = 'You may open sub-agents of your own under the same rules: a brief each, never two on one folder or file, a checkpoint file for long work.';
const workerLine = !WORKER ? ''
  : CREW_ON
    ? `You are a sub-agent dispatched by another session: do the task you were given. Write the result to your log before you reply — the log your brief names, else .joserah/desk/crew/<YYYY-MM-DD>/<your role>/<HHMM>-<short-slug>.md — then reply with that path and one line; a read-only agent replies in text. ${NESTING}\n\n`
    : `You are a sub-agent dispatched by another session: do the task you were given and report back as text. ${NESTING}\n\n`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: EVENT,
    additionalContext: workerLine +
      withinBudget(parts.join('\n'), '.joserah/directives.md, the last standing layer', MAX_HOOK_CHARS - workerLine.length),
  },
}));
