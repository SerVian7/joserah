'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');

const read = (...p) => JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, ...p), 'utf8'));

test('the version is the same in all three places it is written by hand', () => {
  const plugin = read('.claude-plugin', 'plugin.json');
  const market = read('.claude-plugin', 'marketplace.json');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/, 'plugin.json version is not a version');
  assert.strictEqual(market.metadata.version, plugin.version,
    'marketplace.json metadata.version disagrees with plugin.json');
  assert.strictEqual(market.plugins.length, 1, 'one plugin entry expected');
  assert.strictEqual(market.plugins[0].version, plugin.version,
    'marketplace.json plugins[0].version disagrees with plugin.json');
});

// Three hand-synced numbers can go stale together and still agree, which is
// exactly how a release ships the previous version looking consistent. The
// CHANGELOG release note is the anchor a copy-paste cannot satisfy: it has to be
// written in words by whoever cut the release.
test('the current version has a release note someone had to write', () => {
  const version = read('.claude-plugin', 'plugin.json').version;
  const log = fs.readFileSync(path.join(PLUGIN_ROOT, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const heading = `## ${version}`;
  assert.ok(log.includes(`${heading}\n`), `CHANGELOG.md has no "${heading}" section`);
  const body = log.slice(log.indexOf(heading) + heading.length).split('\n## ')[0].trim();
  assert.ok(body.length > 80, `the ${version} release note is too short to say anything`);

  // The three numbers can also go stale together *after* the note was written:
  // they still agree, and the previous release's note is still there, so
  // everything above passes while the release ships the old number. Newest
  // first: the top note is the one this release wrote.
  const notes = [...log.matchAll(/^## (\d\S*)$/gm)].map((m) => m[1]);
  assert.strictEqual(notes[0], version,
    `CHANGELOG.md's newest release note is for ${notes[0]}, but the three version fields say ${version}`);
});

// Review 21 (#38): the release notes left the README; it keeps a pointer.
test('the README points at the changelog and carries no release notes', () => {
  const readme = fs.readFileSync(path.join(PLUGIN_ROOT, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.doesNotMatch(readme, /^#+ Upgrading (to|from) /m, 'a release note is still in README.md');
  assert.match(readme, /^## Upgrading\n\nRun `\/joserah:update`\. Release notes: \[CHANGELOG\.md\]\(CHANGELOG\.md\)\./m);
});
