// tests/dev-skills.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');

// Each development skill must load (frontmatter name + trigger-shaped description, LF only)
// and carry the facts the server plan relies on; a skill that lost one of them would teach
// the next implementer the wrong thing.
const MUST = {
  'joserah-node-ts-strip': ['erasableSyntaxOnly', 'import type', '.ts', 'enum', 'node_modules', '--test-concurrency=1'],
  'joserah-hono-sse-routes': ['streamSSE', 'Last-Event-ID', 'app.request', '404', 'Origin', 'HttpBindings'],
  'joserah-claude-cli-driver': ['stream-json', 'stdin', 'taskkill', '/T', 'dontAsk', '--allowedTools', 'permission_denials', '--max-budget-usd', 'session_id', 'redact'],
  'joserah-auth-and-secrets': ['scrypt', 'SameSite=Strict', 'HttpOnly', 'JOSERAH_STATE_DIR', 'Origin', 'allowlist', 'empty'],
  'joserah-docker-native-parity': ['node:24-slim', 'CLAUDE_CONFIG_DIR', 'JOSERAH_IN_DOCKER', 'eol=lf', '127.0.0.1', 'DISABLE_AUTOUPDATER'],
};

for (const [name, facts] of Object.entries(MUST)) {
  test(`dev skill ${name} loads and carries its facts`, () => {
    const p = path.join(PLUGIN_ROOT, '.claude', 'skills', name, 'SKILL.md');
    assert.ok(fs.existsSync(p), `${p} missing`);
    const text = fs.readFileSync(p, 'utf8');
    assert.ok(!text.includes('\r'), 'LF only: a CRLF frontmatter does not parse');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(fm, 'frontmatter');
    assert.match(fm[1], new RegExp(`^name: ${name}$`, 'm'));
    assert.match(fm[1], /^description: Use when /m, 'trigger-shaped description');
    for (const f of facts) assert.ok(text.includes(f), `${name} must mention ${f}`);
    assert.ok(text.split('\n').length <= 120, 'a skill stays short');
  });
}
