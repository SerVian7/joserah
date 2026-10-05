import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { JobType } from './config.ts';
import { toolPath, localDay } from './paths.ts';
import { dailyTrackerLib } from './cjs.ts';

export interface TrackerBridge {
  row(o: { title: string; state: 'run' | 'you' | 'wait' | 'ok'; small?: string; url?: string; label?: string }): boolean;
  crew(o: { role: string; job: string; state: 'work' | 'owner' | 'idle'; row?: string; reason?: string }): boolean;
  rowState(title: string): string | null;
  dir(): string;
}

export function roleFor(type: JobType): 'builder' | 'scout' | 'architect' {
  if (type === 'research' || type === 'query') return 'scout';
  if (type === 'plan' || type === 'review') return 'architect';
  return 'builder';
}

export const JOB_TEXT = {
  tr: { queued: 'Sırada; makine boşalınca başlar.', running: 'Çalışıyor.', page: 'iş sayfası', cost: 'tahmini maliyet', stopped: 'Durdu', next: 'Sonraki: iş sayfasında Yeniden dene.',
    interrupted: 'Sunucu yeniden başlarken yarıda kaldı. Sonraki: iş sayfasında Yeniden dene.', approval: 'İzin istedi', approvalNext: 'Sonraki: iş sayfasında izin verin ya da bırakın.',
    cancelled: 'Sizin isteğinizle durduruldu. Sonraki: gerekirse iş sayfasında Yeniden dene.', check: 'Değişiklikleri kontrol edin', checkNext: 'Sonraki: iş sayfasındaki dosya listesine bakın; yanlışsa son kayıt noktasından geri alınır.', empty: 'İş bitti ama sonuç yazmadı. Sonraki: iş sayfasına bakın.' },
  en: { queued: 'In the queue; starts when the machine is free.', running: 'Running.', page: 'job page', cost: 'estimated cost', stopped: 'Stopped', next: 'Next: Retry on the job page.',
    interrupted: 'The server restarted while it ran. Next: Retry on the job page.', approval: 'It asked for permission', approvalNext: 'Next: allow it on the job page, or leave it.',
    cancelled: 'Stopped at your request. Next: Retry on the job page if needed.', check: 'Check the changes', checkNext: 'Next: look at the file list on the job page; the checkpoint undoes them if wrong.', empty: 'The job ended without a result. Next: look at the job page.' },
} as const;

export function cliTracker(workspace: string, lang: 'tr' | 'en'): TrackerBridge {
  const tool = toolPath('tracker.js');
  const exec = (args: string[]) => { const r = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', timeout: 20000, windowsHide: true }); if (r.status !== 0) process.stderr.write(`tracker: ${(r.stderr || r.stdout).trim().split('\n')[0]}\n`); return r.status === 0; };
  const dir = (): string => {
    const day = localDay();
    const found = dailyTrackerLib.dailyTracker(workspace, day);
    if (found) return found;
    const d = path.join(workspace, '.joserah', 'desk', 'artifacts', day, 'daily-tracker');
    exec(['init', d, '--title', 'Daily Tracker', '--lang', lang]);
    return d;
  };
  return {
    dir,
    row(o) { return exec(['row', dir(), '--title', o.title, '--state', o.state, ...(o.small ? ['--small', o.small] : []), ...(o.url ? ['--url', o.url] : []), ...(o.label ? ['--label', o.label] : [])]); },
    crew(o) { return exec(['crew', dir(), '--role', o.role, '--job', o.job, '--state', o.state, ...(o.reason ? ['--reason', o.reason] : []), ...(o.row !== undefined ? ['--row', o.row] : [])]); },
    rowState(title) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir(), 'rows.json'), 'utf8'));
        const rows: Array<{ title?: string; state?: string }> = Array.isArray(j) ? j : j.rows ?? [];
        const k = title.trim().toLowerCase();
        return rows.find((r) => String(r.title ?? '').trim().toLowerCase() === k)?.state ?? null;
      } catch { return null; }
    },
  };
}
