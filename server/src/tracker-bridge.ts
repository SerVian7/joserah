import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { now } from './paths.ts';
import { jobsLib } from './cjs.ts';

/** The Tracker is job files (.joserah/desk/jobs/<slug>.json, tools/jobs-check.js rules); the hooks keep who is working, the server runs its own jobs. */
export interface TrackerBridge {
  row(o: { title: string; state: 'run' | 'you' | 'wait' | 'ok'; small?: string; url?: string; label?: string }): boolean;
  rowState(title: string): string | null;
  dir(): string;
}

export const JOB_TEXT = {
  tr: { queued: 'Sırada; makine boşalınca başlar.', running: 'Çalışıyor.', page: 'iş sayfası', cost: 'tahmini maliyet', stopped: 'Durdu', next: 'Sonraki: iş sayfasında Yeniden dene.',
    interrupted: 'Sunucu yeniden başlarken yarıda kaldı. Sonraki: iş sayfasında Yeniden dene.', approval: 'İzin istedi', approvalNext: 'Sonraki: iş sayfasında izin verin ya da bırakın.',
    cancelled: 'Sizin isteğinizle durduruldu. Sonraki: gerekirse iş sayfasında Yeniden dene.', check: 'Değişiklikleri kontrol edin', checkNext: 'Sonraki: iş sayfasındaki dosya listesine bakın; yanlışsa son kayıt noktasından geri alınır.', empty: 'İş bitti ama sonuç yazmadı. Sonraki: iş sayfasına bakın.' },
  en: { queued: 'In the queue; starts when the machine is free.', running: 'Running.', page: 'job page', cost: 'estimated cost', stopped: 'Stopped', next: 'Next: Retry on the job page.',
    interrupted: 'The server restarted while it ran. Next: Retry on the job page.', approval: 'It asked for permission', approvalNext: 'Next: allow it on the job page, or leave it.',
    cancelled: 'Stopped at your request. Next: Retry on the job page if needed.', check: 'Check the changes', checkNext: 'Next: look at the file list on the job page; the checkpoint undoes them if wrong.', empty: 'The job ended without a result. Next: look at the job page.' },
} as const;

const ASCII: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a' };
/** A file name from a row title: ascii words plus a short hash, so two titles never share a file. */
export function slugOf(title: string): string {
  const words = title.toLowerCase().replace(/[çğıöşüâ]/g, (c) => ASCII[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');
  return `${words || 'job'}-${crypto.createHash('sha1').update(title).digest('hex').slice(0, 6)}`;
}

export function cliTracker(workspace: string, lang: 'tr' | 'en'): TrackerBridge {
  const dir = (): string => path.join(workspace, '.joserah', 'desk', 'jobs');
  const file = (title: string): string => path.join(dir(), `${slugOf(title)}.json`);
  const read = (title: string): Record<string, unknown> | null => { try { return JSON.parse(fs.readFileSync(file(title), 'utf8')); } catch { return null; } };
  return {
    dir,
    row(o) {
      try {
        const prior = read(o.title);
        const at = jobsLib.isoLocal(now());
        const job: Record<string, unknown> = {
          title: o.title, project: lang === 'tr' ? 'Sunucu işleri' : 'Server jobs', state: o.state === 'ok' ? 'done' : o.state,
          // the server runs these itself: no hook pairs an agent to them
          ...(o.state === 'run' ? { unattended: true } : {}),
          ...(o.small ? { note: o.small } : {}), ...(o.url ? { url: o.url } : {}), ...(o.label ? { label: o.label } : {}),
          started: typeof prior?.started === 'string' ? prior.started : at, ...(o.state === 'ok' ? { finished: at } : {}),
        };
        const slug = slugOf(o.title);
        fs.mkdirSync(dir(), { recursive: true });
        const errors = jobsLib.check(job, slug, fs.readdirSync(dir()));
        if (errors.length) { process.stderr.write(`tracker: ${slug}: ${errors.join('; ')}\n`); return false; }
        const f = file(o.title);
        fs.writeFileSync(f + '.tmp', JSON.stringify(job, null, 1) + '\n'); fs.renameSync(f + '.tmp', f);
        jobsLib.afterWrite(workspace, f, now()); // the journal line, once, when the job is done
        return true;
      } catch (e) { process.stderr.write(`tracker: ${(e as Error).message}\n`); return false; }
    },
    rowState(title) {
      const s = read(title)?.state;
      return typeof s === 'string' ? (s === 'done' ? 'ok' : s) : null;
    },
  };
}
