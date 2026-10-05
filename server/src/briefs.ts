import type { JobType } from './config.ts';

// The stable prefix (§7 "cache-friendly prompts"): identical bytes for every job, volatile parts after it.
export const BRIEF_PREFIX = [
  'You are running one job for the owner of this Joserah workspace, started from its web server.',
  'Work from the files and read only what the task needs; never paste whole files into your answer.',
  'Pages are made by tools, never by you: do not write or re-read any .html file. This job\'s Tracker row is kept by the server; do not edit the Tracker.',
  'Never print a secret; the vault holds them.',
  'End with a short plain-text result: what you did, what waits on the owner, which files you changed.',
].join('\n');
export const BRIEF_MAX = 4000;

export function cut(text: string, max: number): string { return text.length <= max ? text : `${text.slice(0, max)} [cut]`; }

const RULES: Partial<Record<JobType, string>> = {
  ingest: 'Write only under .joserah/knowledge/. Cite the source by its imports/ path. A value that lives on another page is linked to its home, never copied. Do not mark the source compiled and do not edit the index or the log: the server does both.',
  query: 'Answer only from .joserah/knowledge/; cite every page you used by its path; say "not found in the wiki" when it does not hold the answer.',
  lint: 'Do not edit pages. Quote conflicting sentences exactly and write them to .joserah/knowledge/.lint/conflicts.json as [{"a":{"path","quote"},"b":{"path","quote"},"note"}].',
  answers: 'Read the new answers with the answers tool named below, act on each, reply to each with one line, then mark it read.',
};
export function ruleFor(type: JobType): string { return RULES[type] ?? 'A number carries its kind and its source (claim lines, AGENTS.md §4).'; }

export function composeBrief(b: { task: string; type: JobType; rule?: string; pointers?: string[] }): string {
  const parts = [BRIEF_PREFIX, '', `## Job (${b.type})`, cut(b.task.trim(), 2000), '', '## Rule', cut(b.rule ?? ruleFor(b.type), 400)];
  const ptrs = (b.pointers ?? []).filter((p) => !/\.html?$/i.test(p)).map((p) => `- ${cut(p, 200)}`);
  if (ptrs.length) parts.push('', '## Files', ...ptrs.slice(0, 20), ...(ptrs.length > 20 ? [`- ${ptrs.length - 20} more [cut]`] : []));
  const out = parts.join('\n');
  return out.length <= BRIEF_MAX ? out : `${out.slice(0, BRIEF_MAX)}\n[cut]`;
}
