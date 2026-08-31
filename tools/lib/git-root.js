'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

// git normalises the drive letter it prints on Windows (always e.g. `C:/...`,
// regardless of how it was invoked) but `path.resolve()` preserves whatever
// case it was given, and a caller's `root` commonly comes from an
// uncanonicalised argv/cwd. A workspace path with a lowercase drive letter
// would otherwise compare unequal to git's own answer for a directory that
// genuinely IS its own repo, misreporting it as nested/untracked in the
// trust-critical direction. One helper so every caller (doctor.js,
// secret-scan.js, measure-stage.js) can only get this wrong once.
function sameRepoPath(a, b) {
  let ra = path.resolve(a), rb = path.resolve(b);
  if (process.platform === 'win32') { ra = ra.toLowerCase(); rb = rb.toLowerCase(); }
  return ra === rb;
}

// The repository toplevel for `dir`, or null when `dir` is not inside a git
// repository at all (or git itself is unavailable).
function repoToplevel(dir) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// True only when `dir` IS a repository's own toplevel — not merely somewhere
// inside one. `git status`, `git diff --cached` and `git log` all report
// paths relative to the repository ROOT, not to the directory git was
// pointed at with `-C`; a workspace nested inside an ancestor repository
// would otherwise have every path silently miss `path.join(dir, rel)`, and
// callers built on that join must never mistake the resulting empty scan for
// a clean one. `git ls-files` is the one exception (cwd-relative, not
// root-relative) and does not need this guard.
function isOwnRepoRoot(dir) {
  const top = repoToplevel(dir);
  return top !== null && sameRepoPath(top, dir);
}

module.exports = { sameRepoPath, repoToplevel, isOwnRepoRoot };
