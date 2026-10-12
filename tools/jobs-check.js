#!/usr/bin/env node
'use strict';
/**
 * Job files (.joserah/desk/jobs/<slug>.json): the Tracker's only model-written data.
 *   node tools/jobs-check.js [<jobs dir>]   checks every job file, prints one line per problem, exits 1 on any
 * `afterWrite` is the write path the hook calls: check one file, fill `finished` on a done job, append the
 * journal line once (marker `<!-- job:<slug>@<finished> -->` in the day's journal is the whole idempotency state).
 */
const fs = require('fs');
const path = require('path');

const STATES = ['run', 'you', 'wait', 'done', 'plan'];
const norm = (s) => String(s || '').trim().toLowerCase();

/** Problems of one job (empty list = fine). `siblings` are the file names in the folder. */
function check(job, slug, siblings = []) {
  const e = [];
  if (!job || typeof job !== 'object' || Array.isArray(job)) return ['unreadable: not a JSON object'];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) e.push(`slug "${slug}" must be lowercase ascii letters, digits and dashes`);
  if (siblings.some((n) => n !== `${slug}.json` && norm(n) === `${slug}.json`)) e.push(`slug "${slug}" exists twice (case differs)`);
  if (typeof job.title !== 'string' || !job.title.trim()) e.push('title is required');
  if (!STATES.includes(job.state)) e.push(`state must be one of ${STATES.join('/')}`);
  const p = norm(job.project), t = norm(job.title);
  if (p && t.startsWith(p) && !/[a-z0-9\u00c0-\u024f]/.test(t[p.length] || '')) e.push(`title repeats the project name "${job.project}": the page groups by project, drop it`);
  const decision = job.options !== undefined || (job.state === 'you' && /\?\s*$/.test(job.title || ''));
  if (decision) {
    const keys = Array.isArray(job.options) ? job.options.map((o) => o && o.key) : [];
    if (keys.length < 2 || keys.some((k) => !k)) e.push('a decision carries options: at least two {key,label}');
    if (!keys.includes(job.recommend)) e.push('a decision carries recommend: the key of one option');
    if (typeof job.why !== 'string' || !job.why.trim()) e.push('a decision carries why: one line');
  }
  if (job.state === 'done' && !job.finished) e.push('done needs finished (an ISO time)');
  return e;
}

const pad = (n) => String(n).padStart(2, '0');
function isoLocal(d) {
  const o = -d.getTimezoneOffset(), a = Math.abs(o);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${o < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
const isJobFile = (root, file) => {
  const dir = path.join(root, '.joserah', 'desk', 'jobs');
  return path.dirname(path.resolve(file)) === dir && /^[^_.].*\.json$/.test(path.basename(file));
};

function journalLine(slug, job) {
  const f = job.finished;
  const note = String(job.note || '').split(/(?<=[.!?])\s/)[0].slice(0, 160);
  const link = job.url ? ` — [${job.label || 'link'}](${job.url})` : '';
  return `- ${f.slice(11, 16)} ${job.title.trim()}${note ? ` — ${note}` : ''}${link} <!-- job:${slug}@${f} -->`;
}

function journalDone(root, slug, job) {
  const day = job.finished.slice(0, 10);
  const file = path.join(root, '.joserah', 'desk', 'daily', day.slice(0, 4), `${day}.md`);
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { text = `# ${day}\n\n## Done today\n`; }
  if (text.includes(`job:${slug}@${job.finished} `)) return false;
  const line = journalLine(slug, job);
  const m = /^## Done today[^\n]*\n/m.exec(text);
  text = m ? text.slice(0, m.index + m[0].length) + line + '\n' + text.slice(m.index + m[0].length)
    : text.replace(/\n*$/, '\n') + `\n## Done today\n${line}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}

const writeAtomic = (file, text) => { fs.writeFileSync(file + '.tmp', text); fs.renameSync(file + '.tmp', file); };

/** The hook's call after a job file was written. null = not a job file; else { errors, journaled }. */
function afterWrite(root, file, now = new Date()) {
  if (!isJobFile(root, file)) return null;
  const slug = path.basename(file, '.json');
  let job;
  try { job = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return { errors: [`unreadable: ${err.message}`], journaled: false }; }
  if (job && job.state === 'done' && !job.finished) { job.finished = isoLocal(now); writeAtomic(file, JSON.stringify(job, null, 1) + '\n'); }
  const errors = check(job, slug, fs.readdirSync(path.dirname(file)));
  if (errors.length || job.state !== 'done') return { errors, journaled: false };
  return { errors, journaled: journalDone(root, slug, job) };
}

function checkDir(dir) {
  const names = fs.readdirSync(dir).filter((n) => /^[^_.].*\.json$/.test(n));
  const out = [];
  for (const n of names) {
    let errs;
    try { errs = check(JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')), n.slice(0, -5), names); } catch (err) { errs = [`unreadable: ${err.message}`]; }
    for (const m of errs) out.push(`${n}: ${m}`);
  }
  return out;
}

if (require.main === module) {
  const dir = process.argv[2] || path.join(process.cwd(), '.joserah', 'desk', 'jobs');
  const out = checkDir(dir);
  console.log(out.length ? out.join('\n') : 'jobs ok');
  process.exit(out.length ? 1 : 0);
}
module.exports = { check, afterWrite, checkDir, isoLocal, STATES };
