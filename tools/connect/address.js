'use strict';
// Joserah Connect addresses: person/device/session. `person` = every paired device of that person,
// `person/device` = that device's shared inbox, `person/device/session` = one session there.
const { validPeerName } = require('./store');

const ok = (s) => validPeerName(s) && !/^\.+$/.test(s); // '.' and '..' pass the name pattern, never as a segment

// -> { person, device, session } (absent parts null), or null when the address is not valid.
function parse(address) {
  if (typeof address !== 'string') return null;
  const seg = address.split('/');
  if (seg.length > 3 || !seg.every(ok)) return null;
  return { person: seg[0], device: seg[1] || null, session: seg[2] || null };
}

// peers is peers.json: { key: { person?, device?, ... } } -> [{ peer: key, to: session|null }].
// A flat v1 name (the key itself) still resolves; a record with no person yet matches on device or key alone.
function targets(address, peers) {
  const a = parse(address);
  if (!a || !peers || typeof peers !== 'object') return [];
  const rows = Object.entries(peers).filter(([, r]) => r && typeof r === 'object');
  const to = a.session;
  let hit;
  if (!a.device) {
    hit = rows.filter(([k, r]) => k === a.person || r.device === a.person);
    if (!hit.length) hit = rows.filter(([, r]) => r.person === a.person);
  } else {
    hit = rows.filter(([k, r]) => (r.person ? r.person === a.person && (r.device || k) === a.device : (r.device || k) === a.device || k === a.device));
  }
  return hit.map(([peer]) => ({ peer, to }));
}

module.exports = { parse, targets };
