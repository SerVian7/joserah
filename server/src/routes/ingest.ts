import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { jsonError } from '../app.ts';
import { localDay, hhmm } from '../paths.ts';
import { MAX_UPLOAD, safeName, scanUpload, setSource, fileAnswer, sha1 } from '../wiki-books.ts';
import { Refused } from '../jobs.ts';
import { workspaceLang } from '../config.ts';
import { cliTracker } from '../tracker-bridge.ts';

const HELD = {
  tr: (n: string) => `Yüklenen ${n} bir kimlik bilgisi içeriyor gibi görünüyor; hiçbir model okumadı ve ayrı bir klasörde bekliyor. Sonraki: dosyaya bakın; gizli bilgiyi kasaya koyun, sonra dosyayı yeniden ekleyin.`,
  en: (n: string) => `The upload ${n} looks like it holds a credential; no model read it and it waits in a separate folder. Next: check the file; put the secret in the vault, then add the file again.`,
};

export function register(app: App, deps: AppDeps): void {
  const tracker = () => deps.tracker ?? (deps.tracker = cliTracker(deps.workspace, workspaceLang(deps.workspace)));
  app.post('/api/ingest', async (c) => {
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > MAX_UPLOAD + 64 * 1024) return jsonError(c, 413, 'too-large');
    let form: Record<string, unknown>;
    try { form = await c.req.parseBody(); } catch { return jsonError(c, 400, 'no-file'); }
    const file = form.file;
    if (!(file instanceof File)) return jsonError(c, 400, 'no-file');
    if (file.size > MAX_UPLOAD) return jsonError(c, 413, 'too-large');
    const name = safeName(file.name);
    if (!name) return jsonError(c, 400, 'bad-name');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const day = localDay();
    if (scanUpload(bytes).length) {
      const rel = deps.store.importVerbatim(bytes, `imports/${day}-quarantine/${name}`);
      setSource(deps.store, deps.workspace, rel, { status: 'quarantined', added: new Date().toISOString(), sha1: sha1(bytes) });
      const lang = workspaceLang(deps.workspace);
      tracker().row({ title: `${lang === 'tr' ? 'Bekletilen dosya' : 'Held upload'}: ${name} · ${hhmm()}`, state: 'you', small: HELD[lang](name) });
      return c.json({ quarantined: true, path: rel }, 202);
    }
    const rel = deps.store.importVerbatim(bytes, `imports/${day}-upload/${name}`);
    try {
      const job = deps.jobs.submit({ type: 'ingest', text: `Ingest ${rel} into the wiki: a summary page for the source, then the entity and topic pages it touches.`,
        pointers: [rel, '.joserah/knowledge/wiki/README.md', '.joserah/knowledge/wiki/index.md', '.joserah/conventions.md'] });
      setSource(deps.store, deps.workspace, rel, { status: 'raw', added: new Date().toISOString(), sha1: sha1(bytes), job: job.id });
      return c.json({ id: job.id, path: rel }, 201);
    } catch (e) {
      setSource(deps.store, deps.workspace, rel, { status: 'raw', added: new Date().toISOString(), sha1: sha1(bytes) });
      if (e instanceof Refused) return jsonError(c, e.code === 'daily-budget' ? 429 : 400, e.code, { message: e.message, path: rel });
      throw e;
    }
  });
  app.post('/api/query', async (c) => {
    let b: { question?: unknown } | null;
    try { b = await c.req.json(); } catch { return jsonError(c, 400, 'bad-text'); }
    if (!b || typeof b !== 'object') return jsonError(c, 400, 'bad-text');
    try { return c.json({ id: deps.jobs.submit({ type: 'query', text: String(b.question ?? ''), pointers: ['.joserah/knowledge/wiki/index.md'] }).id }, 201); }
    catch (e) { if (e instanceof Refused) return jsonError(c, e.code === 'daily-budget' ? 429 : 400, e.code, { message: e.message }); throw e; }
  });
  app.post('/api/query/:id/file', async (c) => {
    const job = deps.jobs.get(c.req.param('id'));
    if (!job || job.type !== 'query') return jsonError(c, 404, 'not-found');
    if (job.state !== 'done' || !job.resultText) return jsonError(c, 409, 'not-done');
    let b: { title?: unknown } | null = {};
    try { b = await c.req.json(); } catch { /* title optional */ }
    return c.json({ path: fileAnswer({ store: deps.store, workspace: deps.workspace, job, title: String(b?.title ?? '') }) }, 201);
  });
}
