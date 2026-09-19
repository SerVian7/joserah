'use strict';
/**
 * untouchable.js — the one statement of which paths a Joserah tool may not
 * walk into, and why. Until 2026-09-13 the same knowledge was written out in
 * five tools, and they had already drifted apart in three places; each of the
 * three is preserved below as a named set rather than merged away.
 *
 * Data and one matcher, no I/O, so every consumer can require it — including
 * the copy of verify-links.js that scaffold.js installs into a workspace,
 * which is why scaffold.js copies this file next to it as
 * .joserah/tools/lib/untouchable.js and doctor.js checks both for drift.
 *
 * Three kinds of path live here and they are NOT interchangeable:
 *  - REL: a workspace-relative path, matched as "this path or anything under
 *    it", case-insensitively (Windows and default-macOS filesystems are).
 *    A contract about the workspace ROOT.
 *  - NAMES: a bare directory name, matched at any depth. Junk is junk wherever
 *    it sits.
 *  - ROOT-EXACT: a workspace-relative path matched by equality only, never by
 *    prefix — archive.js's root exclusions, where a nested folder of the same
 *    name is still backed up. Do not run these through isUnder().
 */

// Source material: the owner's own originals, copied in verbatim, never edited
// by the assistant. Current name first; the two legacy names are what the
// folder was called before 2026-09-12 and before 2026-08-31, and workspaces in
// the wild still carry them.
const SOURCE_MATERIAL_REL = ['imports', 'raw', '.joserah/knowledge/raw'];

// The subset the scaffold's .gitignore has always excluded. The legacy
// .joserah/knowledge location is deliberately NOT here: nothing ever
// gitignored it, so a workspace that still has it tracks it in git — which is
// why secret-scan.js must keep reading that location even though it skips the
// other two.
const SOURCE_MATERIAL_GITIGNORED_REL = ['imports', 'raw'];

// Credentials. CREDENTIALS_ROOT is the current location (0.3.0 onward); the
// second entry is the pre-0.3.0 one, still present in published workspaces.
const CREDENTIALS_ROOT = 'keys';
const CREDENTIALS_REL = [CREDENTIALS_ROOT, '.joserah/keys'];

// Other repositories checked out inside the workspace. Root-anchored: they
// carry their own history, or none, and are never this plugin's to walk.
const FOREIGN_REL = ['projects', 'docker-stack'];

// Junk at any depth. '.superpowers' is disposable scratch a third-party
// execution harness leaves behind: regenerated on demand, not the workspace's
// health, and it would otherwise dominate a backup's file count.
const JUNK_NAMES = ['.git', 'node_modules', '.venv', '.superpowers'];

// Build output. Kept apart from JUNK_NAMES because only the scans that walk a
// whole workspace add it; doctor's placeholder walk and archive never have.
const BUILD_OUTPUT_NAMES = ['dist', 'build'];

// Trees a migration must not rewrite: .claude/ is the host's own agent and
// skill definitions, .joserah/user/ and .joserah/feedback/ are the owner's
// drop folders (feedback filenames are published verbatim as public issues),
// .joserah/tools/ is plugin-owned and byte-compared, .joserah/last-time-inject
// is hook state.
const WORKSPACE_PRIVATE_REL = ['.claude', '.joserah/user', '.joserah/feedback',
  '.joserah/tools', '.joserah/last-time-inject'];

// ---- per-consumer compositions: the only place a consumer's set is decided ----

// verify-links.js: links inside source material are historical facts, not
// workspace health; credentials and foreign repos are not ours to check.
const LINK_SCAN_SKIP_REL = [...CREDENTIALS_REL, ...FOREIGN_REL, ...SOURCE_MATERIAL_REL];
// 'site-packages' is here and nowhere else: a vendored Python tree full of
// .md files whose links were never about this workspace.
const LINK_SCAN_SKIP_NAMES = [...JUNK_NAMES, ...BUILD_OUTPUT_NAMES, 'site-packages'];

// workspace-scan.js (migrate, the relocate tools, check-claims): the
// credentials' legacy location joined this set on 2026-09-13 — a migration
// writing frontmatter into a credential note was never intended, and its
// absence was an oversight, not a rule.
const MIGRATION_SKIP_REL = [...CREDENTIALS_REL, ...FOREIGN_REL, ...SOURCE_MATERIAL_REL,
  ...WORKSPACE_PRIVATE_REL];
// Vendored and asset material (0.13.2): third-party skill copies and scraped
// source texts are not notes, so a migration must not give them headers. A
// folder holding a LICENSE is skipped for the same reason (workspace-scan.js).
const VENDORED_NAMES = ['assets', 'skills-ref'];
const MIGRATION_SKIP_NAMES = [...JUNK_NAMES, ...BUILD_OUTPUT_NAMES, ...VENDORED_NAMES];

