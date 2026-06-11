import {
  DocxDocument,
  type AiRevisionDiagnostic,
  type AiRevisionValidationTouchedContext,
  type RevisionContext,
  type RevisionIdState,
} from '@usejunior/docx-core';
import { type DocxSession } from '../session/manager.js';
import { err, type ToolResponse } from './types.js';

function cloneRevisionIdState(state: RevisionIdState): RevisionIdState {
  return {
    nextId: state.nextId,
    moveRangeIds: new Map(state.moveRangeIds),
  };
}

export function cloneRevisionContext(ctx: RevisionContext | undefined): RevisionContext | undefined {
  if (!ctx) return undefined;
  return {
    author: ctx.author,
    date: ctx.date,
    idState: cloneRevisionIdState(ctx.idState),
  };
}

export function aiRevisionValidationFailure(
  diagnostics: { errors: AiRevisionDiagnostic[]; warnings: AiRevisionDiagnostic[] },
): ToolResponse {
  return {
    ...err(
      'AI_REVISION_VALIDATION_FAILED',
      'The requested edit would produce invalid AI-authored tracked-change markup.',
      'Repair the emitted revision markup before applying this edit.',
    ),
    diagnostics,
  };
}

/**
 * Stable fingerprint for one diagnostic, used to recognize the same finding
 * across two validation passes of the same session document.
 */
export function aiRevisionDiagnosticKey(d: AiRevisionDiagnostic): string {
  return [d.code, d.part ?? '', d.element ?? '', d.id ?? '', d.author ?? '', d.message].join('|');
}

const sessionBaselineDiagnostics = new WeakMap<DocxSession, Promise<Set<string>>>();

/**
 * Error fingerprints already present in the originally-loaded file. Documents
 * arrive from the wild with anomalies (unbalanced fields, odd foreign markup)
 * that no AI operation introduced; those must never hard-fail a write or save.
 */
export function getAiRevisionBaseline(session: DocxSession): Promise<Set<string>> {
  let promise = sessionBaselineDiagnostics.get(session);
  if (!promise) {
    promise = (async () => {
      const originalDoc = await DocxDocument.load(session.originalBuffer);
      const validation = await originalDoc.validateAiRevisions(session.aiAuthor ?? '');
      return new Set([...validation.errors, ...validation.warnings].map(aiRevisionDiagnosticKey));
    })();
    sessionBaselineDiagnostics.set(session, promise);
  }
  return promise;
}

export async function preflightAiRevisionMutation(
  session: DocxSession,
  ctx: RevisionContext | undefined,
  mutatePreview: (doc: DocxDocument, ctx: RevisionContext | undefined) => Promise<void> | void,
  touched?: AiRevisionValidationTouchedContext,
): Promise<ToolResponse | null> {
  if (!session.aiAuthor) return null;

  const snapshot = await session.doc.toBuffer({ cleanBookmarks: false });
  const previewDoc = await DocxDocument.load(snapshot.buffer);
  await mutatePreview(previewDoc, cloneRevisionContext(ctx));
  const validation = await previewDoc.validateAiRevisions(session.aiAuthor, touched);
  if (validation.errors.length === 0) return null;

  // AI-attributed errors always fail. Unattributable errors (field structure,
  // package invariants — no w:author to classify by) fail only when this
  // mutation introduced them: documents arrive from the wild with anomalies
  // no AI operation created, and those must not brick every write.
  const attributed = validation.errors.filter((e) => e.author === session.aiAuthor);
  const unattributed = validation.errors.filter((e) => e.author !== session.aiAuthor);
  let introduced = unattributed;
  let demoted: AiRevisionDiagnostic[] = [];
  if (unattributed.length > 0) {
    const preMutation = await session.doc.validateAiRevisions(session.aiAuthor, touched);
    const preExisting = new Set(preMutation.errors.map(aiRevisionDiagnosticKey));
    introduced = unattributed.filter((e) => !preExisting.has(aiRevisionDiagnosticKey(e)));
    demoted = unattributed
      .filter((e) => preExisting.has(aiRevisionDiagnosticKey(e)))
      .map((e) => ({ ...e, severity: 'warning' as const }));
  }
  const failing = [...attributed, ...introduced];
  if (failing.length === 0) return null;

  return aiRevisionValidationFailure({
    errors: failing,
    warnings: [...validation.warnings, ...demoted],
  });
}
