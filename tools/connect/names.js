'use strict';
// Joserah Connect: find the machine of a person named in words ("Serkan ile bağlan"). Three sources, asked in order by
// api.pair: 1) peers already paired, 2) a `connect: <address>` line on that person's page in a joined shared memory,
// 3) the Tailscale peers (only when `tailscale` exists). Each returns [{ source, label, address, ... }]. Nothing here
// pairs or sends anything; what a page or a peer list says is only ever an address to try, checked for its shape.
const fs = require('fs');
const net = require('net');
const path = require('path');
const { slug } = require('./device');

const words = (s) => { const t = slug(String(s || '')); return t ? t.split('-') : []; };
// Every word of the query is a whole word of the value ("Serkan Atay" matches serkan-adem-atay; "Serk" does not).
function matchName(query, value) {
  const q = words(query);
  if (!q.length) return false;
  const v = new Set(words(value));
  return q.every((w) => v.has(w));
}

// host, host:port, 1.2.3.4:port, [::1]:port; a host is an IP or letters/digits/dots/hyphens. -> true/false
function validAddress(a) {
  const m = /^\[([0-9A-Fa-f:.]+)\](?::(\d{1,5}))?$/.exec(a) || /^([A-Za-z0-9.-]+|[0-9A-Fa-f:]+)(?::(\d{1,5}))?$/.exec(a);
  if (!m || (m[2] !== undefined && Number(m[2]) > 65535)) return false;
  const host = m[1];
  return !!net.isIP(host) || /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(host);
}
// An argument that already is an address, not a name: an IP, host:port, or a dotted host name.
function looksLikeAddress(s) {
  const t = String(s || '').trim();
  if (/\s/.test(t) || !validAddress(t)) return false;
  return !!net.isIP(t) || /^\[/.test(t) || /:\d+$/.test(t) || /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(t);
}

const addressOf = (name, p) => (p && p.person && p.device ? p.person + '/' + p.device : name);

// 1) paired peers: person, device or key matches.
function fromPeers(query, peers) {
  const out = [];
  for (const [name, p] of Object.entries(peers || {})) {
    if (!p || typeof p !== 'object') continue;
    if ([p.person, p.device, name].some((v) => v && matchName(query, v))) out.push({ source: 'paired', name, address: addressOf(name, p), label: addressOf(name, p) });
  }
  return out;
}

// 2) `connect: <address>` lines on pages in <workspace>/<shared path>/knowledge/people/*.md of the memories the workspace
// joined (config.json `shared`). The address is the whole value, optionally followed by a (note) or - note.
const CONNECT = /^[ \t]*(?:[-*][ \t]+)?connect:[ \t]*([A-Za-z0-9._:[\]-]+)(?:[ \t]*(?:\(.*\)|[-–—#].*))?[ \t]*$/gim;
function fromShared(ws, query) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(path.join(ws, '.joserah', 'config.json'), 'utf8')); } catch { return []; }
  const seen = new Set(); const out = [];
  const base = path.resolve(ws, '.joserah', 'shared');
  for (const m of Array.isArray(cfg.shared) ? cfg.shared : []) {
    if (!m || typeof m.name !== 'string' || typeof m.path !== 'string') continue;
    const dir = path.resolve(ws, m.path, 'knowledge', 'people');
    if (!dir.startsWith(base + path.sep)) continue; // a memory lives under .joserah/shared
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).slice(0, 500); } catch { continue; }
    for (const f of files) {
      let text;
      try { text = fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 64 * 1024); } catch { continue; }
      const title = (/^#[ \t]+(.+)$/m.exec(text) || [])[1];
      const fm = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(text) || [])[1] || '';
      const fmName = (/^(?:name|title):[ \t]*(.+)$/m.exec(fm) || [])[1];
      const who = [f.replace(/\.md$/, ''), title, fmName].filter(Boolean);
      if (!who.some((w) => matchName(query, w))) continue;
      for (const c of text.matchAll(CONNECT)) {
        if (!validAddress(c[1]) || seen.has(c[1])) continue;
        seen.add(c[1]);
        out.push({ source: 'shared memory ' + m.name, address: c[1], label: (title || fmName || f.replace(/\.md$/, '')) + ' (' + m.name + ' people page)' });
      }
    }
  }
  return out;
}

// 3) `tailscale status --json`, or null when tailscale is not there, not running or answers nothing usable. Never throws.
function tailscaleStatus({ bin, timeout = 4000 } = {}) {
  const { execFileSync } = require('child_process');
  const tries = bin ? [bin] : ['tailscale', ...(process.platform === 'win32' ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe')] : [])];
  for (const b of tries) {
    try {
      const j = JSON.parse(execFileSync(b, ['status', '--json'], { encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }));
      return j && typeof j === 'object' ? j : null;
    } catch { /* not installed here, or not answering: try the next */ }
  }
  return null;
}
function fromTailscale(query, status) {
  if (!status || typeof status !== 'object' || !status.Peer || typeof status.Peer !== 'object') return [];
  const out = [];
  for (const p of Object.values(status.Peer)) {
    if (!p || typeof p !== 'object') continue;
    const user = (status.User && status.User[p.UserID]) || {};
    const login = typeof user.LoginName === 'string' ? user.LoginName.split('@')[0] : '';
    const dns = typeof p.DNSName === 'string' ? p.DNSName.split('.')[0] : '';
    if (![p.HostName, dns, user.DisplayName, login].some((v) => v && matchName(query, v))) continue;
    const ips = (Array.isArray(p.TailscaleIPs) ? p.TailscaleIPs : []).filter((i) => net.isIP(i));
    const address = ips.find((i) => net.isIPv4(i)) || ips[0];
    if (!address) continue;
    out.push({ source: 'tailscale', address, label: [p.HostName || dns, user.DisplayName && '(' + user.DisplayName + ')', p.Online === false && '- offline'].filter(Boolean).join(' ') });
  }
  return out;
}

module.exports = { matchName, validAddress, looksLikeAddress, fromPeers, fromShared, tailscaleStatus, fromTailscale };
