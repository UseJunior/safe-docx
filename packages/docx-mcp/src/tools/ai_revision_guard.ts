import {
  DocxDocument,
  type AiRevisionDiagnostic,
  type AiRevisionValidationTouchedContext,
  type RevisionContext,
  type RevisionIdState,
} from '@usejunior/docx-core';
import { type DocxSession } from '../session/manager.js';
import { checkFormattingConvention, type ConventionWarning } from './formatting_convention.js';
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

/**
 * Renders one non-blocking diagnostic as a plain string, matching the
 * plain-string `warnings` channels tool success responses already use
 * (format_layout and read_file expose `warnings` as human-readable strings;
 * batch_edit wraps the same human-readable strings with step metadata as
 * `{ step_id, warning }` entries). Location fields are appended when present
 * so an agent can act on the warning without re-running validation.
 */
export function formatAiRevisionWarning(d: AiRevisionDiagnostic): string {
  const location = [
    d.part,
    d.element,
    d.id ? `id=${d.id}` : undefined,
    d.author ? `author=${d.author}` : undefined,
  ]
    .filter((x): x is string => Boolean(x))
    .join(', ');
  return location ? `${d.code}: ${d.message} (${location})` : `${d.code}: ${d.message}`;
}

/**
 * Outcome of {@link preflightAiRevisionMutation}.
 *
 * `blocked` is the historical `ToolResponse | null` contract: non-null means
 * validation rejected the mutation and the caller must return that response
 * without applying the edit. `warnings` carries the non-blocking diagnostics
 * that used to be structurally dropped on the success path (issue #686), plus
 * any advisory findings computed off the same preview document (the
 * formatting-convention check, issue #687);
 * callers should surface them on their success response as an optional
 * `warnings?: string[]` field. When `blocked` is set, `warnings` is empty —
 * the blocking response already carries the full diagnostics
 * (errors + warnings) in its `diagnostics` field.
 *
 * `conventionWarnings` is the *same* findings as the convention entries in
 * `warnings`, in structured form — not an addition to them. A caller renders
 * `warnings` and ignores this, or (like batch_edit, which must attribute a
 * finding back to the step that produced it) reads this and ignores those.
 * Reading both double-reports.
 */
export type AiRevisionPreflightResult = {
  blocked: ToolResponse | null;
  warnings: string[];
  conventionWarnings: ConventionWarning[];
};

const PREFLIGHT_PROCEED: AiRevisionPreflightResult = Object.freeze({
  blocked: null,
  warnings: [],
  conventionWarnings: [],
});

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

/**
 * Non-validation advisories the caller wants computed off the same preview
 * round trip. `insertedText` is the text the mutation adds; supplying it opts
 * the mutation into the formatting-convention check (#687), which is skipped
 * outright when the inserted text carries no construct the check knows about.
 *
 * It rides here rather than on its own document load because the preview load
 * + mutate + validate round trip is already paid for on every AI-attributed
 * edit (150–195 ms measured on #687); a full run scan adds 1–2 ms on top.
 */
export type AiRevisionPreflightAdvisories = {
  insertedText?: string;
};

export async function preflightAiRevisionMutation(
  session: DocxSession,
  ctx: RevisionContext | undefined,
  mutatePreview: (doc: DocxDocument, ctx: RevisionContext | undefined) => Promise<void> | void,
  touched?: AiRevisionValidationTouchedContext,
  advisories?: AiRevisionPreflightAdvisories,
): Promise<AiRevisionPreflightResult> {
  if (!session.aiAuthor) return PREFLIGHT_PROCEED;

  const snapshot = await session.doc.toBuffer({ cleanBookmarks: false });
  // Two loads of the same bytes: `previewDoc` is mutated below, `baselineDoc`
  // stays as the document was before this mutation so the convention check can
  // difference them. Loading it from the same snapshot (rather than reusing
  // `session.doc`) keeps both sides on identical run boundaries, so the
  // difference reflects the edit and not a serialization artefact. It is only
  // paid for when a caller actually requests the advisory.
  const previewDoc = await DocxDocument.load(snapshot.buffer);
  const baselineDoc = advisories?.insertedText
    ? await DocxDocument.load(snapshot.buffer)
    : null;
  await mutatePreview(previewDoc, cloneRevisionContext(ctx));
  const validation = await previewDoc.validateAiRevisions(session.aiAuthor, touched);
  // Advisory only, and never on the blocked path: a blocked mutation is not
  // applied, so its formatting is not a finding the caller can act on.
  const conventionWarnings =
    advisories?.insertedText && baselineDoc
      ? checkFormattingConvention(previewDoc, {
          insertedText: advisories.insertedText,
          aiAuthor: session.aiAuthor,
          baselineDoc,
        })
      : [];
  const conventionMessages = conventionWarnings.map((w) => w.message);
  if (validation.errors.length === 0) {
    return {
      blocked: null,
      warnings: [...validation.warnings.map(formatAiRevisionWarning), ...conventionMessages],
      conventionWarnings,
    };
  }

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
  if (failing.length === 0) {
    // Demoted diagnostics are pre-existing anomalies this mutation did not
    // introduce; they must not block the write but they are still findings —
    // merge them into the surfaced warnings exactly as the failure path does.
    return {
      blocked: null,
      warnings: [
        ...[...validation.warnings, ...demoted].map(formatAiRevisionWarning),
        ...conventionMessages,
      ],
      conventionWarnings,
    };
  }

  return {
    blocked: aiRevisionValidationFailure({
      errors: failing,
      warnings: [...validation.warnings, ...demoted],
    }),
    warnings: [],
    conventionWarnings: [],
  };
}
