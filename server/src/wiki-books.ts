import crypto from 'node:crypto';
import type { Store } from './store.ts';
import type { JobRecord } from './jobs.ts';
import { wikiLib, redactions, type SourceEntry } from './cjs.ts';
import { localDay } from './paths.ts';

export const MAX_UPLOAD = 25 * 1024 * 1024;
const K = '.joserah/knowledge';

export function safeName(name: string): string | null {
  const base = String(name ?? '').split(/[\\/]/).pop()!.replace(/[:*?"<>|\0]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  return !base || base.startsWith('.') ? null : base;
}

// Best effort on binary files (a PDF's text may be compressed); never a guarantee (AGENTS.md 8.3).
export function scanUpload(bytes: Uint8Array): string[] {
  const buf = Buffer.from(bytes);
  const texts = [buf.toString('utf8'), buf.toString('latin1'), buf.toString('utf16le')];
  const hits: string[] = [];
  redactions.SPECIFIC.forEach(([re], i) => {
    const once = new RegExp(re.source, re.flags.replace('g', ''));
    if (texts.some((t) => once.test(t))) hits.push(`pattern ${i + 1}`);
  });
  return hits;
}

export function slug(s: string): string {
  return wikiLib.fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'answer';
}

export function rebuildIndex(store: Store, workspace: string): boolean {
  const text = wikiLib.buildIndex(wikiLib.scan(workspace));
  if (store.read(`${K}/wiki/index.md`) === text) return false;
  store.write(`${K}/wiki/index.md`, text);
  return true;
}

export function appendLog(store: Store, op: 'ingest' | 'query' | 'lint', title: string): void {
  const rel = `${K}/wiki/log.md`;
  if (store.read(rel) === null) store.write(rel, '# Wiki log\n\n');
  store.append(rel, wikiLib.logLine(op, title, localDay()));
}

export function setSource(store: Store, workspace: string, rel: string, patch: Partial<SourceEntry>): void {
  const reg = wikiLib.readSources(workspace);
  reg.sources[rel] = { ...(reg.sources[rel] ?? { status: 'raw', added: new Date().toISOString() }), ...patch } as SourceEntry;
  store.writeJson(`${K}/sources.json`, reg);
}

export function ingestBookkeeping(o: { store: Store; workspace: string }): (job: JobRecord) => void {
  return (job) => {
    if (job.type !== 'ingest' || job.state !== 'done') return;
    const src = job.pointers?.[0];
    if (!src?.startsWith('imports/')) return;
    const pages = (job.changed ?? []).filter((c) => c.status !== 'D' && c.path.startsWith(`${K}/`) && c.path.endsWith('.md')
      && c.path !== `${K}/wiki/index.md` && c.path !== `${K}/wiki/log.md`).map((c) => c.path).sort();
    if (!pages.length) { job.flags = [...(job.flags ?? []), 'ingest wrote no wiki page']; return; }
    setSource(o.store, o.workspace, src, { status: 'compiled', compiled_to: pages, job: job.id });
    rebuildIndex(o.store, o.workspace);
    appendLog(o.store, 'ingest', src.split('/').pop()!);
  };
}

export function fileAnswer(o: { store: Store; workspace: string; job: JobRecord; title: string }): string {
  const title = o.title.replace(/\s+/g, ' ').trim().slice(0, 140) || o.job.text.slice(0, 80);
  const base = `${K}/wiki/answers/${slug(title)}`;
  let rel = `${base}.md`;
  for (let n = 2; o.store.read(rel) !== null; n++) rel = `${base}-${n}.md`;
  const body = ['---', `title: ${title}`, 'type: answer', `date: ${localDay()}`, `source: job ${o.job.id}`, '---', '', `# ${title}`, '',
    `> Asked: ${o.job.text.replace(/\s+/g, ' ').trim()}`, '', (o.job.resultText ?? '').trim(), ''].join('\n');
  o.store.write(rel, body);
  rebuildIndex(o.store, o.workspace);
  appendLog(o.store, 'query', title);
  return rel;
}

export const sha1 = (b: Uint8Array) => crypto.createHash('sha1').update(b).digest('hex');
