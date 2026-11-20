'use strict';
// Joserah Connect: optional Windows firewall helper. Nothing depends on it: messages arrive without an
// open inbound port. It never elevates: without admin rights it writes a .bat for the person to run as administrator.
const fs = require('fs');
const path = require('path');

const TIMEOUT_MS = 15000;
const ADD_BAT = 'connect-firewall-add.bat';
const REMOVE_BAT = 'connect-firewall-remove.bat';

function checkPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port: ' + String(port));
  return port;
}
const ruleName = (port) => 'Joserah Connect ' + port;

// default runner: the only child_process use in Connect. Resolves { code, stdout }, never rejects.
function defaultRun(cmd, args, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    require('child_process').execFile(cmd, args, { windowsHide: true, timeout: timeoutMs }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout || '') });
    });
  });
}

function withTimeout(p, ms) {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out')), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

async function check(port, { run = defaultRun, platform = process.platform, timeoutMs = TIMEOUT_MS } = {}) {
  checkPort(port);
  if (platform !== 'win32') return { state: 'unknown', reason: 'not Windows' };
  const ps = "@(Get-NetFirewallPortFilter -Protocol TCP | Where-Object LocalPort -eq " + port +
    " | Get-NetFirewallRule | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }).Count";
  try {
    const r = await withTimeout(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]), timeoutMs);
    const n = /^\d+$/.test(String(r && r.stdout).trim()) ? Number(String(r.stdout).trim()) : NaN;
    if (!r || r.code !== 0 || Number.isNaN(n)) return { state: 'unknown', reason: 'firewall query failed' };
    return n > 0 ? { state: 'open', reason: 'an enabled inbound allow rule exists' }
      : { state: 'closed', reason: 'no enabled inbound allow rule for this port' };
  } catch (e) {
    return { state: 'unknown', reason: 'firewall query failed: ' + e.message };
  }
}

async function isAdmin({ run = defaultRun, platform = process.platform } = {}) {
  if (platform !== 'win32') return false;
  try { return (await run('fltmc', [])).code === 0; } catch { return false; }
}

async function addRule(port, { run = defaultRun } = {}) {
  checkPort(port);
  try {
    const r = await run('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=' + ruleName(port),
      'dir=in', 'action=allow', 'protocol=TCP', 'localport=' + port, 'profile=any']);
    return r.code === 0;
  } catch { return false; }
}

function writeBat(dir, port) {
  checkPort(port);
  const name = ruleName(port);
  const crlf = (lines) => lines.join('\r\n') + '\r\n';
  const add = path.join(dir, ADD_BAT);
  const remove = path.join(dir, REMOVE_BAT);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(add, crlf([
    '@echo off',
    'REM Joserah Connect: allow incoming TCP port ' + port + ' through the Windows firewall (optional).',
    'REM Run as administrator. Undo with ' + REMOVE_BAT + '.',
    'netsh advfirewall firewall delete rule name="' + name + '" >nul 2>&1',
    'netsh advfirewall firewall add rule name="' + name + '" dir=in action=allow protocol=TCP localport=' + port + ' profile=any',
    'pause',
  ]), 'latin1');
  fs.writeFileSync(remove, crlf([
    '@echo off',
    'REM Joserah Connect: remove the firewall rule for TCP port ' + port + '. Run as administrator.',
    'netsh advfirewall firewall delete rule name="' + name + '"',
    'pause',
  ]), 'latin1');
  return { add, remove };
}

async function ensure(dir, port, opts = {}) {
  checkPort(port);
  const c = await check(port, opts);
  if (c.state === 'open') return { state: 'open' };
  if (c.state !== 'closed') return { state: 'unknown' };
  if (await isAdmin(opts) && await addRule(port, opts) && (await check(port, opts)).state === 'open') return { state: 'added' };
  const { add, remove } = writeBat(dir, port);
  return {
    state: 'bat', bat: add,
    say: 'Ask the person, in their own language, to right-click the file ' + add + ' and choose "Run as administrator" ' +
      'to open the Windows firewall for Joserah Connect; this is optional and messages already arrive without it, ' +
      'and running ' + remove + ' as administrator removes the rule again.',
  };
}

module.exports = { check, isAdmin, addRule, writeBat, ensure };
