'use strict';
// templates/jobs: the static Tracker page. Pure rules in node, layout rules in a real browser (Edge/Chrome headless).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const http = require('http');
const { spawnSync } = require('child_process');
const { tmpdir, PLUGIN_ROOT } = require('./helpers');
const P = require('../templates/jobs/jobs.js');
const TPL = path.join(PLUGIN_ROOT, 'templates', 'jobs');

test('a child title never repeats its band: leading "<project>" or "<project>:" goes, a longer word stays', () => {
  assert.strictEqual(P.stripParent('Joserah: fix the hook', 'Joserah'), 'fix the hook');
  assert.strictEqual(P.stripParent('joserah - fix', 'Joserah'), 'fix');
  assert.strictEqual(P.stripParent('Joserahlar fix', 'Joserah'), 'Joserahlar fix');
  assert.strictEqual(P.stripParent('Joserah', 'Joserah'), 'Joserah');
  assert.strictEqual(P.stripParent('Fix', ''), 'Fix');
});

const J = (o) => JSON.stringify({ state: 'run', project: 'P', started: '2026-10-13T08:00:00+03:00', ...o });
test('build: bands by project, active first and ordered, done only today, older done in the archive, bad files listed', () => {
  const m = P.build({
    'a.json': J({ title: 'A', state: 'run' }), 'b.json': J({ title: 'B', state: 'you' }),
    'c.json': J({ title: 'C', state: 'done', finished: '2026-10-13T09:00:00+03:00' }),
    'old.json': J({ title: 'Old', state: 'done', finished: '2026-10-12T09:00:00+03:00' }),
    'z.json': J({ title: 'Z', project: 'Q', state: 'wait' }), 'none.json': J({ title: 'N', project: '' }),
    'broken.json': '{"title":', 'nostate.json': JSON.stringify({ title: 'x', state: 'nope' }), '_agents.json': '{}',
  }, '2026-10-13', 'tr');
  assert.deepStrictEqual(m.bands.map((b) => b.project), ['P', 'Diğer', 'Q']);
  assert.deepStrictEqual(m.bands[0].active.map((j) => j.title), ['B', 'A']); // you before run
  assert.deepStrictEqual(m.bands[0].done.map((j) => j.title), ['C']);
  assert.deepStrictEqual(m.archive.map((d) => [d.day, d.jobs.map((j) => j.title)]), [['2026-10-12', ['Old']]]);
  assert.deepStrictEqual(m.bad.sort(), ['broken', 'nostate']);
});
test('build: a band header counts each role once with the number working under it; idle agents show nothing; an agent of no job is ignored', () => {
  const ag = { a1: { job: 'a', role: 'builder', state: 'work' }, a2: { job: 'b', role: 'builder', state: 'work' }, a3: { job: 'a', role: 'scout', state: 'work' }, a4: { job: 'a', role: 'builder', state: 'idle' }, a5: { job: 'zzz', role: 'sentry', state: 'work' } };
  const m = P.build({ 'a.json': J({ title: 'A' }), 'b.json': J({ title: 'B' }), '_agents.json': JSON.stringify(ag) }, '2026-10-13', 'en');
  const icons = Object.fromEntries(m.bands[0].icons.map((i) => [i.role, i.count]));
  assert.deepStrictEqual(icons, { builder: 2, scout: 1 });
  assert.deepStrictEqual(m.bands[0].active.find((j) => j.slug === 'a').agents.map((a) => a.id).sort(), ['a1', 'a3']);
});
test('the page source holds no date and no generated markup: static html, one css, one js', () => {
  const html = fs.readFileSync(path.join(TPL, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}/);
  assert.deepStrictEqual(fs.readdirSync(TPL).sort(), ['index.html', 'jobs.js', 'style.css']);
  assert.doesNotMatch(fs.readFileSync(path.join(TPL, 'jobs.js'), 'utf8'), /style\.cssText|createElement\('style'\)|innerHTML/);
});

