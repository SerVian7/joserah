#!/usr/bin/env node
/**
 * crew.js — writes the crew's five agent definitions into a workspace.
 *
 *   node crew.js <workspace>
 *
 * Reads the `crew` block of .joserah/config.json (tools/lib/crew-config.js)
 * and writes `.claude/agents/{lead,architect,builder,scout,sentry}.md` in the
 * WORKSPACE, never the plugin's own agents/: models and efforts are set per
 * workspace, and effort can be set only in an agent definition's frontmatter.
 *
 * Each body comes from templates/crew/<role>.md: its first line is the
 * agent's description, the rest the body. Every written file carries STAMP;
 * a same-named file without it is the owner's own and is never overwritten,
 * only reported (`kept-owner <role>`).
 *
 * `${CLAUDE_PLUGIN_ROOT}` in a template is replaced by this plugin's root:
 * a subagent's shell does not carry that variable (measured 2026-10-05), so
 * the definition names the tools by their real path.
 *
 * One line per role on stdout: `wrote|kept-owner|skipped-off <role>`.
 * Exit 0 on success; 1 on a config error (its message, naming the key, on
 * stderr) or when no workspace is found.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findWorkspace, readConfig } = require('../hooks/lib/workspace');
const { resolveCrew, ROLES } = require('./lib/crew-config');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const STAMP = '<!-- joserah:crew generated from config; do not hand-edit -->';

const agentPath = (root, role) => path.join(root, '.claude', 'agents', `${role}.md`);

function template(role) {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'crew', `${role}.md`), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN_ROOT.replace(/\\/g, '/'));
  const nl = text.indexOf('\n');
  return { description: text.slice(0, nl).trim(), body: text.slice(nl + 1).replace(/^\n+/, '') };
}

/** The exact text a role's definition should have. */
function definition(role, { model, effort }) {
  const { description, body } = template(role);
  return `---\nname: ${role}\ndescription: ${description}\nmodel: ${model}\neffort: ${effort}\n---\n${STAMP}\n\n${body}`;
}

const isOwners = (file) => fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(STAMP);

/**
 * Resolve the config and write the definitions. Returns one
 * `{ role, action }` per role; throws the resolver's error on a bad config.
 */
function generate(root) {
  const crew = resolveCrew(readConfig(root) || {});
  if (!crew.enabled) return ROLES.map((role) => ({ role, action: 'skipped-off' }));
  return ROLES.map((role) => {
    const file = agentPath(root, role);
    if (isOwners(file)) return { role, action: 'kept-owner' };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, definition(role, crew.roles[role]), 'utf8');
    return { role, action: 'wrote' };
  });
}

function main(argv) {
  const target = argv.find((a) => !a.startsWith('--'));
  const root = target && findWorkspace(target);
  if (!root) {
    process.stderr.write('crew.js: no Joserah workspace at or above ' + (target || '(none given)') + '\n');
    return 1;
  }
  let results;
  try {
    results = generate(root);
  } catch (e) {
    process.stderr.write(e.message + '\n');
    return 1;
  }
  for (const { role, action } of results) process.stdout.write(`${action} ${role}\n`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { generate, definition, STAMP, PLUGIN_ROOT };
