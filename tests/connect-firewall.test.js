'use strict';
// Joserah Connect: optional Windows firewall helper. Only a fake `run` and a temp dir are used:
// no test ever runs netsh/PowerShell or touches the real firewall.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, PLUGIN_ROOT } = require('./helpers');

const C = path.join(PLUGIN_ROOT, 'tools', 'connect');
const fw = require(path.join(C, 'firewall.js'));
const T = { timeout: 20000 };
const WIN = 'win32';

// fake run: `rules` = what the PowerShell check prints, `admin` = exit code of the admin probe
function fake({ rules = '0', admin = 1, addCode = 0 } = {}) {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const line = [cmd, ...args].join(' ');
    if (/netsh/i.test(cmd) && args.includes('add')) return { code: addCode, stdout: 'Ok.' };
    if (/net(\.exe)?$/i.test(cmd) || /fltmc/i.test(cmd)) return { code: admin, stdout: '' };
    if (/powershell/i.test(cmd)) return { code: 0, stdout: rules + '\r\n' };
    throw new Error('unexpected command: ' + line);
  };
  return { run, calls };
}
const adds = (calls) => calls.filter((c) => /netsh/i.test(c[0]) && c.includes('add'));

test('check: open when an enabled inbound allow rule exists', T, async () => {
  const f = fake({ rules: '1' });
  const r = await fw.check(4790, { run: f.run, platform: WIN });
  assert.strictEqual(r.state, 'open');
  assert.ok(r.reason);
});

test('check: closed when no rule matches', T, async () => {
  const f = fake({ rules: '0' });
  assert.strictEqual((await fw.check(4790, { run: f.run, platform: WIN })).state, 'closed');
});

test('check: non-Windows is unknown and runs nothing', T, async () => {
  const f = fake();
  const r = await fw.check(4790, { run: f.run, platform: 'linux' });
  assert.strictEqual(r.state, 'unknown');
  assert.match(r.reason, /not Windows/);
  assert.strictEqual(f.calls.length, 0);
});

test('check: error, throw and bad output are unknown', T, async () => {
  const bad = [
    async () => ({ code: 1, stdout: '' }),
    async () => { throw new Error('timed out'); },
    async () => ({ code: 0, stdout: 'garbage' }),
  ];
  for (const run of bad) assert.strictEqual((await fw.check(4790, { run, platform: WIN })).state, 'unknown');
});

test('check: a run that never answers becomes unknown after the timeout', T, async () => {
  const run = () => new Promise(() => {});
  const r = await fw.check(4790, { run, platform: WIN, timeoutMs: 50 });
  assert.strictEqual(r.state, 'unknown');
});

test('isAdmin: exit 0 is admin; non-zero, throw and non-Windows are not', T, async () => {
  assert.strictEqual(await fw.isAdmin({ run: fake({ admin: 0 }).run, platform: WIN }), true);
  assert.strictEqual(await fw.isAdmin({ run: fake({ admin: 2 }).run, platform: WIN }), false);
  assert.strictEqual(await fw.isAdmin({ run: async () => { throw new Error('x'); }, platform: WIN }), false);
  const f = fake({ admin: 0 });
  assert.strictEqual(await fw.isAdmin({ run: f.run, platform: 'darwin' }), false);
  assert.strictEqual(f.calls.length, 0);
});

test('addRule: runs netsh with the exact rule and reports success', T, async () => {
  const f = fake();
  assert.strictEqual(await fw.addRule(4790, { run: f.run }), true);
  const [cmd, ...args] = adds(f.calls)[0];
  assert.match(cmd, /netsh/i);
  assert.deepStrictEqual(args, ['advfirewall', 'firewall', 'add', 'rule', 'name=Joserah Connect 4790',
    'dir=in', 'action=allow', 'protocol=TCP', 'localport=4790', 'profile=any']);
  assert.strictEqual(await fw.addRule(4790, { run: fake({ addCode: 1 }).run }), false);
});

