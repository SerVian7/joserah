'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');
const { stampKey } = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'config-stamp'));

test('stampKey replaces an existing numeric value in place', () => {
  const r = stampKey('{\n  "a": 1,\n  "formatVersion": 1\n}\n', 'formatVersion', 2);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.text, '{\n  "a": 1,\n  "formatVersion": 2\n}\n');
});

test('stampKey inserts a missing string key as the first property, matching eol and indent', () => {
  const r = stampKey('{\r\n    "a": 1\r\n}\r\n', 'promptSha256', 'abc');
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.text, '{\r\n    "promptSha256": "abc",\r\n    "a": 1\r\n}\r\n');
  assert.deepStrictEqual(JSON.parse(r.text), { promptSha256: 'abc', a: 1 });
});

test('stampKey is a no-op when the value is already there', () => {
  const src = '{ "promptVersion": 3 }';
  assert.deepStrictEqual(stampKey(src, 'promptVersion', 3), { text: src, changed: false });
});

test('stampKey leaves malformed or non-object JSON untouched', () => {
  assert.deepStrictEqual(stampKey('{ "a": ', 'k', 1), { text: '{ "a": ', changed: false });
  assert.deepStrictEqual(stampKey('[1,2]', 'k', 1), { text: '[1,2]', changed: false });
});

test('stampKey tolerates a UTF-8 BOM and keeps it', () => {
  const r = stampKey('\uFEFF{\n  "a": 1\n}\n', 'k', 'v');
  assert.strictEqual(r.changed, true);
  assert.ok(r.text.startsWith('\uFEFF{'));
  assert.deepStrictEqual(JSON.parse(r.text.replace(/^\uFEFF/, '')), { k: 'v', a: 1 });
});
