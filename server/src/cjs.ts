import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export interface Claim { type: string; text: string; subject: string; value: string | null; struck: boolean; fields: Record<string, string>; line: number }
export const redactions = require('../../hooks/lib/redactions.js') as {
  SPECIFIC: Array<[RegExp, string]>; redact(text: string): { text: string; redacted: boolean };
};
export const dailyTrackerLib = require('../../hooks/lib/daily-tracker.js') as { dailyTracker(root: string, day: string): string | null };
export const workspaceLib = require('../../hooks/lib/workspace.js') as { readConfig(root: string): Record<string, unknown> | null };
export const theme = require('../../tools/lib/theme.js') as { TOKENS_CSS: string; BASE_CSS: string };
export const noteFormat = require('../../tools/lib/note-format.js') as {
  parseFrontmatter(text: string): { data: Record<string, unknown>; body: string; hasFrontmatter: boolean; rawBlock: string | null };
  parseClaims(body: string): Claim[];
  findClaimAnomalies(body: string): Array<{ line: number; kind: string; detail?: string }>;
  extractWikilinks(text: string): string[];
};
export interface AnswerDoc { row?: string; key?: string; label?: string; note?: string; at?: string; state?: string; from?: string }
export type AnswerResult = { ok: true; doc: AnswerDoc; id?: string } | { ok: false; code: string };
/** tools/lib/answers.js: put, markRead and reply take a lock and can throw (lock held too long, or taken over). */
export const answersLib = require('../../tools/lib/answers.js') as {
  FILE: string; ID_RE: RegExp; isReplyId(id: string): boolean;
  read(dir: string): { version: 1; docs: Record<string, AnswerDoc> };
  put(dir: string, id: string, doc: unknown, author: 'owner' | 'assistant'): AnswerResult;
  list(dir: string, o?: { onlyNew?: boolean }): Array<AnswerDoc & { id: string }>;
  markRead(dir: string, id: string): AnswerResult;
  reply(dir: string, baseId: string, note: string, nowMs?: number): AnswerResult;
  newCounts(workspace: string, days?: number): Array<{ page: string; dir: string; count: number }>;
};
export interface WikiPage { rel: string; title: string; type: string; description: string; body: string; links: string[]; wikilinks: string[]; bytes: number; mtimeMs: number; sha1: string; hasFrontmatter: boolean; unclosed: boolean; bodyLine: number }
export interface WikiFinding { kind: string; rel: string; line?: number; detail: string }
export interface SourceEntry { status: 'raw' | 'compiled' | 'quarantined'; added: string; sha1?: string; job?: string; compiled_to?: string[] }
export const wikiLib = require('../../tools/lib/wiki.js') as {
  KNOWLEDGE: string; SIZE_LIMIT: number; STALE_RAW_DAYS: number;
  scan(ws: string): WikiPage[];
  resolveLink(fromRel: string, href: string): { kind: 'page' | 'outside'; rel: string } | null;
  resolveWikilink(pages: WikiPage[], name: string): string | null;
  backlinks(pages: WikiPage[]): Map<string, string[]>;
  buildIndex(pages: WikiPage[]): string;
  logLine(op: string, title: string, day: string): string;
  claims(pages: WikiPage[]): Array<Claim & { page: string }>;
  fold(s: string): string;
  search(pages: WikiPage[], q: string, limit?: number): Array<{ rel: string; title: string; snippet: string }>;
  readSources(ws: string): { version: 1; sources: Record<string, SourceEntry> };
  lint(ws: string, o?: { now?: Date }): WikiFinding[];
};
