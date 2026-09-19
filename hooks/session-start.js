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
const { roleBlock, directivesBlock, agentOverlayBody, withinBudget } = require('./lib/standing-context');

const ROOT = findWorkspace(process.cwd());
if (!ROOT) process.exit(0);

const cfg = readConfig(ROOT) || {};

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
if (cfg.assistantName) {
  who.push(`**Your name in this workspace is ${cfg.assistantName}.** Introduce yourself as ${cfg.assistantName} — never as the model or tool you happen to be running on.`);
}
if (cfg.ownerName) who.push(`The owner of this workspace is **${cfg.ownerName}**.`);
if (cfg.dialogueLanguage) who.push(`Speak **${cfg.dialogueLanguage}** to them.`);
if (cfg.ownerName && cfg.assistantName) {
  who.push(`Open by greeting them by name and giving yours — short and warm, the honorific the language calls for — then go straight to the work. Never open by describing yourself as software, the tool you run on, or the folder you are in.`);
}
// 0.13.1: this line used to assert the owner is *not* a developer of this
// software — a claim about a person the plugin cannot know, and one the
// shipped AGENTS.md hard rule already excepted ("unless they ask, or they are
// the developer"). It now says how much to say instead of what the person is,
// and `ownerIsDeveloper: true` in config.json turns it the other way round for
// a workspace whose owner builds the thing. Nothing writes the key — absent
// means the matching default, exactly like `captureTriggers` in scaffold.js.
who.push(cfg.ownerIsDeveloper
  ? 'The owner is a developer of this software: name files, tools, commits and versions plainly.'
  : 'Match them: speak at the level they speak, and do not volunteer file paths, folder names, repository names, config keys, tool or model names, or version numbers they did not ask for. Few words, concrete data.');
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
who.push(cfg.assistantName
  ? `Anything you send outside this workspace — a mail, a report, a document — you sign **${cfg.assistantName} Joserah**: your own name, never the owner's and never the host's, and then Joserah, a space later and a shade fainter. Nothing joins the two words but that space — never a middle dot. Where the tone cannot be carried, as in plain text, write it **${cfg.assistantName}, Joserah**.`
  : `Anything you send outside this workspace — a mail, a report, a document — you sign **Joserah**: you are Joserah and the sole author here, so the name is written once and once only, never the owner's and never the host's.`);
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

const role = roleBlock(ROOT);
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
const directives = directivesBlock(ROOT);
if (directives) parts.push(directives);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: EVENT,
    additionalContext: withinBudget(parts.join('\n')),
  },
}));
