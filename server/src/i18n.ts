// Words the interface shows for values the server keeps in English (job kinds, job states, error lines). The stored
// value never changes: a form still sends the kind's key, a record still holds the English error; only what a person
// reads is put in the page's language.
import type { Lang } from './layout.ts';

export const KINDS: Record<Lang, Record<string, string>> = {
  tr: { answers: 'Yanıtlar', digest: 'Özet', bookkeeping: 'Kayıt düzeni', task: 'İş', code: 'Kod', research: 'Araştırma', ingest: 'İçeri alma', query: 'Soru', lint: 'Denetim', plan: 'Plan', review: 'İnceleme' },
  en: { answers: 'Answers', digest: 'Digest', bookkeeping: 'Bookkeeping', task: 'Task', code: 'Code', research: 'Research', ingest: 'Ingest', query: 'Question', lint: 'Checks', plan: 'Plan', review: 'Review' },
};
export const STATES: Record<Lang, Record<string, string>> = {
  tr: { queued: 'sırada', running: 'çalışıyor', done: 'bitti', failed: 'başarısız', cancelled: 'durduruldu', interrupted: 'yarıda kaldı', 'needs-approval': 'izin bekliyor', refused: 'başlatılmadı', ended: 'bitti' },
  en: { queued: 'queued', running: 'running', done: 'done', failed: 'failed', cancelled: 'stopped', interrupted: 'interrupted', 'needs-approval': 'needs approval', refused: 'not started', ended: 'ended' },
};
export const kindWord = (lang: Lang, k: string) => KINDS[lang][k] ?? k;
export const stateWord = (lang: Lang, s: string) => STATES[lang][s] ?? s;

// Known error lines from the job runner and the checkpoint, in Turkish. Anything else (a tool's own output) is shown as it is.
const TR_ERRORS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/^the workspace is not a git repository — the setup wizard can create one$/, () => 'Çalışma alanı bir git deposu değil; kurulum sihirbazı bir tane oluşturabilir.'],
  [/^the server restarted while the job ran$/, () => 'İş çalışırken sunucu yeniden başladı.'],
  [/^the server stopped while the job ran$/, () => 'İş çalışırken sunucu durdu.'],
  [/^timeout after (\d+) min$/, (m) => `${m[1]} dakika içinde bitmedi.`],
  [/^turn limit (\d+) reached$/, (m) => `${m[1]} adım sınırına ulaşıldı.`],
  [/^money cap \$([\d.]+) reached$/, (m) => `$${m[1]} harcama sınırına ulaşıldı.`],
  [/^could not start Claude Code: (.*)$/, (m) => `Claude Code başlatılamadı: ${m[1]}`],
  [/^ended without a result \(exit (-?\d+)\)$/, (m) => `Sonuç vermeden bitti (çıkış ${m[1]}).`],
  [/^server error: (.*)$/, (m) => `Sunucu hatası: ${m[1]}`],
  [/^git could not run: (.*)$/, (m) => `git çalıştırılamadı: ${m[1]}`],
  [/^checkpoint (?:commit )?failed: (.*)$/, (m) => `Kontrol noktası alınamadı: ${m[1]}`],
];
export function errorText(lang: Lang, e: string): string {
  if (lang !== 'tr') return e;
  for (const [re, f] of TR_ERRORS) { const m = re.exec(e); if (m) return f(m); }
  return e;
}
