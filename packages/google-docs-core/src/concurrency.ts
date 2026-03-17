import type { GDocsDocument } from './google-api-types.js';

/** Revision freshness check - Docs revisionId is valid ~24h */
const REVISION_MAX_AGE_MS = 23 * 60 * 60 * 1000; // 23 hours (buffer before 24h)

export type ConcurrencyState = {
  revisionId: string;
  fetchedAt: Date;
};

/** Check if a cached revision is still fresh enough to use */
export function isRevisionFresh(state: ConcurrencyState): boolean {
  const age = Date.now() - state.fetchedAt.getTime();
  return age < REVISION_MAX_AGE_MS;
}

/** Build writeControl for batchUpdate request */
export function buildWriteControl(revisionId: string): { requiredRevisionId: string } {
  return { requiredRevisionId: revisionId };
}

/** Extract revisionId from a Docs API document response */
export function extractRevisionId(doc: GDocsDocument): string {
  return doc.revisionId ?? '';
}
