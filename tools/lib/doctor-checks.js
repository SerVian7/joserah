/**
 * The doctor's checks, as data: one entry per check site, in the order doctor
 * runs them.
 *
 * Each entry carries three things and nothing else:
 *   id        a stable slug, never printed — what a test, a bug report or a
 *             future `--only` flag can name a check by, so renaming the
 *             owner-facing line never renames the thing itself.
 *   remedies  zero or more rows of the remedy table in skills/doctor/SKILL.md,
 *             `{ key, text }`, in the order they appear there. The prose lives
 *             in the skill because that is where the assistant reads it; it is
 *             repeated here so tests/doctor-registry.test.js can assert the two
 *             agree in both directions. That table drifted twice before this
 *             file existed — a check grew a failure mode and no row was added,
 *             a row outlived the check it described.
 *   run(ctx)  the check itself. Returns null (nothing to print), one result, or
 *             an array of results. A result is `check(name, ok, detail)` or
 *             `warn(name, detail)` — the same two shapes doctor.js used to push
 *             onto its own array, so a check moved here prints exactly what it
 *             printed before.
 *
 * `ctx` is built once by tools/doctor.js and is the only way in: an entry must
 * not re-read config.json or re-resolve the prompt source. Adding a check is
 * adding an entry here, plus its remedy row in both places.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { denyFor, hostPathsFor, defaultTrustFor } = require('./permission-deny');
const { FORMAT_VERSION, roleFor, parseFrontmatter, FEEDBACK_AREAS } = require('./note-format');
// The standing layers the session-start hook injects, and what they cost: the
// size check below must measure exactly what a session is handed, so it asks
// the hook's own library rather than re-deriving it here.
const { standingContextSize, WARN_TOTAL_CHARS } = require('../../hooks/lib/standing-context');

// The two result shapes, named as they were when they pushed onto doctor's own
// array — so the body of a check reads here exactly as it read there.
function check(name, ok, detail) { return { name, ok, detail: detail || '' }; }
function warn(name, detail) { return { name, ok: true, warn: true, detail: detail || '' }; }

// `.claude/` is not ours — Claude Code creates it on its own, and it must not
// be mandatory in general (owner: ".claude bu klasör otomatik oluşuyor ...
// zorunlu da olmamalı"). That stands for workspaces predating 0.3.0, and for
// an owner who deliberately removed it. But scaffold.js has ALWAYS written
// this file since 0.3.0 — so on a workspace `.joserah/config.json` records as
// created by 0.3.0 or later, absence means deleted, or restored from a
// pre-0.3.0 backup missing the K3 fix, not a legitimate "never had one".
// Failing only in that case keeps older workspaces and deliberate removals
// working while catching the case the rest of this branch exists to catch:
// "never claim clean if you did not look".
function versionAtLeast(version, min) {
  const parse = (v) => String(v || '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(version), b = parse(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0, bv = b[i] || 0;
    if (av !== bv) return av > bv;
  }
  return true; // equal counts as "at least"
}

// P3-3 + P0-1, used by the project-backups entry: `git -C <dir> ...` answers
// for the nearest ANCESTOR repository when <dir> is not a repository of its
// own, so every answer there needs the `rev-parse --show-toplevel` guard below.
function gitIn(dir, argv) {
  const r = spawnSync('git', ['-C', dir, ...argv], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

const CHECKS = [
  {
    id: 'workspace-marker',
    remedies: [],
    run({ root, cfg }) {
      return check('workspace marker readable', !!cfg, root);
    },
  },

  {
    id: 'node-version',
    remedies: [],
    run() {
      return check('node version >= 18', Number(process.versions.node.split('.')[0]) >= 18, process.version);
    },
  },

  {
    id: 'required-files',
    remedies: [
      {
        key: 'Missing core file (other than `keys/AGENTS.md`)',
        text: "Recreate it from the plugin's `templates/`. Templates carry `{{OWNER_ROLE_LINE}}`, which config.json does not store — ask the owner for it; if they decline, substitute an empty string. Never invent it.",
      },
      {
        key: '`exists: keys/AGENTS.md` FAIL',
        text: '**Do not read-then-write this one.** The workspace\'s `Read(./keys/**)` deny rule matches a `keys/` directory at any depth — including the plugin\'s own `templates/keys/`, per the README\'s Security section — so a normal read of the template fails with a confusing denial. Copy the file instead, without ever reading its content into the conversation: `cp "${CLAUDE_PLUGIN_ROOT}/templates/keys/AGENTS.md" <workspace>/keys/AGENTS.md` (PowerShell: `Copy-Item "${CLAUDE_PLUGIN_ROOT}/templates/keys/AGENTS.md" "<workspace>/keys/AGENTS.md"`).',
      },
      {
        key: '`exists: .joserah/directives.md` FAIL',
        text: 'Run `node "${CLAUDE_PLUGIN_ROOT}/tools/migrate.js" <workspace>` — it creates the file from the template with the workspace name filled in and never touches an existing one.',
      },
    ],
    run({ root, cfg }) {
      // `CLAUDE.md` is deliberately NOT required: a workspace carries `AGENTS.md`
      // only, so it is not tied to one vendor's tool (owner, 2026-08-30: "CLAUDE.md
      // dosyası olmasına gerek yok, sonsuza dek claude ile çalışmayabiliriz").
      const required = ['AGENTS.md', '.joserah/desk/tasks/now.md', '.joserah/learned.md',
                        '.joserah/desk/inbox/captures.md', '.joserah/personal/profile.md',
                        '.joserah/agent.md', '.joserah/directives.md'];

      // A hosted workspace runs on the host's accounts and the host's `keys/` by
      // design, so it has no `keys/` of its own and must not be told to grow one.
      if (cfg && cfg.kind !== 'hosted') required.push('keys/AGENTS.md');

      // A remedy is only printed for a file something can actually install again.
      // migrate.js writes .joserah/agent.md and .joserah/directives.md when they
      // are missing (see its R17 block and the directives block after it) and is
      // the only tool that will — scaffold.js refuses to run twice on an existing
      // workspace, and forcing it past that refusal overwrites directives.md and
      // learned.md wholesale, which is the owner's own prose.
      const REQUIRED_REMEDY = {
        '.joserah/agent.md': `missing — run: node tools/migrate.js ${root}`,
        '.joserah/directives.md': `missing — run: node tools/migrate.js ${root}`,
      };

      const out = [];
      for (const f of required) {
        const present = fs.existsSync(path.join(root, f));
        out.push(check(`exists: ${f}`, present, present ? '' : (REQUIRED_REMEDY[f] || '')));
      }
      return out;
    },
  },

  {
    id: 'trust',
    remedies: [],
    // `trust` decides the entire deny set, so it is resolved here — above the
    // settings entry below — for two separate reasons.
    //
    // denyFor throws on a value it does not recognise, and that throw used to
    // land inside the settings block's JSON try/catch: a corrupted trust level
    // was reported as "present but not valid JSON", pointing the owner at the
    // wrong file entirely.
    //
    // And a workspace that is somebody else's memory hosted here (`hosted`) or
    // reached by several people (`shared`) must never have a missing `trust`
    // quietly defaulted to `owner`. That default certified the nine-rule owner
    // set — no machine-control rules at all — as the full expected set, on
    // exactly the workspaces the guest wall exists for.
    //
    // The resolved level is written to `ctx.trust` for the settings entry to
    // read: the order of this array is what guarantees it is there in time, and
    // is why neither entry may be reordered past the other.
    run(ctx) {
      const { cfg } = ctx;
      ctx.trust = null;
      const recorded = cfg ? cfg.trust : undefined;
      // Same question defaultTrustFor answers for scaffold.js's write paths —
      // "which kinds must never have a missing trust silently forgiven?" — but
      // used here to fail loudly instead of to pick a default: reusing it keeps
      // the two tools from ever independently drifting on which kinds those are.
      const needsExplicitTrust = cfg && defaultTrustFor(cfg.kind) === 'guest';
      if (!cfg) {
        // An unreadable config is not a "home" workspace with no trust key — it
        // is a workspace this tool knows nothing about, `kind` included. Saying
        // anything else here would be a claim the file cannot support.
        return check('trust level', false, 'config.json could not be read or parsed — nothing to check it against');
      } else if (recorded === 'owner' || recorded === 'guest') {
        ctx.trust = recorded;
        return check('trust level', true, recorded);
      } else if (recorded === undefined || recorded === null) {
        if (needsExplicitTrust) {
          return check('trust level', false,
            `config.json records no "trust" for a "${cfg.kind}" workspace — it must say "owner" or "guest"; without it the deny set cannot be checked at all`);
        }
        ctx.trust = defaultTrustFor(cfg.kind);
        return check('trust level', true, 'not recorded — a "home" workspace is its owner\'s own');
      }
      return check('trust level', false, `unknown trust level ${JSON.stringify(recorded)} — expected "owner" or "guest"`);
    },
  },

  {
    id: 'claude-settings',
    remedies: [],
    run({ root, cfg, trust }) {
      const settingsPath = path.join(root, '.claude', 'settings.json');
      const createdBy = cfg && cfg.createdByPluginVersion;
      const mandatory = versionAtLeast(createdBy, '0.3.0');
      if (!fs.existsSync(settingsPath)) {
        // Distinct check name (not "(present)") so the skill text that quotes
        // the present-case name verbatim (skills/backup/SKILL.md) stays accurate.
        return check('.claude/settings.json (absent)', !mandatory,
          mandatory
            ? `missing, but this workspace was created by plugin ${createdBy} (>= 0.3.0), which always writes this file — run: scaffold.js --settings-only --target <dir>`
            : `absent — fine, this workspace predates 0.3.0 (created by ${createdBy || 'unknown'}), when .claude/ was not always written`);
      }
      let ok = false, detail = 'present but invalid';
      if (!trust) {
        // Nothing to compare against: saying "ok" here would be the exact
        // false clean report the trust check above exists to prevent.
        detail = 'present, but which rules belong in it cannot be decided — see the trust level check above';
      } else {
        try {
          const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          const deny = (parsed.permissions && parsed.permissions.deny) || [];
          const expected = denyFor(trust, { hostPaths: hostPathsFor(cfg, root) });
          const missing = expected.filter((r) => !deny.includes(r));
          ok = missing.length === 0;
          detail = ok ? `present with the full ${trust} deny set`
                     : `present but missing ${missing.length} rule(s) from the ${trust} deny set: ${missing.join(', ')}`;
        } catch (err) {
          detail = `present but not valid JSON: ${err.message}`;
        }
      }
      return check('.claude/settings.json (present)', ok, detail);
    },
  },

  {
    id: 'legacy-keys',
    remedies: [
      { key: '`no legacy .joserah/keys directory` FAIL', text: 'Run the Migrate section below.' },
    ],
    // I14: .joserah/keys was the pre-0.3.0 credentials location. Unlike the
    // archive and link-check tools — which merely exclude it forever — doctor
    // must fail here: this is the migration signal that tells an owner to move
    // their credentials to keys/ at the workspace root. The detail is gated on
    // the same boolean the check uses, so a healthy workspace's passing line
    // carries no text — a passing check must not read like an active problem.
    run({ root }) {
      const legacy = fs.existsSync(path.join(root, '.joserah', 'keys'));
      return check('no legacy .joserah/keys directory', !legacy,
        legacy ? 'legacy layout — credentials moved to keys/ in 0.3.0; see the doctor skill\'s Migrate section' : '');
    },
  },

  {
    id: 'legacy-knowledge-raw',
    remedies: [
      {
        key: '`legacy .joserah/knowledge/raw present` warn',
        text: 'Run `node "${CLAUDE_PLUGIN_ROOT}/tools/relocate.js" <workspace>` — one command carries the source material from whichever historical location the workspace is frozen at all the way to `imports/` at the workspace root, rewriting the links that cited the old locations. Doctor\'s own `run:` text for this warn is plugin-relative (`node tools/relocate.js ...`) and only resolves from inside the plugin\'s own directory; use the `${CLAUDE_PLUGIN_ROOT}` form above instead.',
      },
    ],
    // Source material used to live under .joserah/knowledge/raw, and later at
    // raw/ in the workspace root; today it lives at imports/. One command,
    // relocate.js, carries a workspace from either old location to today's. This
    // is a warning, not a failure: nothing is broken by leftover files here, but
    // they are stray and easy to miss since nothing else in the workspace still
    // reads this location.
    run({ root }) {
      const legacyRaw = path.join(root, '.joserah', 'knowledge', 'raw');
      if (fs.existsSync(legacyRaw) && fs.readdirSync(legacyRaw).length) {
        return warn('legacy .joserah/knowledge/raw present',
          `source material now lives in imports/ at the workspace root — run: node tools/relocate.js ${root}`);
      }
      return null;
    },
  },

  {
    id: 'legacy-root-raw',
    remedies: [
      {
        key: '`legacy raw/ at the workspace root` warn',
        text: 'Run `node "${CLAUDE_PLUGIN_ROOT}/tools/relocate.js" <workspace>` — the same one command: from a root `raw/` it moves the source material to `imports/`, flattening `raw/imports/`, and rewrites citations.',
      },
    ],
    // 2026-09-12: raw/ at the root was renamed imports/ (owner's decision). A
    // workspace scaffolded between 2026-08-31 and then still has raw/; warning,
    // not failure — the tools still recognise it as a legacy location.
    run({ root }) {
      const legacyRootRaw = path.join(root, 'raw');
      if (fs.existsSync(legacyRootRaw) && fs.readdirSync(legacyRootRaw).some((e) => e !== 'README.md')) {
        return warn('legacy raw/ at the workspace root',
          `source material now lives in imports/ — run: node tools/relocate.js ${root}`);
      }
      return null;
    },
  },

  {
    id: 'role-file',
    remedies: [],
    // JOSERAH-ROLE.md is copied verbatim from templates/roles/ by kind at
    // scaffold time, never re-rendered from config.json. A mismatch here means
    // the workspace was scaffolded under one role and its `kind` was changed
    // afterwards without re-scaffolding — the same class of drift the
    // verify-links.js check below catches for a different file.
    run({ root, cfg, pluginDir, normalizeEol }) {
      const rolePath = path.join(root, 'JOSERAH-ROLE.md');
      const role = roleFor(cfg && cfg.kind);
      const templatePath = path.join(pluginDir, '..', 'templates', 'roles', `joserah-${role}.md`);
      let ok = false, detail;
      if (!fs.existsSync(rolePath)) {
        // Never scaffold.js: that command cannot run as printed on a workspace
        // that already exists, and forcing it past its own refusal makes
        // copyTree overwrite .joserah/directives.md and .joserah/learned.md
        // wholesale — the owner's standing rules, which the note scan itself
        // calls immutable. migrate.js installs this file and touches nothing
        // else, so it is the only safe remedy to hand an agent.
        detail = `missing — run: node tools/migrate.js ${root}`;
      } else {
        // R20: same cause as the verify-links.js check below — a workspace with
        // no .gitattributes checks this file out as CRLF on Windows with
        // autocrlf=true while the plugin's template on disk stays LF, so the
        // comparison runs through the shared normalizeEol helper too. A genuine
        // role mismatch (kind changed after scaffolding) still differs once
        // normalised, so this still catches the case the check exists for.
        ok = normalizeEol(fs.readFileSync(rolePath, 'utf8')) === normalizeEol(fs.readFileSync(templatePath, 'utf8'));
        detail = ok ? '' : `does not match the "${role}" role template for kind "${(cfg && cfg.kind) || 'home'}" — was kind changed after scaffolding? Delete it and run: node tools/migrate.js ${root}`;
      }
      return check('exists: JOSERAH-ROLE.md', ok, detail);
    },
  },

  {
    id: 'agent-overlay',
    remedies: [],
    // R11: the session-start hook injects only the text sitting below this exact
    // marker (see AGENT_OVERLAY_MARKER in doctor.js) — an owner who hand-edits
    // .joserah/agent.md and loses the marker gets a permanent, silent no-op,
    // while every check above this one still reports the file as present. Non-
    // fatal: a rewritten agent.md is the owner's own call, not a doctor failure,
    // so `ok` here is unconditional — only the detail carries the finding, gated
    // on the same boolean, so a healthy workspace's line reads clean.
    run({ root, AGENT_OVERLAY_MARKER }) {
      const agentPath = path.join(root, '.joserah', 'agent.md');
      if (fs.existsSync(agentPath)) {
        const hasMarker = fs.readFileSync(agentPath, 'utf8').includes(AGENT_OVERLAY_MARKER);
        return check('agent.md overlay marker present', true,
          hasMarker ? '' : 'missing — the session-start hook injects only text below this marker, so nothing in this file reaches any session right now');
      }
      return null;
    },
  },

  {
    id: 'standing-context-size',
    remedies: [
      {
        key: '`standing context size` warn',
        text: 'Nothing is broken: it means every session now starts by reading more than it comfortably should, before a word of the actual work. Say the number in plain words and offer to prune `.joserah/directives.md` — keep the rules that must hold in *every* session, move the detail into `.joserah/knowledge/` notes that can be read when they are needed, and delete what stopped being true. Never edit that file without the owner: it is theirs. Left alone it eventually passes the injector\'s per-file cap, and a file over that cap arrives cut short (with a `[cut]` line saying so).',
      },
    ],
    // 0.7.0: JOSERAH-ROLE.md and .joserah/directives.md are injected into every
    // session instead of being pointed at. The directives file is the owner's
    // and grows, and nothing else in the workspace would ever tell them what
    // that costs — so the size of everything a session is handed before it
    // starts is reported on every run, and warned about while every layer is
    // still whole (see WARN_TOTAL_CHARS, which is deliberately below
    // "AGENTS.md + one file at the cap"). Informational, never a failure: a
    // long rule set is the owner's own call, not a broken workspace.
    run({ root }) {
      const { total, parts } = standingContextSize(root);
      const breakdown = parts.map(([name, len]) => `${name} ${len}`).join(', ');
      const detail = `${total} characters reach every session before any work (${breakdown})`;
      if (total > WARN_TOTAL_CHARS) {
        return warn('standing context size',
          `${detail} — past ${WARN_TOTAL_CHARS}; prune .joserah/directives.md, keeping only what must hold in every session`);
      }
      return check('standing context size', true, detail);
    },
  },

  {
    id: 'feedback-notes',
    remedies: [],
    // Step 4/Task 19: informational only, like the check above — an unreported
    // feedback note is something to look at, not a broken workspace. Absent
    // .joserah/feedback/ prints nothing at all rather than a "0 notes" line no
    // one asked for.
    run({ root }) {
      const feedbackDir = path.join(root, '.joserah', 'feedback');
      if (fs.existsSync(feedbackDir)) {
        const counts = FEEDBACK_AREAS.map((area) => {
          const areaDir = path.join(feedbackDir, area);
          if (!fs.existsSync(areaDir)) return `${area}: 0 unreported`;
          const unreported = fs.readdirSync(areaDir).filter((f) => {
            if (!f.endsWith('.md')) return false;
            const { data } = parseFrontmatter(fs.readFileSync(path.join(areaDir, f), 'utf8'));
            return !data.reported || data.reported === 'null';
          }).length;
          return `${area}: ${unreported} unreported`;
        });
        return check('feedback notes', true, counts.join(', '));
      }
      return null;
    },
  },

  {
    id: 'workspace-version',
    remedies: [],
    // Informational only: a workspace merely created by an older plugin version
    // is not itself unhealthy. The behavioral drift that version could cause is
    // caught by the two checks around this one (legacy keys dir, verify-links.js
    // drift), not by this one.
    // BOM-tolerant read, matching scaffold.js's readJson — PowerShell redirection
    // and some Windows editors write a leading BOM that JSON.parse rejects.
    run({ cfg, pluginDir }) {
      const pluginVersion = JSON.parse(
        fs.readFileSync(path.join(pluginDir, '..', '.claude-plugin', 'plugin.json'), 'utf8')
          .replace(/^﻿/, '')).version;
      return check('workspace/plugin version', true,
        `workspace created by ${cfg && cfg.createdByPluginVersion || 'unknown'}, plugin is ${pluginVersion}`);
    },
  },

  {
    id: 'format-version',
    remedies: [],
    run({ root, cfg }) {
      const fv = cfg && cfg.formatVersion;
      return check('format version', fv === FORMAT_VERSION,
        fv === FORMAT_VERSION
          ? `workspace is on format v${FORMAT_VERSION}`
          : `workspace is on format v${fv || 1}, current is v${FORMAT_VERSION} — run: node tools/migrate.js ${root}`);
    },
  },

  {
    id: 'prompt',
    remedies: [
      {
        key: '`prompt (AGENTS.md) current` FAIL — *behind*',
        text: 'Run `node "${CLAUDE_PLUGIN_ROOT}/tools/refresh-prompt.js" <workspace>`. Then tell the owner a **new conversation** is enough — no restart.',
      },
      {
        key: '`prompt (AGENTS.md) current` FAIL — *hand-edited* or *no install record and differs*',
        text: 'Do not overwrite. Follow `/joserah:update` step 4: show the owner what differs, move their lines to `.joserah/directives.md`, then `refresh-prompt.js <workspace> --force` on their yes — the displaced text is kept as `AGENTS.md.replaced-<date>` beside it.',
      },
      {
        key: '`prompt (AGENTS.md) current` warn — *matches but nothing recorded it*',
        text: 'Run `refresh-prompt.js <workspace>` — it only writes the record.',
      },
    ],
    // AGENTS.md is plugin-owned and versioned apart from the plugin (lib/prompt.js):
    // its sha is recorded at install time, so this can tell "behind" (bytes still
    // match the record, a newer prompt exists) from "hand-edited" (bytes differ
    // from the record) — and only the first is safe to overwrite. Skipped when the
    // file is missing: the `exists: AGENTS.md` check above already fails for that.
    // The prompt state is resolved once by the runner and handed in, because the
    // prompt-source-drift entry below reads the same three values.
    run({ root, prompt }) {
      const { source, st, srcName } = prompt;
      if (st.state === 'missing') return null;
      if (!source) {
        return check('prompt (AGENTS.md) current', false,
          'no prompt source found — neither the marketplace clone nor this plugin carries a versioned templates/AGENTS.md');
      } else if (st.state === 'current') {
        return check('prompt (AGENTS.md) current', true, `v${st.version} (${source.kind})`);
      } else if (st.state === 'behind') {
        return check('prompt (AGENTS.md) current', false,
          `v${st.version === null ? '?' : st.version}, ${srcName} has v${source.version} — run: node tools/refresh-prompt.js ${root}`);
      } else if (st.state === 'hand-edited') {
        return check('prompt (AGENTS.md) current', false,
          `hand-edited — differs from the recorded install (v${st.recordedVersion}); move what matters to .joserah/directives.md, then run: node tools/refresh-prompt.js ${root} --force`);
      } else if (st.state === 'unrecorded' && st.matchesSource) {
        return warn('prompt (AGENTS.md) current',
          `matches v${source.version} but nothing recorded it — run: node tools/refresh-prompt.js ${root} (records only)`);
      }
      return check('prompt (AGENTS.md) current', false,
        `no install record and differs from the current prompt (${srcName} v${source.version}) — predates prompt versioning or hand-edited; compare, move what matters to .joserah/directives.md, then run: node tools/refresh-prompt.js ${root} --force`);
    },
  },

  {
    id: 'prompt-source-drift',
    remedies: [
      {
        key: '`prompt source drift` warn',
        text: "A developer's slip, not the owner's: the prompt text changed without its version line. Report it via `/joserah:feedback`; nothing to do in the workspace.",
      },
    ],
    // A developer's slip, not an owner's problem: the source text changed
    // but its version line did not, so no workspace will ever see it as
    // behind. Informational — the owner cannot fix it, but should not be
    // told everything is current when it is not.
    run({ prompt }) {
      const { source, st, srcName } = prompt;
      if (source && st.state === 'current' && !st.matchesSource) {
        return warn('prompt source drift',
          `${srcName} v${source.version} differs from the installed v${st.version} without a version bump — bump the prompt-version line in templates/AGENTS.md`);
      }
      return null;
    },
  },

  {
    id: 'local-verify-links',
    remedies: [
      {
        key: '`local verify-links.js current` FAIL',
        text: 'Copy **both** plugin files over the workspace\'s copies — `tools/verify-links.js` → `.joserah/tools/verify-links.js` and `tools/lib/untouchable.js` → `.joserah/tools/lib/untouchable.js` (the checker requires the library, so it only works if both travel) — then re-run doctor.',
      },
    ],
    // G1/K4-mech: the workspace's own copy of verify-links.js is written once at
    // scaffold time and never updated by anything after that. If it has drifted
    // from the plugin's copy, it can silently stop checking what it claims to —
    // which is exactly what happened before this check existed. This is name-
    // based directory matching (see the placeholder walk below), not a
    // substitute for the legacy-keys check above.
    //
    // Two files travel that way, not one: verify-links.js and the
    // lib/untouchable.js it requires, which scaffold.js copies next to it. Both
    // are checked here, under the one check name the doctor and update skills and
    // tests/doctor.test.js key off.
    run({ root, pluginDir, normalizeEol }) {
      const pairs = [
        ['verify-links.js', path.join(root, '.joserah', 'tools', 'verify-links.js'), path.join(pluginDir, 'verify-links.js')],
        ['lib/untouchable.js', path.join(root, '.joserah', 'tools', 'lib', 'untouchable.js'), path.join(pluginDir, 'lib', 'untouchable.js')],
      ];
      // A workspace with no .gitattributes of its own (pre-R18, or restored from
      // a backup taken before it) checks out under whatever the owner's global
      // core.autocrlf says. On Windows with autocrlf=true — the plugin's own
      // target platform — git rewrites the checkout to CRLF while this file's
      // canonical copy on disk stays LF, so a copy re-taken minutes ago still
      // differs byte-for-byte from the plugin's copy, on every such workspace, always.
      // That is a checkout convention, not evidence of staleness, so the
      // comparison runs through the shared normalizeEol above (R20) — same
      // helper, same reason, as the JOSERAH-ROLE.md check; a genuine content
      // difference still differs after normalising and still fails below.
      const problems = [];
      for (const [label, localPath, canonicalPath] of pairs) {
        if (!fs.existsSync(localPath)) { problems.push(`${label} missing`); continue; }
        if (normalizeEol(fs.readFileSync(localPath, 'utf8')) !== normalizeEol(fs.readFileSync(canonicalPath, 'utf8'))) {
          problems.push(`${label} stale`);
        }
      }
      return check('local verify-links.js current', problems.length === 0,
        problems.length
          ? `${problems.join(', ')} — re-copy tools/verify-links.js and tools/lib/untouchable.js from the plugin`
          : 'matches the plugin copy');
    },
  },

  {
    id: 'placeholders',
    remedies: [
      { key: 'Unfilled placeholder', text: 'Ask for the value, then substitute it' },
    ],
    // The scan must ignore {{PLACEHOLDER}}-shaped text inside fenced/inline code —
    // plan and design docs legitimately *discuss* the templating mechanism (e.g.
    // a ```js block showing '{{OWNER_NAME}}': owner, or backticked
    // `{{OWNER_ROLE_LINE}}` in prose), and an owner cannot "fix" their own
    // documentation to clear a false alarm. stripCode below is duplicated from
    // verify-links.js rather than shared: scaffold.js copies verify-links.js into
    // every workspace with only lib/untouchable.js beside it, and the drift
    // check above compares both copies byte-for-byte against the plugin's — a
    // require() of any other shared helper would fail to resolve in every
    // workspace and break both the link check and the drift check.
    // The skip list is WALK_SKIP_NAMES from lib/untouchable.js, handed in on ctx
    // as the second argument because this walk runs in its own `node -e` process
    // and cannot require the library: bare directory names matched at ANY depth,
    // so a nested knowledge/projects/ stays out of the scan exactly as before.
    // Under `node -e <src> a b`, process.argv[1] is `a` and process.argv[2] is
    // `b`, so `root` keeps its place.
    run({ root, WALK_SKIP_NAMES }) {
      const leftover = spawnSync('node', ['-e', `
  const fs=require('fs'),path=require('path');let hits=0;
  const SKIP=JSON.parse(process.argv[2]);
  function stripCode(t){return t.replace(/\`\`\`[\\s\\S]*?\`\`\`/g,m=>m.replace(/[^\\n]/g,' ')).replace(/\`[^\`\\n]*\`/g,m=>' '.repeat(m.length));}
  (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
    if(e.isDirectory()){if(!SKIP.includes(e.name))walk(path.join(d,e.name));}
    else if(e.name.endsWith('.md')&&/{{[A-Z_]+}}/.test(stripCode(fs.readFileSync(path.join(d,e.name),'utf8'))))hits++;}})(process.argv[1]);
  console.log(hits);`, root, JSON.stringify(WALK_SKIP_NAMES)], { encoding: 'utf8' });
      return check('no unfilled {{placeholders}}', leftover.stdout.trim() === '0', `${leftover.stdout.trim()} file(s)`);
    },
  },

  {
    id: 'links',
    remedies: [
      { key: 'Broken link', text: 'Find the moved target and repoint the link' },
    ],
    // M3/K4-mech: run the plugin's own copy, never the workspace's — a stale or
    // missing workspace copy must never blind this check or get blamed for
    // broken links it never looked for.
    run({ root, pluginDir }) {
      const links = spawnSync('node', [path.join(pluginDir, 'verify-links.js'), root], { encoding: 'utf8' });
      return check('internal links resolve', links.status === 0, (links.stdout || '').trim().split('\n')[0]);
    },
  },

  {
    id: 'claims',
    remedies: [
      {
        key: '`typed claims consistent` FAIL',
        text: 'Open the named file and line. A measurement gets its `condition:` (hardware, engine, settings, date); a struck line gets `superseded:` naming its successor; a calculation beside a measurement of the same subject is struck and pointed at it. Re-run doctor.',
      },
    ],
    // Typed claims (design 2026-09-12): a measurement without its conditions is
    // the exact record shape that produced a wrong answer to the owner, so it is
    // a failure, not a warning. check-claims.js prints its own summary line last.
    run({ root, pluginDir }) {
      const claims = spawnSync(process.execPath, [path.join(pluginDir, 'check-claims.js'), root], { encoding: 'utf8' });
      const lines = (claims.stdout || '').trim().split('\n').filter(Boolean);
      return check('typed claims consistent', claims.status === 0,
        claims.status === 0 ? (lines[lines.length - 1] || '') : (lines[0] || (claims.stderr || '').trim()));
    },
  },

  {
    id: 'bash-for-hooks',
    remedies: [],
    // G3/I12: the plugin's hooks are declared with shell:"bash". On Windows that
    // silently never fires without Git for Windows on PATH — the single most
    // common Windows failure mode, and nothing else in this tool would ever
    // surface it.
    run() {
      if (process.platform !== 'win32') return null;
      const bash = spawnSync('bash', ['--version'], { encoding: 'utf8' });
      return check('bash available for hooks', bash.status === 0,
        bash.status === 0 ? (bash.stdout.split('\n')[0] || '').trim()
          : 'not found — the plugin\'s hooks are declared with shell:"bash" and will NEVER fire; install Git for Windows');
    },
  },

  {
    id: 'project-backups',
    remedies: [
      {
        key: '`projects/<Owner>/<Project>` warn (no repository of its own / no remote / N commit(s) not pushed)',
        text: 'Not something doctor can fix by itself — it means no copy of that work exists anywhere else, or its history is incomplete everywhere but this machine. Say so plainly and ask the owner whether to `git init`, add a remote, or push, from inside that project\'s own directory — never proceed as if the workspace were fully backed up while one of these is open.',
      },
    ],
    // P3-3 + P0-1: audit every projects/{Owner}/{Project} (or projects/{Owner}
    // with no second level) directory for whether it is actually backed up
    // anywhere. This is the check the backup skill (Task 7) points owners at
    // instead of duplicating: `git -C <dir> remote get-url origin` answers for
    // the nearest ANCESTOR repository when <dir> is not a repository of its own,
    // which once made the backup manifest claim a project was backed up by the
    // workspace's own remote when no copy of that project's work existed
    // anywhere else. `rev-parse --show-toplevel` is the guard: only when it
    // prints <dir> itself is any other git command run there trustworthy.
    // (gitIn is at the top of this file, beside the other shared helpers.)
    run({ root }) {
      // Shared with secret-scan.js and measure-stage.js — see its comment for why
      // the drive-letter case matters here.
      const { sameRepoPath } = require('./git-root');
      const projectsDir = path.join(root, 'projects');
      const gitOk = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
      const out = [];
      if (gitOk && fs.existsSync(projectsDir)) {
        const level1 = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
        for (const owner of level1) {
          const ownerDir = path.join(projectsDir, owner.name);
          // A project can sit directly at projects/<Name> as a repo in its own
          // right — its working tree already contains a `.git` directory, so it
          // never has zero subdirectories, and treating its subdirectories as
          // candidates would audit a repo's own internals (`.git`, `docs/`, ...) as
          // if they were separate unbacked projects while never checking the repo
          // itself. So: only descend into the Owner/Project layout when the owner
          // directory is NOT itself a repository of its own.
          const ownerTop = gitIn(ownerDir, ['rev-parse', '--show-toplevel']);
          const ownerIsRepo = ownerTop !== null && sameRepoPath(ownerTop, ownerDir);
          let candidates;
          if (ownerIsRepo) {
            candidates = [ownerDir];
          } else {
            const entries = fs.readdirSync(ownerDir, { withFileTypes: true }).filter((e) => e.isDirectory());
            candidates = entries.length ? entries.map((e) => path.join(ownerDir, e.name)) : [ownerDir];
          }
          for (const dir of candidates) {
            const rel = path.relative(root, dir).split(path.sep).join('/');
            // A directory is a repository of its own ONLY if git names it as its own
            // toplevel. Anything else means git is answering for an ancestor — the
            // exact lie the backup manifest once told (P0-1).
            const top = gitIn(dir, ['rev-parse', '--show-toplevel']);
            const isOwnRepo = top !== null && sameRepoPath(top, dir);
            if (!isOwnRepo) { out.push(warn(`${rel}`, 'no repository of its own — no copy of this work exists anywhere else')); continue; }
            const remote = gitIn(dir, ['remote', 'get-url', 'origin']);
            if (!remote) { out.push(warn(`${rel}`, 'repository with no remote — history exists only on this machine')); continue; }
            const unpushed = gitIn(dir, ['log', '--branches', '--not', '--remotes', '--oneline']);
            if (unpushed) out.push(warn(`${rel}`, `${unpushed.split('\n').length} commit(s) not pushed to ${remote}`));
          }
        }
      }
      return out;
    },
  },
];

module.exports = { CHECKS };
