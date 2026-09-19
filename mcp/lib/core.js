'use strict';
/**
 * The tool surface: four tools, one instruction line, one seam.
 *
 * Passive. It answers requests. It never starts work of its own, never calls
 * a model, never polls anything and never opens a socket.
 *
 * The instruction string carries only what the tool schemas cannot — the
 * cross-tool ordering rule and the path and date conventions. It carries no
 * name for the assistant, no tone and no voice: character lives in the
 * assistants that connect, never here. An edit that adds a sentence about how
 * to BE rather than how to CALL breaks a decision, not a style preference.
 *
 * `allow` is the whole extension point. A wrapper that has its own idea of
 * who may call what passes a filter over tool NAMES; nothing about identity,
 * rights or sessions enters this file.
 */
const kb = require('./kb');

const INSTRUCTIONS = 'A markdown knowledge base. Call kb_search or kb_list to find a path, then kb_read. '
  + 'Paths are workspace-relative. Dates are ISO 8601.';

const text = (s) => ({ content: [{ type: 'text', text: s }] });
const failed = (s) => ({ content: [{ type: 'text', text: s }], isError: true });
const json = (v) => text(JSON.stringify(v, null, 2));

// Fixed order, deterministic, the same for every caller: a tool set that
// varies between connections costs a client its cache and a model its prompt
// cache. In native it cannot vary at all — there is only one caller.
const TOOLS = [
  {
    name: 'kb_search',
    description: 'Search the knowledge base. Case-insensitive substring match over title, '
      + 'frontmatter and body. Returns path, title, type, line and a snippet per hit.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The text to look for.' },
        type: { type: 'string', description: 'Only notes whose frontmatter type is this.' },
        limit: { type: 'number', description: 'Maximum hits to return. Default 20.' },
      },
      required: ['query'],
    },
    run: (root, a) => (typeof a.query === 'string' && a.query
      ? json(kb.searchNotes(root, { query: a.query, type: a.type || '', limit: a.limit || 20 }))
      : failed('kb_search needs a non-empty query')),
  },
  {
    name: 'kb_read',
    description: 'Read one note by its workspace-relative path. Give section to read one '
      + 'heading block instead of the whole note.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path, as kb_list and kb_search return it.' },
        section: { type: 'string', description: 'Heading text; returns that heading block only.' },
      },
      required: ['path'],
    },
    run: (root, a) => {
      if (typeof a.path !== 'string' || !a.path) return failed('kb_read needs a path');
      const r = kb.readNote(root, { path: a.path, section: a.section || '' });
      return r.error ? failed(r.error) : text(r.text);
    },
  },
  {
    name: 'kb_list',
    description: 'List notes with their path, title, type and last-modified date. '
      + 'Reads frontmatter only, so it is the cheap way to orient.',
    inputSchema: {
      type: 'object',
      properties: {
        prefix: { type: 'string', description: 'Only paths starting with this.' },
        type: { type: 'string', description: 'Only notes whose frontmatter type is this.' },
      },
    },
    run: (root, a) => json(kb.listNotes(root, { prefix: a.prefix || '', type: a.type || '' })),
  },
  {
    name: 'kb_append',
    description: 'Append a line or a block to an existing note. It creates no files, overwrites '
      + 'nothing and never edits frontmatter. Text that looks like a credential is refused.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path of an existing note.' },
        text: { type: 'string', description: 'The text to append.' },
      },
      required: ['path', 'text'],
    },
    run: (root, a) => {
      const r = kb.appendNote(root, { path: a.path, text: a.text });
      return r.error ? failed(r.error) : json({ offset: r.offset, appended: r.appended });
    },
  },
];

function createServer({ root, allow = () => true }) {
  const visible = (ctx) => TOOLS.filter((t) => allow(t.name, ctx));
  return {
    root,
    instructions: INSTRUCTIONS,
    listTools(ctx) {
      return visible(ctx).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
    },
    callTool(name, args, ctx) {
      const tool = visible(ctx).find((t) => t.name === name);
      if (!tool) {
        // A tool that is not listed cannot be named: the specification's own
        // two error channels, and this is the protocol one.
        const err = new Error('unknown tool: ' + name);
        err.rpcCode = -32602;
        throw err;
      }
      return tool.run(root, args || {});
    },
  };
}

module.exports = { createServer, INSTRUCTIONS, TOOL_NAMES: TOOLS.map((t) => t.name) };
