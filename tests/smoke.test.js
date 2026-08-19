'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { runTool } = require('./helpers');

test('archive.js prints usage and exits 1 with no command', () => {
  const r = runTool('archive.js', []);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /usage/);
});
