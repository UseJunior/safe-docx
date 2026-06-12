import {
  createRevisionIdState,
  partitionRevisionValidationIssues,
  RevisionValidationError,
  validateRevisions,
  type RevisionIdState,
  type RevisionValidationIssue,
} from '@usejunior/docx-core';
import { err, type ToolResponse } from '../tools/types.js';
import type { DocxSession } from './manager.js';

function cloneRevisionIdState(state: RevisionIdState | null): RevisionIdState | null {
  if (!state) return null;
  const copy = createRevisionIdState(state.startId);
  copy.nextId = state.nextId;
  copy.moveRangeIds = new Map(state.moveRangeIds);
  return copy;
}

function restoreRevisionIdState(target: DocxSession, snapshot: RevisionIdState | null): void {
  target.revisionIdState = cloneRevisionIdState(snapshot);
}

function summarizeIssues(issues: RevisionValidationIssue[]): string {
  return issues
    .slice(0, 5)
    .map((issue) => {
      const location = issue.context?.partName ? `${issue.context.partName}: ` : '';
      return `${location}${issue.message}`;
    })
    .join('; ');
}

export type AiWriteGuard = {
  verify(): Promise<ToolResponse | null>;
  rollback(): Promise<void>;
};

/**
 * Roll back a guarded write after a thrown error. Returns a
 * REVISION_VALIDATION_FAILED response when the throw came from the core
 * post-write revision assert, so tools surface the same error code whether
 * validation fails in docx-core or in the MCP guard; returns null for other
 * errors so the tool's own error mapping applies.
 */
export async function rollbackGuardedAiWrite(guard: AiWriteGuard | null, e: unknown): Promise<ToolResponse | null> {
  if (guard) await guard.rollback();
  if (e instanceof RevisionValidationError) {
    return err(
      'REVISION_VALIDATION_FAILED',
      `AI-emitted revision validation failed: ${summarizeIssues(e.issues)}`,
      'The attempted edit was rolled back; the session remains usable.',
    );
  }
  return null;
}

export async function beginGuardedAiWrite(session: DocxSession): Promise<AiWriteGuard> {
  const documentSnapshot = await session.doc.createSnapshot();
  const revisionIdStateSnapshot = cloneRevisionIdState(session.revisionIdState);
  let rolledBack = false;

  async function rollback(): Promise<void> {
    if (rolledBack) return;
    session.doc.restoreFromSnapshot(documentSnapshot);
    restoreRevisionIdState(session, revisionIdStateSnapshot);
    session.saveCache.clear();
    session.extractionCache = null;
    rolledBack = true;
  }

  return {
    rollback,
    async verify(): Promise<ToolResponse | null> {
      if (!session.revisionIdState || !session.aiAuthor) return null;
      const scope = {
        sessionStartId: session.revisionIdState.startId,
        expectedAuthor: session.aiAuthor,
      };
      const parts = await session.doc.getRevisionValidationParts();
      const issues = validateRevisions(parts, scope);
      const severity = partitionRevisionValidationIssues(issues, scope, session.validationBaseline);
      if (severity.errors.length === 0) return null;
      await rollback();
      return err(
        'REVISION_VALIDATION_FAILED',
        `AI-emitted revision validation failed: ${summarizeIssues(severity.errors)}`,
        'The attempted edit was rolled back; the session remains usable.',
      );
    },
  };
}