const B = require('./browser');
const day = new Date().toLocaleDateString('sv-SE');
const at = (hh) => `${day}T${hh}:00+03:00`;
const MEASURE = `(function(){var q=function(s){return [].slice.call(document.querySelectorAll(s))};
q('.fold').forEach(function(e){e.open=true});
var h=q('.job > summary').map(function(e){return e.getBoundingClientRect().height});
var cs=function(e){return getComputedStyle(e)};
var band=q('.band > header')[0], kid=q('.kids')[0], deep=q('.kids .kids')[0];
return JSON.stringify({heights:h,top:document.querySelector('.top').textContent,bands:q('.band').length,
 bandBg:cs(band).backgroundColor,kidBg:kid&&cs(kid).backgroundColor,deepBg:deep&&cs(deep).backgroundColor,kidMargin:kid&&cs(kid).marginLeft,
 icons:q('.band > header .ico').map(function(e){return e.getAttribute('data-role')+':'+(e.querySelector('b')?e.querySelector('b').textContent:'1')}),
 tips:q('.band > header .ico').map(function(e){return e.getAttribute('data-tip')}),bad:q('.bad').length,
 scrollW:document.documentElement.scrollWidth,innerW:window.innerWidth})})()`;

function serve(files) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/jobs/index.json') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(Object.keys(files).map((n) => ({ n, t: 1 }))));
    }
    if (u.startsWith('/jobs/') && files[u.slice(6)] !== undefined) return res.end(files[u.slice(6)]);
    const f = path.join(TPL, u.replace(/^\/tracker\//, '') || 'index.html');
    if (!u.startsWith('/tracker/') || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
    const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(f)];
    res.setHeader('Content-Type', type);
    res.end(path.extname(f) === '.html' ? fs.readFileSync(f, 'utf8') : fs.readFileSync(f));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

const fixture = () => ({
  'a.json': J({ title: 'Short', project: 'Shop', started: at('08:00') }),
  'b.json': J({ title: 'Shop: a very long title that should be cut off with an ellipsis and never wrap onto a second line of the page', note: 'A long note. '.repeat(30), project: 'Shop', state: 'you', started: at('07:00') }),
  'c.json': J({ title: 'Done one', project: 'Shop', state: 'done', started: at('06:00'), finished: at('07:30'), url: 'http://x/y', label: 'report' }),
  'd.json': J({ title: 'Which plan?', project: 'Lab', state: 'you', options: [{ key: 'A', label: 'Cheap' }, { key: 'B', label: 'Fast' }], recommend: 'A', why: 'fits', started: at('07:10') }),
  'e.json': J({ title: 'Machine run', project: 'Lab', unattended: true, started: at('01:00') }),
  'f.json': J({ title: 'Old done', project: 'Lab', state: 'done', started: '2026-10-01T08:00:00+03:00', finished: '2026-10-01T09:00:00+03:00' }),
  'broken.json': '{"title":',
  '_agents.json': JSON.stringify({ x1: { job: 'a', role: 'builder', state: 'work', model: 'sonnet' }, x2: { job: 'b', role: 'builder', state: 'work' }, x3: { job: 'e', role: 'scout', state: 'idle' } }),
});

for (const [name, w, h] of [['desktop', 1280, 900], ['phone 390', 390, 800]]) {
  test(`browser ${name}: equal line height, header date once, nested grounds, role icon counts, no horizontal scroll`, { skip: !B.EXE && 'no Edge/Chrome here' }, async (t) => {
    const srv = await serve(fixture()); t.after(() => srv.close());
    const pg = await B.open(`http://127.0.0.1:${srv.address().port}/tracker/`, { width: w, height: h });
    t.after(() => pg.close());
    const d = JSON.parse(await pg.eval(MEASURE));
    if (process.env.JOSERAH_SHOT) await pg.shot(path.join(process.env.JOSERAH_SHOT, `tracker-${w}.png`));
    assert.ok(d.heights.length >= 5, 'job lines rendered (open + folded)');
    assert.strictEqual(new Set(d.heights.map((x) => Math.round(x))).size, 1, `every line one height: ${d.heights}`);
    assert.strictEqual((d.top.match(/\d{2}\.\d{2}\.\d{4}/g) || []).length, 1, `date once in the header: ${d.top}`);
    assert.strictEqual(d.bands, 2);
    assert.notStrictEqual(d.kidBg, d.bandBg); assert.notStrictEqual(d.deepBg, d.kidBg); assert.ok(parseInt(d.kidMargin, 10) > 0, 'children indented');
    assert.strictEqual(d.bad, 1, 'the unreadable job is one red line');
    assert.deepStrictEqual(d.icons, ['builder:2']); // Shop: two builders on two jobs; the idle scout shows nothing
    assert.ok(d.tips[0].startsWith('builder × 2\n') && d.tips[0].includes('Short'), d.tips[0]);
    assert.ok(d.scrollW <= d.innerW, `no horizontal scroll (${d.scrollW} > ${d.innerW})`);
  });
}
