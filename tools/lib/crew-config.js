'use strict';
// Resolves the `crew` block of .joserah/config.json into the five role
// definitions the generator (tools/crew.js) writes. Off by default (owner,
// 2026-10-05): no `crew` key means off; `"crew": true` means on with defaults;
// a block of overrides means on unless it says `"enabled": false`; `"crew": false`
// is off. `devMode` is a
// top-level key and decides only whether the owner sees the crew.
// A typo is an error that names the key, never a silent fallback to defaults.

const ROLES = ['lead', 'architect', 'builder', 'scout', 'sentry'];
const EFFORTS = ['low', 'medium', 'high'];
const FIELDS = ['model', 'effort'];
const DEFAULTS = {
  lead: { model: 'opus', effort: 'medium' }, architect: { model: 'opus', effort: 'high' },
  builder: { model: 'opus', effort: 'high' }, scout: { model: 'sonnet', effort: 'medium' },
  sentry: { model: 'haiku', effort: 'low' },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function resolveCrew(cfg = {}) {
  const block = cfg.crew;
  const devMode = cfg.devMode === true;
  if (block === undefined || block === false) return { enabled: false, devMode, roles: clone(DEFAULTS) };
  if (block !== true && !isObj(block)) throw new Error('crew: must be true, false or an object');
  const b = block === true ? {} : block;
  for (const k of Object.keys(b)) {
    if (k !== 'enabled' && !ROLES.includes(k)) throw new Error(`crew: unknown role "${k}"`);
  }
  const roles = {};
  for (const r of ROLES) {
    const o = b[r] === undefined ? {} : b[r];
    if (!isObj(o)) throw new Error(`crew.${r}: must be an object`);
    for (const k of Object.keys(o)) {
      if (!FIELDS.includes(k)) throw new Error(`crew.${r}: unknown field "${k}"`);
    }
    const effort = o.effort ?? DEFAULTS[r].effort;
    if (!EFFORTS.includes(effort)) throw new Error(`crew.${r}: unknown effort "${effort}"`);
    const model = o.model ?? DEFAULTS[r].model;
    if (typeof model !== 'string' || !/^[\w.:\[\]-]+$/.test(model)) throw new Error(`crew.${r}: bad model "${model}"`);
    roles[r] = { model, effort };
  }
  return { enabled: b.enabled !== false, devMode, roles };
}

module.exports = { resolveCrew, ROLES, EFFORTS, DEFAULTS };
