import fs from 'node:fs';
import path from 'node:path';
import type { AppDeps } from './deps.ts';
import { pageDir, todayTrackerPage } from './pages.ts';

// What the assistant is doing right now, in one object: the jobs it is working on, and what waits on the owner
// (an owner row on today's Tracker, or a job held for an approval). The home page draws its presence from this.
export type Mode = 'idle' | 'working' | 'waiting';
export interface Presence {
  mode: Mode;
  running: Array<{ id: string; title: string; state: string; type: string }>;
  waiting: Array<{ title: string; small: string; url: string; from: 'tracker' | 'job' }>;
}

function ownerRows(ws: string): Presence['waiting'] {
  const t = todayTrackerPage(ws);
  const dir = t && pageDir(ws, t.day, t.folder);
  if (!t || !dir) return [];
  let rows: Array<{ state?: string; title?: string; small?: string }> = [];
  // rows.json is a bare list, or { rows: [...] } once the page carries groups or a crew strip.
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8')); rows = Array.isArray(j) ? j : (j.rows ?? []); } catch { return []; }
  return rows.filter((r) => r && r.state === 'you' && typeof r.title === 'string')
    .map((r) => ({ title: r.title!, small: String(r.small ?? '').slice(0, 240), url: `/p/${t.day}/${t.folder}/`, from: 'tracker' as const }));
}

export function presence(deps: AppDeps): Presence {
  const jobs = deps.jobs.list();
  const running = jobs.filter((j) => j.state === 'running' || j.state === 'queued').map((j) => ({ id: j.id, title: j.rowTitle, state: j.state, type: j.type }));
  const waiting = [
    ...jobs.filter((j) => j.state === 'needs-approval').map((j) => ({ title: j.rowTitle, small: j.error ?? '', url: `/jobs/${j.id}`, from: 'job' as const })),
    ...ownerRows(deps.workspace),
  ];
  return { mode: waiting.length ? 'waiting' : running.length ? 'working' : 'idle', running, waiting };
}