// secret-scan.js: rel-matched, so the junk names here exclude only a
// root-level one — that is how this tool has always behaved. See the comment
// on SOURCE_MATERIAL_GITIGNORED_REL for why the legacy location is absent.
const SECRET_SCAN_SKIP_REL = [...CREDENTIALS_REL, ...FOREIGN_REL,
  ...SOURCE_MATERIAL_GITIGNORED_REL, ...JUNK_NAMES, ...BUILD_OUTPUT_NAMES];

// Name-matched walks that only count or sample files: doctor's placeholder
// scan and backup-scope's changed-since count. Bare names at any depth, so a
// nested knowledge/projects/ stays out — the behaviour doctor has had since
// that check existed.
const WALK_SKIP_NAMES = [...JUNK_NAMES, ...FOREIGN_REL, CREDENTIALS_ROOT];

// archive.js. NOTE the absence of source material: the zip route carries it on
// purpose (the owner's binaries ride along without consequence), and
// skills/backup/SKILL.md tells the owner so. Adding it here would empty every
// zip backup of the owner's own material without a word.
const ARCHIVE_EXCLUDE_ROOT_REL = FOREIGN_REL;      // ROOT-EXACT, not a prefix
const ARCHIVE_SKIP_NAMES = JUNK_NAMES;
const ARCHIVE_KEYS_PREFIXES = CREDENTIALS_REL;

/** "rel is this path, or lives under it" — case-insensitive, either separator. */
function isUnder(rel, prefixes) {
  const low = String(rel).split('\\').join('/').toLowerCase();
  return prefixes.some((p) => low === p || low.startsWith(p + '/'));
}

// Hidden directories are a tool's, never the owner's: editor servers, model
// caches, package caches. A workspace rooted at a home directory holds dozens
// of them, and 2026-09-15's dry run counted thousands of their markdown files
// as "notes". Two are the workspace's own and stay: .joserah (the knowledge
// base) and .claude (settings.json and promoted skills).
const HIDDEN_KEEP_NAMES = ['.joserah', '.claude'];
function isHiddenForeignDir(name) {
  return typeof name === 'string' && name.length > 1 && name[0] === '.' && !HIDDEN_KEEP_NAMES.includes(name);
}

// Optional `scope` in .joserah/config.json: the root entries that ARE the
// workspace. Selecting members is the right way round — an ignore list can
// never be finished, because a home directory grows new tool folders without
// asking. When the key is present, nothing else at the root is walked.
//
// The plugin's own shell is always in: the knowledge base, the two files the
// plugin writes and byte-compares, and the three root trees the skip sets
// above already govern (they are excluded by those sets, not by this one, and
// making the owner select them would only invite leaving one out).
const ALWAYS_IN_SCOPE = ['.joserah', 'agents.md', 'joserah-role.md', 'keys', 'projects', 'imports'];

/**
 * Normalise cfg.scope to lowercase first path segments, or null when the key
 * is absent — null means "everything under the root is the workspace", which
 * is what every workspace did before 0.11.3. Pure: the consumer reads
 * config.json and hands the object in.
 */
function scopeFrom(cfg) {
  if (!cfg || !Array.isArray(cfg.scope)) return null;
  const out = [];
  for (const s of cfg.scope) {
    if (typeof s !== 'string') continue;
    const first = s.split('\\').join('/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
      .split('/')[0].toLowerCase();
    if (first && !out.includes(first)) out.push(first);
  }
  return out;
}

/**
 * Is this workspace-relative path a member of the workspace? Decided on the
 * FIRST segment only, so `scope` selects root-level entries — folders or
 * files — and everything deeper inherits its root entry's verdict.
 */
function inScope(rel, scope) {
  if (!Array.isArray(scope)) return true;
  const first = String(rel).split('\\').join('/').split('/')[0].toLowerCase();
  return ALWAYS_IN_SCOPE.includes(first) || scope.includes(first);
}

module.exports = {
  HIDDEN_KEEP_NAMES, isHiddenForeignDir,
  ALWAYS_IN_SCOPE, scopeFrom, inScope,
  SOURCE_MATERIAL_REL, SOURCE_MATERIAL_GITIGNORED_REL,
  CREDENTIALS_ROOT, CREDENTIALS_REL, FOREIGN_REL,
  JUNK_NAMES, BUILD_OUTPUT_NAMES, WORKSPACE_PRIVATE_REL,
  LINK_SCAN_SKIP_REL, LINK_SCAN_SKIP_NAMES,
  MIGRATION_SKIP_REL, MIGRATION_SKIP_NAMES,
  SECRET_SCAN_SKIP_REL, WALK_SKIP_NAMES,
  ARCHIVE_EXCLUDE_ROOT_REL, ARCHIVE_SKIP_NAMES, ARCHIVE_KEYS_PREFIXES,
  isUnder,
};
