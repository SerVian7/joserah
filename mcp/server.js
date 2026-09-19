#!/usr/bin/env node
'use strict';
/**
 * The Joserah knowledge base as an MCP server, over stdio.
 *
 *   node <plugin>/mcp/server.js --root <workspace root>
 *
 * --root is optional: without it the server walks up from its working
 * directory looking for .joserah/config.json, the same marker every other
 * Joserah tool uses. It exits non-zero with one line if it finds none.
 *
 * stdio is the whole transport. There is no port, no listener and nothing
 * reachable from another machine: the client starts this as a child process
 * and the operating system's own permissions are the boundary. That is what
 * makes "opened without authentication" safe here, and it is why nothing in
 * this file binds an address.
 *
 * The protocol is newline-delimited JSON-RPC, written out rather than taken
 * from a package: this plugin ships as a git checkout with no install step,
 * so a dependency here would mean inventing one for every user. The cost is
 * the switch below — two handshakes answered from one table.
 */
const path = require('path');
const readline = require('readline');
const { createServer, INSTRUCTIONS } = require('./lib/core');
const { findWorkspace } = require('../hooks/lib/workspace');
const { pluginVersions } = require('../tools/lib/prompt');

const SERVER_NAME = 'joserah-kb';
const PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25'];

// Our own version, through the one reader the rest of the plugin already
// uses, rather than a second copy of the manifest path here. Two reasons, and
// the second is the one that matters: a duplicate reader drifts, and this file
// must not spell out a host product's directory name -- the server has to be
// openable by anyone's assistant, and a test in this suite greps mcp/ for
// exactly that.
function pluginVersion() {
  try {
    return pluginVersions({ pluginRoot: path.join(__dirname, '..') }).installed || '0.0.0';
  } catch { return '0.0.0'; }
}

function resolveRoot(argv) {
  const i = argv.indexOf('--root');
  const start = i !== -1 && argv[i + 1] ? argv[i + 1] : process.cwd();
  const root = findWorkspace(start);
  if (!root) {
    process.stderr.write(SERVER_NAME + ': no Joserah workspace at or above ' + start
      + ' (no .joserah/config.json)\n');
    process.exit(2);
  }
  return root;
}

/**
 * One message in, one response out — or null for a notification, which by
 * definition is not answered. Pure, so the protocol is testable without a
 * child process.
 */
function handle(server, version, msg) {
  const id = msg && msg.id;
  if (id === undefined || id === null) return null;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const bad = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  const p = msg.params || {};
  const info = { name: SERVER_NAME, version };
  try {
    switch (msg.method) {
      case 'initialize':
        return ok({
          protocolVersion: PROTOCOL_VERSIONS.includes(p.protocolVersion)
            ? p.protocolVersion : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: info,
          instructions: INSTRUCTIONS,
        });
      case 'server/discover':
        return ok({
          resultType: 'complete',
          supportedVersions: PROTOCOL_VERSIONS,
          capabilities: { tools: {} },
          _meta: { 'io.modelcontextprotocol/serverInfo': info },
          instructions: INSTRUCTIONS,
          ttlMs: 3600000,
          cacheScope: 'public',
        });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: server.listTools() });
      case 'tools/call':
        return ok(server.callTool(p.name, p.arguments));
      default:
        return bad(-32601, 'unknown method: ' + msg.method);
    }
  } catch (err) {
    return bad(err.rpcCode || -32603, err.message);
  }
}

function serve(server, version) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null,
        error: { code: -32700, message: 'parse error' } }) + '\n');
      return;
    }
    const response = handle(server, version, msg);
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  });
}

if (require.main === module) {
  serve(createServer({ root: resolveRoot(process.argv.slice(2)) }), pluginVersion());
}

module.exports = { resolveRoot, handle, serve, SERVER_NAME, PROTOCOL_VERSIONS };
