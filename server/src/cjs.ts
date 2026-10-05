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
