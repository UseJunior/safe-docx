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

/**
 * Multiset of diagnostic fingerprints. Counts matter: structural diagnostics
 * (field-structure, package invariants) carry no per-instance location, so a
 * plain Set would let N newly-introduced instances hide behind one
 * pre-existing instance of the same finding.
 */
export function diagnosticCountMap(diagnostics: AiRevisionDiagnostic[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of diagnostics) {
    const key = aiRevisionDiagnosticKey(d);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Splits errors into those exceeding the pre-existing count for their
 * fingerprint (introduced — must fail) and those covered by it (demoted to
 * warnings). Consumes counts so duplicates beyond the baseline count fail.
 */
export function splitIntroducedDiagnostics(
  errors: AiRevisionDiagnostic[],
  preExisting: Map<string, number>,
): { introduced: AiRevisionDiagnostic[]; demoted: AiRevisionDiagnostic[] } {
  const remaining = new Map(preExisting);
  const introduced: AiRevisionDiagnostic[] = [];
  const demoted: AiRevisionDiagnostic[] = [];
  for (const e of errors) {
    const key = aiRevisionDiagnosticKey(e);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
      demoted.push({ ...e, severity: 'warning' as const });
    } else {
      introduced.push(e);
    }
  }
  return { introduced, demoted };
}

const sessionBaselineDiagnostics = new WeakMap<DocxSession, Promise<Map<string, number>>>();

/**
 * Error-fingerprint counts already present in the originally-loaded file.
 * Documents arrive from the wild with anomalies (unbalanced fields, odd
 * foreign markup) that no AI operation introduced; those must never
 * hard-fail a write or save.
 */
export function getAiRevisionBaseline(session: DocxSession): Promise<Map<string, number>> {
  let promise = sessionBaselineDiagnostics.get(session);
  if (!promise) {
    promise = (async () => {
      const originalDoc = await DocxDocument.load(session.originalBuffer);
      const validation = await originalDoc.validateAiRevisions(session.aiAuthor ?? '');
      return diagnosticCountMap(validation.errors);
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
    ({ introduced, demoted } = splitIntroducedDiagnostics(
      unattributed,
      diagnosticCountMap(preMutation.errors),
    ));
  }
  const failing = [...attributed, ...introduced];
  if (failing.length === 0) return null;

  return aiRevisionValidationFailure({
    errors: failing,
    warnings: [...validation.warnings, ...demoted],
  });
}