test('writeBat: both files, port inside, CRLF, ASCII, idempotent add', T, (t) => {
  const dir = tmpdir(t);
  const r = fw.writeBat(dir, 4790);
  assert.strictEqual(r.add, path.join(dir, 'connect-firewall-add.bat'));
  assert.strictEqual(r.remove, path.join(dir, 'connect-firewall-remove.bat'));
  const add = fs.readFileSync(r.add, 'latin1');
  const rem = fs.readFileSync(r.remove, 'latin1');
  for (const s of [add, rem]) {
    assert.ok(s.includes('Joserah Connect 4790'));
    assert.ok(/^[\x00-\x7f]*$/.test(s), 'ASCII only');
    assert.ok(s.includes('\r\n'));
    assert.ok(!/[^\r]\n/.test(s), 'every LF follows a CR');
  }
  assert.match(add, /REM /);
  assert.match(add, /localport=4790/);
  assert.match(add, /profile=any/);
  assert.ok(add.indexOf('delete rule') < add.indexOf('add rule'), 'delete before add');
  assert.match(add, /pause\s*$/);
  assert.match(rem, /delete rule name="Joserah Connect 4790"/);
});

test('ensure: open -> open and nothing written', T, async (t) => {
  const dir = tmpdir(t);
  const f = fake({ rules: '2' });
  const r = await fw.ensure(dir, 4790, { run: f.run, platform: WIN });
  assert.strictEqual(r.state, 'open');
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  assert.strictEqual(adds(f.calls).length, 0);
});

test('ensure: closed + admin -> rule added, then re-checked', T, async (t) => {
  const dir = tmpdir(t);
  let added = false;
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (/netsh/i.test(cmd)) { added = true; return { code: 0, stdout: 'Ok.' }; }
    if (/powershell/i.test(cmd)) return { code: 0, stdout: added ? '1' : '0' };
    return { code: 0, stdout: '' }; // admin probe
  };
  const r = await fw.ensure(dir, 4790, { run, platform: WIN });
  assert.strictEqual(r.state, 'added');
  assert.strictEqual(adds(calls).length, 1);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('ensure: closed + admin but the rule still not there -> falls back to bat', T, async (t) => {
  const dir = tmpdir(t);
  const f = fake({ rules: '0', admin: 0 });
  const r = await fw.ensure(dir, 4790, { run: f.run, platform: WIN });
  assert.strictEqual(r.state, 'bat');
});

test('ensure: closed + not admin -> bat files and a say line', T, async (t) => {
  const dir = tmpdir(t);
  const f = fake({ rules: '0', admin: 1 });
  const r = await fw.ensure(dir, 4790, { run: f.run, platform: WIN });
  assert.strictEqual(r.state, 'bat');
  assert.strictEqual(r.bat, path.join(dir, 'connect-firewall-add.bat'));
  assert.ok(fs.existsSync(r.bat));
  assert.ok(fs.existsSync(path.join(dir, 'connect-firewall-remove.bat')));
  assert.match(r.say, /Run as administrator/);
  assert.match(r.say, /optional/i);
  assert.match(r.say, /remove/i);
  assert.strictEqual(adds(f.calls).length, 0);
});

test('ensure: non-Windows -> unknown, nothing written', T, async (t) => {
  const dir = tmpdir(t);
  const f = fake();
  const r = await fw.ensure(dir, 4790, { run: f.run, platform: 'linux' });
  assert.strictEqual(r.state, 'unknown');
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  assert.strictEqual(f.calls.length, 0);
});

test('ensure: a failing check -> unknown, nothing written', T, async (t) => {
  const dir = tmpdir(t);
  const run = async () => { throw new Error('boom'); };
  const r = await fw.ensure(dir, 4790, { run, platform: WIN });
  assert.strictEqual(r.state, 'unknown');
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('bad port is rejected before anything runs or is written', T, async (t) => {
  const dir = tmpdir(t);
  for (const bad of [0, 70000, -1, 1.5, '4790 & calc', '4790', NaN, null]) {
    const f = fake({ rules: '0', admin: 0 });
    assert.throws(() => fw.writeBat(dir, bad), /port/i, String(bad));
    await assert.rejects(fw.addRule(bad, { run: f.run }), /port/i);
    await assert.rejects(fw.check(bad, { run: f.run, platform: WIN }), /port/i);
    await assert.rejects(fw.ensure(dir, bad, { run: f.run, platform: WIN }), /port/i);
    assert.strictEqual(f.calls.length, 0);
  }
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('no elevation in the source; the core files never require firewall.js', T, () => {
  const src = fs.readFileSync(path.join(C, 'firewall.js'), 'utf8');
  assert.ok(!/runas/i.test(src));
  assert.ok(!/-Verb/i.test(src));
  for (const f of ['listener.js', 'store.js', 'files.js', 'api.js']) {
    const s = fs.readFileSync(path.join(C, f), 'utf8');
    assert.ok(!/require\([^)]*firewall/.test(s), f + ' must not require firewall.js');
  }
});
