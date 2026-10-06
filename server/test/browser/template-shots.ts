// Screenshots of the page templates, built by a given plugin root's own tools from the same sample data:
//   node test/browser/template-shots.ts <plugin-root> <out-dir> <label>
// Writes <template>-<label>-<phone|desktop>-<dark|light>.png. Pages are opened over file://, standalone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const [ROOT, OUT, LABEL] = [path.resolve(process.argv[2]), path.resolve(process.argv[3]), process.argv[4] ?? 'after'];
fs.mkdirSync(OUT, { recursive: true });
const HERMETIC = fs.mkdtempSync(path.join(os.tmpdir(), 'joserah-tpl-config-'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'joserah-tpl-'));
const run = (tool: string, args: string[]) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', tool), ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: HERMETIC, JOSERAH_NOW: '2026-10-06T14:20:00' } });
  if (r.status !== 0) throw new Error(`${tool} ${args.join(' ')}: ${r.stderr}`);
};
const json = (o: unknown) => { const f = path.join(tmp, `e${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(o)); return f; };

// Daily Tracker: every state, an answerable owner row, a project group, a folded done group, a crew strip.
const trk = path.join(tmp, 'tracker');
run('tracker.js', ['init', trk, '--title', 'Serkan · Daily Tracker', '--lang', 'tr']);
const row = (a: string[]) => run('tracker.js', ['row', trk, ...a]);
row(['--title', 'Haftalık özet', '--state', 'run', '--small', 'Bu haftanın günlükleri okunuyor; özet akşam hazır olacak.']);
row(['--title', 'Rack için kablo seçimi', '--state', 'you', '--option', 'A|Uzun kablo|3 m, esnek, stokta', '--option', 'B|Kısa kablo|1 m, rack derinliğine uyuyor', '--recommend', 'B', '--why', 'Rack derinliğine uyuyor, fazlalık kalmıyor.']);
row(['--title', 'Yedek sunucu şifresi', '--state', 'you', '--small', 'Panele girmek için şifre lazım; bulunca bu satıra yazın.']);
row(['--title', 'Kamera firmware güncellemesi', '--state', 'wait', '--small', 'Üreticinin cevabı bekleniyor; gelince sürüm notlarını okuyup kurulumu planlarım.']);
row(['--title', 'Yayın odası ağı', '--state', 'ok', '--small', 'Switch yapılandırması kaydedildi.']);
row(['--title', 'VLAN planı', '--state', 'ok', '--parent', 'Yayın odası ağı', '--small', 'Üç VLAN ayrıldı.']);
row(['--title', 'Mail cevabı: AWS', '--state', 'ok', '--small', 'Yazılı cevap gönderildi.']);
row(['--title', 'Ses masası değişimi', '--state', 'plan', '--group', 'Stüdyo', '--small', 'Teklifler gelince karşılaştırma sayfası açılacak.']);
run('tracker.js', ['crew', trk, '--role', 'builder', '--job', 'Haftalık özet', '--state', 'work']);
run('tracker.js', ['crew', trk, '--role', 'scout', '--job', 'Kablo fiyatları', '--state', 'owner', '--reason', 'decision']);

// Trail: several entry types.
const trl = path.join(tmp, 'trail');
run('trail.js', ['new', trl, '--title', 'Rack kablosu', '--lang', 'tr']);
const add = (type: string, e: unknown) => run('trail.js', ['add', trl, '--type', type, '--file', json(e)]);
add('mail-in', { title: 'Tedarikçiden teklif geldi', from: 'Ayşe Kaya, Netkom', subject: 'Kablo teklifi', summary: 'İki uzunlukta fiyat verdi, stok durumu ekte.' });
add('options', { title: 'Seçenekler', items: [{ title: 'Uzun kablo (3 m)', status: 'wait', price: '€42', note: 'Esnek, fazlalık kalır' }, { title: 'Kısa kablo (1 m)', status: 'ok', price: '€28', note: 'Rack derinliğine uyuyor' }], rec: 1 });
add('waiting', { title: 'Stok teyidi', on: 'Netkom', what: 'Kısa kablonun bu hafta teslim edilip edilemeyeceği' });
add('note', { title: 'Rack derinliği ölçüldü: 60 cm' });
add('decision', { title: 'Kısa kablo seçildi', choice: 1, ref: 'e2', why: 'Rack derinliğine uyuyor.', by: 'Serkan' });

// Case research: two groups, a recommendation, a pick.
const cs = path.join(tmp, 'case');
run('case.js', ['init', cs, '--title', 'Rack kablosu', '--lang', 'tr']);
fs.writeFileSync(path.join(cs, 'cases.json'), JSON.stringify({ title: 'Rack kablosu', lang: 'tr', update: { date: '06.10.2026', items: [{ state: 'ok', text: 'Netkom iki fiyat verdi.' }, { state: 'wait', text: 'Stok teyidi bekleniyor.' }], links: [] },
  groups: [{ name: 'Kablolar', note: 'Rack derinliği 60 cm; kablo 1 m yeterli.', cases: [
    { title: 'Kısa kablo (1 m)', sub: 'Netkom', status: 'ok', picked: true, rec: 'Rack derinliğine uyuyor, fazlalık kalmıyor.', price: '€28', pro: ['Stokta', 'Düzgün kablo yönetimi'], con: ['Yer değişirse kısa kalır'], specs: [['Uzunluk', '1 m'], ['Kategori', 'Cat6A']] },
    { title: 'Uzun kablo (3 m)', sub: 'Netkom', status: 'wait', price: '€42', pro: ['Esnek'], con: ['Fazlalık rack içinde birikir'], specs: [['Uzunluk', '3 m'], ['Kategori', 'Cat6A']] },
    { title: 'Ucuz kablo', sub: 'Pazar yeri', status: 'no', why: 'Kategori belirsiz, kaynak yok.', price: '€9' }] },
  { name: 'Eldekiler', cases: [{ title: 'Depodaki 2 m kablo', status: 'wait', why: 'Sayısı belli değil.' }] }] }, null, 1));
run('case.js', ['render', cs]);

// Changelog.
const cl = path.join(tmp, 'changelog');
run('changelog.js', ['init', cl, '--title', 'Joserah platform sunucusu', '--lang', 'tr']);
// A section needs two to five lines, so each is written whole into changelog.json and rendered once.
fs.writeFileSync(path.join(cl, 'changelog.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(cl, 'changelog.json'), 'utf8')), sections: [
  { date: '2026-10-06', lines: ['Yeni arayüz: açılışta J, canlı durum alanı.', 'Takip, İş akışı ve raporlar uygulamanın içinde açılıyor.'] },
  { date: '2026-10-05', lines: ['Takip sayfası canlı güncelleniyor.', 'Satırlar sayfadan cevaplanabiliyor.'] }] }, null, 1));
run('changelog.js', ['render', cl]);

// Report (and the Wrap, which uses it): the standard filled with a short Turkish report.
const rp = path.join(tmp, 'report'); fs.mkdirSync(rp, { recursive: true });
const tpl = fs.readFileSync(path.join(ROOT, '.brand', 'report.html'), 'utf8').replace(/<!--[\s\S]*?-->\s*/, '');
fs.writeFileSync(path.join(rp, 'index.html'), tpl.replaceAll('{{TITLE}}', '6 Ekim günü').replace('{{BODY}}',
  '<h2 class="h">Yayın odası ağı hazır</h2><p class="p">Switch yapılandırıldı ve kaydedildi; üç VLAN ayrıldı. Kamera ve ses ayrı ağlarda.</p>'
  + '<h2 class="h">Kablo kararı sizde</h2><p class="p">Netkom iki fiyat verdi: 1 m kablo €28, 3 m kablo €42. Rack derinliği 60 cm olduğu için kısa olanı öneriyorum.</p>'
  + '<h2 class="h">Yarın</h2><p class="p">Kamera firmware sürüm notları gelince kurulum planlanacak.</p>').replace('{{SIGNATURE}}', 'Joserah').replace('{{DATE}}', '06.10.2026'));

const pages: Record<string, string> = { tracker: trk, trail: trl, case: cs, changelog: cl, report: rp };
const browser = await chromium.launch();
try {
  for (const [name, dir] of Object.entries(pages)) {
    for (const [size, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]] as const) {
      for (const scheme of ['dark', 'light'] as const) {
        const c = await browser.newContext({ viewport: vp, deviceScaleFactor: size === 'phone' ? 2 : 1, colorScheme: scheme, reducedMotion: 'reduce' });
        const p = await c.newPage();
        await p.goto(pathToFileURL(path.join(dir, 'index.html')).href); await p.waitForTimeout(250);
        if (name === 'tracker') { const b = p.locator('button.tx', { hasText: 'Rack için kablo seçimi' }).first(); if (await b.count()) { await b.click(); await p.waitForTimeout(150); } }
        await p.screenshot({ path: path.join(OUT, `${name}-${LABEL}-${size}-${scheme}.png`), fullPage: size === 'desktop' ? false : true });
        await c.close();
      }
    }
  }
} finally {
  await browser.close();
  for (const d of [tmp, HERMETIC]) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }); } catch { /* harmless */ } }
}
console.log('ok', OUT);
