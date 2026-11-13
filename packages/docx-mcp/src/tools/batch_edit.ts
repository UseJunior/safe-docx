import fs from 'node:fs/promises';
import {
  DocxDocument,
  SafeDocxError,
  findUniqueSubstringMatch,
  replaceParagraphTextRange,
  isRecognizedBondedInsertionPair,
  collectRunInHeadingIds,
  getParagraphText,
  paragraphHasVisibleContent,
  type RevisionContext,
} from '@usejunior/docx-core';
import { SessionManager, getRevisionContextForSession, type DocxSession } from '../session/manager.js';
import { errorMessage } from '../error_utils.js';
import { err, ok, type ToolResponse } from './types.js';
import { enforceReadPathPolicy } from './path_policy.js';
import { replaceText, stripSearchTags } from './replace_text.js';
import { insertParagraph } from './insert_paragraph.js';
import { resolveSessionForTool } from './session_resolution.js';
import { cloneRevisionContext, preflightAiRevisionMutation } from './ai_revision_guard.js';
import {
  EMPTY_NUMBERED_PARAGRAPH_ERROR_CODE,
  applyEmptyNumberedParagraphPolicy,
  invalidEmptyNumberedParagraphPolicyMessage,
  isNowEmptyNumberedParagraph,
  parseEmptyNumberedParagraphPolicy,
  type EmptyNumberedParagraphPolicy,
} from './empty_numbered_paragraph.js';
import { insertedConstructKeys, type ConventionWarning } from './formatting_convention.js';

const REPLACE_TEXT_FIELDS = new Set([
  'target_paragraph_id',
  'old_string',
  'new_string',
  'instruction',
  'normalize_first',
]);

const INSERT_PARAGRAPH_FIELDS = new Set([
  'positional_anchor_node_id',
  'new_string',
  'instruction',
  'position',
  'style_source_id',
  'bonded_pair_id',
]);

const SUPPORTED_OPERATIONS = new Set(['replace_text', 'insert_paragraph']);
const LEGACY_ALIASES = new Set(['smart_edit', 'smart_insert']);
const MAX_PLAN_FILE_BYTES = 1 * 1024 * 1024;

type NormalizedOperation = 'replace_text' | 'insert_paragraph';

type NormalizedStep = {
  step_id: string;
  operation: NormalizedOperation;
  fields: Record<string, unknown>;
  resolved_range?: { start: number; end: number };
};

type StepValidation = {
  step_id: string;
  step_index: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
};

type StepRef = {
  plan_id: string;
  plan_index: number;
  step_index: number;
  step_id: string;
};

type Conflict = {
  code: string;
  severity: 'hard';
  message: string;
  paragraph_id?: string;
  step_refs: StepRef[];
  details?: Record<string, unknown>;
};

type ConflictStep = {
  step_id: string;
  operation: NormalizedOperation;
  source_plan_id: string;
  source_plan_index: number;
  source_step_index: number;
  target_paragraph_id?: string;
  positional_anchor_node_id?: string;
  position?: 'BEFORE' | 'AFTER';
  style_source_id?: string;
  bonded_pair_id?: string;
  range?: { start: number; end: number };
};

function normalizeSteps(rawSteps: unknown[]): { steps: NormalizedStep[]; errors: string[] } {
  const steps: NormalizedStep[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rawSteps.length; i++) {
    const raw = rawSteps[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`Step ${i}: not a valid object.`);
      continue;
    }

    const rawObj = raw as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(rawObj, '__proto__')) {
      errors.push(`Step ${i}: __proto__ key is not allowed.`);
      continue;
    }

    const operationRaw = String(rawObj.operation ?? rawObj.op ?? '').trim().toLowerCase();
    if (!operationRaw) {
      errors.push(`Step ${i}: missing operation field.`);
      continue;
    }

    if (LEGACY_ALIASES.has(operationRaw)) {
      errors.push(`Step ${i}: legacy operation '${operationRaw}' is not supported. Use 'replace_text' or 'insert_paragraph'.`);
      continue;
    }

    if (!SUPPORTED_OPERATIONS.has(operationRaw)) {
      errors.push(`Step ${i}: unsupported operation '${operationRaw}'. Use 'replace_text' or 'insert_paragraph'.`);
      continue;
    }

    const operation = operationRaw as NormalizedOperation;
    const stepId = typeof rawObj.step_id === 'string' ? rawObj.step_id.trim() : '';
    if (!stepId) {
      errors.push(`Step ${i}: missing or empty step_id.`);
      continue;
    }

    const knownFields = operation === 'replace_text' ? REPLACE_TEXT_FIELDS : INSERT_PARAGRAPH_FIELDS;
    const fields: Record<string, unknown> = {};
    for (const key of knownFields) {
      if (key in rawObj) fields[key] = rawObj[key];
    }

    steps.push({ step_id: stepId, operation, fields });
  }

  return { steps, errors };
}

function validateSteps(
  steps: NormalizedStep[],
  doc: { getParagraphTextById(id: string): string | null },
): StepValidation[] {
  const results: StepValidation[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const validation: StepValidation = {
      step_id: step.step_id,
      step_index: i,
      valid: true,
      errors: [],
      warnings: [],
    };

    if (step.operation === 'replace_text') {
      const targetId = step.fields.target_paragraph_id;
      if (typeof targetId !== 'string' || !targetId.trim()) {
        validation.errors.push('Missing target_paragraph_id.');
      } else {
        const text = doc.getParagraphTextById(targetId);
        if (text === null) {
          validation.errors.push(`target_paragraph_id '${targetId}' not found in document.`);
        } else {
          const oldStr = step.fields.old_string;
          if (typeof oldStr !== 'string') {
            validation.errors.push('Missing old_string.');
          } else {
            const stripped = stripSearchTags(oldStr);
            const matchResult = findUniqueSubstringMatch(text, stripped);
            if (matchResult.status === 'not_found') {
              validation.errors.push(
                `old_string not found in paragraph '${targetId}'. `
                + `Paragraph text (first 120 chars): "${text.slice(0, 120)}"`,
              );
            } else if (matchResult.status === 'multiple') {
              validation.errors.push(
                `old_string matched ${matchResult.matchCount} times in paragraph '${targetId}' `
                + `(${matchResult.mode} matching). Must be unique.`,
              );
            } else {
              step.resolved_range = { start: matchResult.start, end: matchResult.end };
            }
          }
        }
      }

      if (typeof step.fields.new_string !== 'string') validation.errors.push('Missing new_string.');
      if (typeof step.fields.instruction !== 'string') validation.errors.push('Missing instruction.');
    } else {
      const anchorId = step.fields.positional_anchor_node_id;
      if (typeof anchorId !== 'string' || !anchorId.trim()) {
        validation.errors.push('Missing positional_anchor_node_id.');
      } else {
        const text = doc.getParagraphTextById(anchorId);
        if (text === null) validation.errors.push(`positional_anchor_node_id '${anchorId}' not found in document.`);
      }

      if (typeof step.fields.new_string !== 'string') validation.errors.push('Missing new_string.');
      if (typeof step.fields.instruction !== 'string') validation.errors.push('Missing instruction.');

      const styleSourceId = step.fields.style_source_id;
      if (typeof styleSourceId === 'string' && styleSourceId.trim()) {
        const text = doc.getParagraphTextById(styleSourceId);
        if (text === null) {
          validation.warnings.push(`style_source_id '${styleSourceId}' not found; will fall back to anchor formatting.`);
        }
      }

      const pos = step.fields.position;
      if (pos !== undefined && pos !== 'BEFORE' && pos !== 'AFTER') {
        validation.errors.push(`Invalid position '${String(pos)}'. Must be 'BEFORE' or 'AFTER'.`);
      }
      const bondedPairId = step.fields.bonded_pair_id;
      if (bondedPairId !== undefined && (typeof bondedPairId !== 'string' || !bondedPairId.trim())) {
        validation.errors.push('bonded_pair_id must be a non-empty string when provided.');
      }
    }

    if (validation.errors.length > 0) validation.valid = false;
    results.push(validation);
  }

  return results;
}

async function loadStepsFromFile(filePath: string): Promise<{ steps: unknown[]; error?: undefined } | { steps?: undefined; error: ToolResponse }> {
  if (!filePath.endsWith('.json')) {
    return { error: err('INVALID_PLAN_FILE', `plan_file_path must have a .json extension: ${filePath}`) };
  }

  const pathCheck = await enforceReadPathPolicy(filePath);
  if (!pathCheck.ok) return { error: pathCheck.response };

  let stat: { size: number };
  try {
    stat = await fs.stat(pathCheck.resolvedPath);
  } catch {
    return { error: err('PLAN_FILE_NOT_FOUND', `Plan file not found: ${filePath}`) };
  }

  if (stat.size > MAX_PLAN_FILE_BYTES) {
    return { error: err('PLAN_FILE_TOO_LARGE', `Plan file exceeds 1MB limit (${stat.size} bytes): ${filePath}`) };
  }

  let content: string;
  try {
    content = await fs.readFile(pathCheck.resolvedPath, 'utf-8');
  } catch (e) {
    return { error: err('PLAN_FILE_READ_ERROR', `Failed to read plan file: ${errorMessage(e)}`) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { error: err('PLAN_FILE_PARSE_ERROR', `Failed to parse plan file as JSON: ${errorMessage(e)}`) };
  }

  if (!Array.isArray(parsed)) {
    return { error: err('PLAN_FILE_FORMAT_ERROR', 'Plan file must contain a JSON array of steps.') };
  }

  return { steps: parsed };
}

function stepRef(step: ConflictStep): StepRef {
  return {
    plan_id: step.source_plan_id,
    plan_index: step.source_plan_index,
    step_index: step.source_step_index,
    step_id: step.step_id,
  };
}

function detectDuplicateStepIdConflicts(steps: ConflictStep[]): Conflict[] {
  const byStepId = new Map<string, ConflictStep[]>();
  for (const step of steps) {
    const arr = byStepId.get(step.step_id) ?? [];
    arr.push(step);
    byStepId.set(step.step_id, arr);
  }

  const conflicts: Conflict[] = [];
  for (const [stepId, dupeSteps] of byStepId.entries()) {
    if (dupeSteps.length < 2) continue;
    conflicts.push({
      code: 'DUPLICATE_STEP_ID',
      severity: 'hard',
      message: `Duplicate step_id '${stepId}' detected in batch_edit steps.`,
      step_refs: dupeSteps.map((s) => stepRef(s)),
      details: { duplicate_step_id: stepId },
    });
  }
  return conflicts;
}

function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function detectReplaceConflicts(steps: ConflictStep[]): Conflict[] {
  const replaceSteps = steps.filter((s) => s.operation === 'replace_text' && !!s.target_paragraph_id);
  const byParagraph = new Map<string, ConflictStep[]>();
  for (const step of replaceSteps) {
    const paragraphId = step.target_paragraph_id!;
    const arr = byParagraph.get(paragraphId) ?? [];
    arr.push(step);
    byParagraph.set(paragraphId, arr);
  }

  const conflicts: Conflict[] = [];
  for (const [paragraphId, paragraphSteps] of byParagraph.entries()) {
    if (paragraphSteps.length < 2) continue;

    for (let i = 0; i < paragraphSteps.length; i += 1) {
      for (let j = i + 1; j < paragraphSteps.length; j += 1) {
        const a = paragraphSteps[i]!;
        const b = paragraphSteps[j]!;
        if (!a.range || !b.range) continue;
        if (!rangesOverlap(a.range, b.range)) continue;

        conflicts.push({
          code: 'OVERLAPPING_REPLACE_RANGE',
          severity: 'hard',
          message: `replace_text spans overlap in paragraph '${paragraphId}'.`,
          paragraph_id: paragraphId,
          step_refs: [stepRef(a), stepRef(b)],
          details: {
            first_range: a.range,
            second_range: b.range,
          },
        });
      }
    }
  }

  return conflicts;
}

function detectInsertSlotCollisions(steps: ConflictStep[], allowedBondedSlots = new Set<string>()): Conflict[] {
  const insertSteps = steps.filter(
    (s) => s.operation === 'insert_paragraph' && !!s.positional_anchor_node_id && !!s.position,
  );
  const bySlot = new Map<string, ConflictStep[]>();
  for (const step of insertSteps) {
    const slotKey = `${step.positional_anchor_node_id}::${step.position}`;
    const arr = bySlot.get(slotKey) ?? [];
    arr.push(step);
    bySlot.set(slotKey, arr);
  }

  const conflicts: Conflict[] = [];
  for (const [slotKey, slotSteps] of bySlot.entries()) {
    if (slotSteps.length < 2) continue;
    if (slotSteps.length === 2 && allowedBondedSlots.has(slotKey)) continue;
    const anchorId = slotSteps[0]!.positional_anchor_node_id!;
    const position = slotSteps[0]!.position!;
    conflicts.push({
      code: 'INSERT_SLOT_COLLISION',
      severity: 'hard',
      message: `Multiple insert_paragraph steps target the same slot '${slotKey}'.`,
      paragraph_id: anchorId,
      step_refs: slotSteps.map((s) => stepRef(s)),
      details: {
        anchor_paragraph_id: anchorId,
        position,
      },
    });
  }
  return conflicts;
}

function buildConflictView(steps: NormalizedStep[]): ConflictStep[] {
  return steps.map((step, index) => {
    if (step.operation === 'replace_text') {
      return {
        step_id: step.step_id,
        operation: step.operation,
        source_plan_id: 'batch',
        source_plan_index: 0,
        source_step_index: index,
        target_paragraph_id: step.fields.target_paragraph_id as string | undefined,
        range: step.resolved_range,
      };
    }

    return {
      step_id: step.step_id,
      operation: step.operation,
      source_plan_id: 'batch',
      source_plan_index: 0,
      source_step_index: index,
      positional_anchor_node_id: step.fields.positional_anchor_node_id as string | undefined,
      position: (step.fields.position as 'BEFORE' | 'AFTER' | undefined) ?? 'AFTER',
      style_source_id: step.fields.style_source_id as string | undefined,
      bonded_pair_id: step.fields.bonded_pair_id as string | undefined,
    };
  });
}

function recognizedBondedSlots(steps: ConflictStep[], doc: DocxDocument): Set<string> {
  const result = new Set<string>();
  const inserts = steps.filter((step) => step.operation === 'insert_paragraph' && step.bonded_pair_id);
  const groups = new Map<string, ConflictStep[]>();
  for (const step of inserts) groups.set(step.bonded_pair_id!, [...(groups.get(step.bonded_pair_id!) ?? []), step]);
  if (![...groups.values()].some((group) => group.length === 2)) return result;
  const nodes = doc.buildDocumentView({ includeSemanticTags: false, showFormatting: true }).nodes;
  const options = { runInHeadingIds: collectRunInHeadingIds(doc.getParagraphs()) };
  for (const group of groups.values()) {
    if (group.length !== 2 || group.some((step) => !step.style_source_id || !step.positional_anchor_node_id || !step.position)) continue;
    const contexts = group.map((step) => ({
      operationId: step.step_id,
      position: step.position!,
      anchorId: step.positional_anchor_node_id!,
      styleSourceId: step.style_source_id,
    }));
    if (isRecognizedBondedInsertionPair(nodes, contexts, options)) {
      result.add(`${group[0]!.positional_anchor_node_id}::${group[0]!.position}`);
    }
  }
  return result;
}

type EmptyNumberedFinding = { paragraphId: string; stepId: string; beforeText: string };

/**
 * Which step left which paragraph numbered but empty (issue #1047). The batch
 * judges its end state, not each step: a paragraph one step empties and a
 * later step fills again is not reported, and a paragraph stays attributed to
 * the step that emptied it while later steps leave it empty. Only a step that
 * empties a paragraph which had visible content is a culprit, so an empty
 * numbered paragraph the input already had is never reported.
 */
class EmptyNumberedParagraphTracker {
  private readonly culprits = new Map<string, { stepId: string; beforeText: string }>();

  before(doc: DocxDocument, paragraphId: string): { hadContent: boolean; beforeText: string } {
    const p = doc.getParagraphElementById(paragraphId);
    return { hadContent: !!p && paragraphHasVisibleContent(p), beforeText: p ? getParagraphText(p) : '' };
  }

  after(doc: DocxDocument, paragraphId: string, stepId: string, before: { hadContent: boolean; beforeText: string }): void {
    const p = doc.getParagraphElementById(paragraphId);
    if (!p || !isNowEmptyNumberedParagraph(doc, p)) {
      this.culprits.delete(paragraphId);
    } else if (before.hadContent) {
      this.culprits.set(paragraphId, { stepId, beforeText: before.beforeText });
    }
  }

  /** Culprit paragraphs that are still empty numbered paragraphs in `doc`, in the order the steps emptied them. */
  findings(doc: DocxDocument): EmptyNumberedFinding[] {
    const out: EmptyNumberedFinding[] = [];
    for (const [paragraphId, culprit] of this.culprits) {
      const p = doc.getParagraphElementById(paragraphId);
      if (p && isNowEmptyNumberedParagraph(doc, p)) out.push({ paragraphId, ...culprit });
    }
    return out;
  }
}

/** The `warn` message for each finding that is still in the document, with its step and paragraph. */
function describeEmptyNumberedFindings(
  doc: DocxDocument,
  findings: EmptyNumberedFinding[],
): Array<{ step_id: string; paragraph_id: string; message: string }> {
  const described: Array<{ step_id: string; paragraph_id: string; message: string }> = [];
  for (const finding of findings) {
    const paragraph = doc.getParagraphElementById(finding.paragraphId);
    if (!paragraph) continue;
    const outcome = applyEmptyNumberedParagraphPolicy({
      doc,
      paragraphId: finding.paragraphId,
      paragraph,
      hadContentBefore: true,
      beforeText: finding.beforeText,
      policy: 'warn',
      ctx: undefined,
    });
    if (outcome.kind !== 'none') described.push({ step_id: finding.stepId, paragraph_id: finding.paragraphId, message: outcome.message });
  }
  return described;
}

/** The findings as batch_edit `{ step_id, warning }` entries (`warn`, or any policy after a partial failure). */
function emptyNumberedWarnings(doc: DocxDocument, findings: EmptyNumberedFinding[]): Array<{ step_id: string; warning: string }> {
  return describeEmptyNumberedFindings(doc, findings).map((d) => ({ step_id: d.step_id, warning: d.message }));
}

function emptyNumberedBatchError(
  doc: DocxDocument,
  findings: EmptyNumberedFinding[],
): { message: string; findings: Array<{ step_id: string; paragraph_id: string; message: string }> } {
  const detailed = describeEmptyNumberedFindings(doc, findings);
  const steps = [...new Set(detailed.map((d) => `'${d.step_id}'`))].join(', ');
  return {
    message: `The batch would leave ${detailed.length} empty numbered paragraph(s) (step(s) ${steps}) and on_empty_numbered_paragraph is "error".`,
    findings: detailed,
  };
}

async function executeSteps(
  manager: SessionManager,
  session: DocxSession,
  filePath: string,
  steps: NormalizedStep[],
  tracker: EmptyNumberedParagraphTracker,
  ctx?: RevisionContext,
): Promise<{
  completed_step_ids: string[];
  failed_step_id?: string;
  failed_step_index?: number;
  failed_step_error?: string;
  step_results: Array<{ step_id: string; success: boolean; result?: Record<string, unknown> }>;
}> {
  const completedStepIds: string[] = [];
  const stepResults: Array<{ step_id: string; success: boolean; result?: Record<string, unknown> }> = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    let result: ToolResponse;

    if (step.operation === 'replace_text') {
      const paragraphId = step.fields.target_paragraph_id as string;
      const before = tracker.before(session.doc, paragraphId);
      result = await replaceText(manager, {
        file_path: filePath,
        target_paragraph_id: paragraphId,
        old_string: step.fields.old_string as string,
        new_string: step.fields.new_string as string,
        instruction: step.fields.instruction as string,
        normalize_first: step.fields.normalize_first as boolean | undefined,
        // The batch applies the policy to its end state (see the tracker).
        on_empty_numbered_paragraph: 'ignore',
        skip_ai_revision_preflight: true,
      }, ctx);
      if (result.success) tracker.after(session.doc, paragraphId, step.step_id, before);
    } else {
      result = await insertParagraph(manager, {
        file_path: filePath,
        positional_anchor_node_id: step.fields.positional_anchor_node_id as string,
        new_string: step.fields.new_string as string,
        instruction: step.fields.instruction as string,
        position: step.fields.position as string | undefined,
        style_source_id: step.fields.style_source_id as string | undefined,
        skip_ai_revision_preflight: true,
      }, ctx);
    }

    if (!result.success) {
      stepResults.push({ step_id: step.step_id, success: false, result: result as Record<string, unknown> });
      return {
        completed_step_ids: completedStepIds,
        failed_step_id: step.step_id,
        failed_step_index: i,
        failed_step_error: (result as { error?: { message?: string } }).error?.message ?? 'Unknown error',
        step_results: stepResults,
      };
    }

    completedStepIds.push(step.step_id);
    stepResults.push({ step_id: step.step_id, success: true, result: result as Record<string, unknown> });
  }

  return { completed_step_ids: completedStepIds, step_results: stepResults };
}

function invalidateDocumentCaches(doc: DocxDocument): void {
  doc.markMutated();
}

function executeStepOnDoc(doc: DocxDocument, step: NormalizedStep, ctx?: RevisionContext): void {
  if (step.operation === 'replace_text') {
    const targetParagraphId = step.fields.target_paragraph_id as string;
    const oldString = stripSearchTags(step.fields.old_string as string);
    const newString = step.fields.new_string as string;
    if (step.fields.normalize_first) doc.mergeRunsOnly();
    const pEl = doc.getParagraphElementById(targetParagraphId);
    if (!pEl) throw new Error(`Paragraph ID ${targetParagraphId} not found in document`);
    const text = doc.getParagraphTextById(targetParagraphId) ?? '';
    const match = findUniqueSubstringMatch(text, oldString);
    if (match.status !== 'unique') throw new Error(`replace_text preview failed for paragraph ${targetParagraphId}`);
    if (ctx) {
      replaceParagraphTextRange(pEl, match.start, match.end, newString, ctx);
      invalidateDocumentCaches(doc);
    } else {
      doc.replaceText({ targetParagraphId, findText: match.matchedText, replaceText: newString });
    }
    return;
  }

  doc.insertParagraph({
    positionalAnchorNodeId: step.fields.positional_anchor_node_id as string,
    relativePosition: (step.fields.position as 'BEFORE' | 'AFTER' | undefined) ?? 'AFTER',
    newText: step.fields.new_string as string,
    styleSourceId: step.fields.style_source_id as string | undefined,
  }, ctx);
}

function executeStepsOnDoc(
  doc: DocxDocument,
  steps: NormalizedStep[],
  ctx?: RevisionContext,
  tracker?: EmptyNumberedParagraphTracker,
): void {
  for (const step of steps) {
    const paragraphId = step.operation === 'replace_text' ? (step.fields.target_paragraph_id as string) : null;
    const before = tracker && paragraphId ? tracker.before(doc, paragraphId) : null;
    executeStepOnDoc(doc, step, ctx);
    if (tracker && paragraphId && before) tracker.after(doc, paragraphId, step.step_id, before);
  }
}

/**
 * Apply `remove_paragraph` to the batch's findings in one final mutation,
 * after every step has run. Removal is deferred to the end of the batch so
 * that every step's paragraph-id anchors resolve against the paragraphs the
 * caller validated: a later step can still target, or insert next to, a
 * paragraph an earlier step emptied, and a paragraph a later step fills
 * again is not removed. Each outcome is reported against the step that
 * emptied the paragraph.
 */
async function removeEmptyNumberedParagraphsAtBatchEnd(
  manager: SessionManager,
  session: DocxSession,
  findings: EmptyNumberedFinding[],
  ctx: RevisionContext | undefined,
): Promise<Array<{ step_id: string; warning: string }>> {
  const messages: Array<{ step_id: string; warning: string }> = [];
  const response = await manager.mutateSession(session, async (candidate) => {
    const activeCtx = await getRevisionContextForSession(candidate, ctx);
    for (const finding of findings) {
      const paragraph = candidate.doc.getParagraphElementById(finding.paragraphId);
      if (!paragraph) continue;
      const outcome = applyEmptyNumberedParagraphPolicy({
        doc: candidate.doc,
        paragraphId: finding.paragraphId,
        paragraph,
        hadContentBefore: true,
        beforeText: finding.beforeText,
        policy: 'remove_paragraph',
        ctx: activeCtx,
      });
      if (outcome.kind !== 'none') messages.push({ step_id: finding.stepId, warning: outcome.message });
    }
    if (messages.length > 0) manager.markEdited(candidate);
    return ok({});
  });
  if (!response.success) {
    throw new Error(`removing empty numbered paragraphs at the end of the batch failed: ${response.error.message}`);
  }
  return messages;
}

/**
 * Every step's inserted text, joined. The batch preflights once for the whole
 * sequence, so the formatting-convention gate (#687) sees the sequence's
 * inserted text as a unit; the newline join keeps one step's tail from fusing
 * with the next step's head into a construct neither step contains.
 */
function collectInsertedText(steps: NormalizedStep[]): string {
  return steps
    .map((step) => step.fields.new_string)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => stripSearchTags(value))
    .join('\n');
}

/**
 * Attribute each convention warning to the step whose inserted text carries
 * that construct. The preflight runs once for the whole sequence, so the step
 * is not otherwise recoverable — and batch_edit's `warnings` channel is
 * per-step `{ step_id, warning }` entries, so an unattributed warning has
 * nowhere to go. A warning that matches no step (possible only if a step's
 * text and the document disagree) falls back to the first step rather than
 * being dropped.
 */
function attributeConventionWarnings(
  steps: NormalizedStep[],
  warnings: ConventionWarning[],
): Array<{ step_id: string; warning: string }> {
  if (warnings.length === 0) return [];
  const byStep = steps.map((step) => ({
    stepId: step.step_id,
    keys: insertedConstructKeys(
      typeof step.fields.new_string === 'string' ? stripSearchTags(step.fields.new_string) : '',
    ),
  }));
  const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();

  return warnings.map((warning) => {
    const term = normalize(warning.term);
    const owner = byStep.find((entry) => entry.keys.get(warning.construct)?.has(term));
    return { step_id: owner?.stepId ?? byStep[0]?.stepId ?? '', warning: warning.message };
  });
}

export async function batchEdit(
  manager: SessionManager,
  params: {
    file_path?: string;
    steps?: unknown[];
    plan_file_path?: string;
    on_empty_numbered_paragraph?: string;
  },
): Promise<ToolResponse> {
  try {
    const emptyNumberedPolicy: EmptyNumberedParagraphPolicy | null = parseEmptyNumberedParagraphPolicy(params.on_empty_numbered_paragraph);
    if (!emptyNumberedPolicy) {
      return err('INVALID_PARAMS', invalidEmptyNumberedParagraphPolicyMessage(params.on_empty_numbered_paragraph));
    }
    if (params.steps !== undefined && params.plan_file_path) {
      return err('INVALID_PARAMS', 'Cannot provide both steps and plan_file_path. Use one or the other.');
    }

    if (params.steps === undefined && !params.plan_file_path) {
      return err('INVALID_PARAMS', 'Must provide either steps (JSON array) or plan_file_path.');
    }

    let rawSteps: unknown[];
    if (params.plan_file_path) {
      const loaded = await loadStepsFromFile(params.plan_file_path);
      if (loaded.error) return loaded.error;
      rawSteps = loaded.steps;
    } else if (Array.isArray(params.steps)) {
      rawSteps = params.steps;
    } else {
      return err('INVALID_PARAMS', 'steps must be a JSON array.');
    }

    const { steps, errors: normErrors } = normalizeSteps(rawSteps);
    if (normErrors.length > 0) {
      return err(
        'NORMALIZATION_ERROR',
        `Step normalization failed with ${normErrors.length} error(s): ${normErrors.join('; ')}`,
      );
    }

    if (steps.length === 0) return err('EMPTY_BATCH', 'Batch contains no valid steps.');

    const resolved = await resolveSessionForTool(manager, params, { toolName: 'batch_edit' });
    if (!resolved.ok) return resolved.response;
    const { session } = resolved;

    const validations = validateSteps(steps, session.doc);
    const overallValid = validations.every((v) => v.valid);
    if (!overallValid) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: `Batch validation failed: ${validations.filter((v) => !v.valid).length} of ${steps.length} step(s) have errors.`,
          hint: 'Fix the reported errors and resubmit.',
        },
        overall_valid: false,
        steps: validations,
      };
    }

    const allWarnings: Array<{ step_id: string; warning: string }> = validations.flatMap((v) =>
      v.warnings.map((w) => ({ step_id: v.step_id, warning: w })),
    );
    const conflictSteps = buildConflictView(steps);
    const conflicts = [
      ...detectDuplicateStepIdConflicts(conflictSteps),
      ...detectReplaceConflicts(conflictSteps),
      ...detectInsertSlotCollisions(conflictSteps, recognizedBondedSlots(conflictSteps, session.doc)),
    ];
    if (conflicts.length > 0) {
      return {
        success: false,
        error: {
          code: 'BATCH_CONFLICT',
          message: `Detected ${conflicts.length} hard conflict(s) in batch_edit steps.`,
          hint: 'Resolve reported conflicts and resubmit the batch.',
        },
        has_conflicts: true,
        conflict_count: conflicts.length,
        conflicts,
      };
    }

    const ctx = await getRevisionContextForSession({
      ...session,
      doc: session.doc.fork(),
      revisionIdState: session.revisionIdState ? structuredClone(session.revisionIdState) : null,
    });
    const revisionPreflight = await preflightAiRevisionMutation(
      session,
      ctx,
      (previewDoc, previewCtx) => executeStepsOnDoc(previewDoc, steps, previewCtx),
      undefined,
      { insertedText: collectInsertedText(steps) },
    );
    if (revisionPreflight.blocked) return revisionPreflight.blocked;
    // Structured form only — `revisionPreflight.warnings` carries the same
    // convention findings as flat strings, and reading both would report each
    // finding twice.
    allWarnings.push(...attributeConventionWarnings(steps, revisionPreflight.conventionWarnings));

    // Under "error", run the whole batch on a copy first and refuse it before
    // any step touches the session document (issue #1047).
    if (emptyNumberedPolicy === 'error') {
      const previewDoc = session.doc.fork();
      const previewTracker = new EmptyNumberedParagraphTracker();
      executeStepsOnDoc(previewDoc, steps, cloneRevisionContext(ctx), previewTracker);
      const previewFindings = previewTracker.findings(previewDoc);
      if (previewFindings.length > 0) {
        const refusal = emptyNumberedBatchError(previewDoc, previewFindings);
        return {
          success: false,
          error: {
            code: EMPTY_NUMBERED_PARAGRAPH_ERROR_CODE,
            message: `${refusal.message} No step was applied.`,
            hint: 'Delete each whole list item (its complete text with an empty new_string), keep some text in it, or choose another on_empty_numbered_paragraph policy.',
          },
          empty_numbered_paragraphs: refusal.findings,
        };
      }
    }

    const tracker = new EmptyNumberedParagraphTracker();
    const result = await executeSteps(manager, session, manager.normalizePath(session.originalPath), steps, tracker, ctx);
    for (const stepResult of result.step_results) {
      const stepWarnings = stepResult.result?.warnings;
      if (Array.isArray(stepWarnings)) {
        for (const w of stepWarnings) {
          if (typeof w === 'string') {
            allWarnings.push({ step_id: stepResult.step_id, warning: w });
          }
        }
      }
    }
    const emptyNumberedFindings = emptyNumberedPolicy === 'ignore' ? [] : tracker.findings(session.doc);
    if (result.failed_step_id !== undefined) {
      // The batch did not finish, so nothing is removed or refused at its
      // end; the caller is told which completed step left what behind.
      allWarnings.push(...emptyNumberedWarnings(session.doc, emptyNumberedFindings));
      const failedStepResult = result.step_results.find(
        (stepResult) => stepResult.step_id === result.failed_step_id && !stepResult.success,
      )?.result as { error?: { code?: string; message?: string; hint?: string } } | undefined;
      const nestedError = failedStepResult?.error;
      const preserveStructuralError =
        nestedError?.code === 'UNSAFE_CONTAINER_BOUNDARY' ||
        nestedError?.code === 'UNSUPPORTED_EDIT';
      return {
        success: false,
        error: {
          code: preserveStructuralError ? nestedError.code! : 'BATCH_PARTIAL_FAILURE',
          message: preserveStructuralError && nestedError.message
            ? `Batch execution stopped at step '${result.failed_step_id}' (index ${result.failed_step_index}): ${nestedError.message}`
            : `Batch execution stopped at step '${result.failed_step_id}' (index ${result.failed_step_index}).`,
          hint: (preserveStructuralError ? nestedError.hint : undefined) ??
            'Completed steps have already been applied. Reapply to original DOCX if rollback is needed.',
        },
        file_path: manager.normalizePath(session.originalPath),
        completed_count: result.completed_step_ids.length,
        completed_step_ids: result.completed_step_ids,
        failed_step_id: result.failed_step_id,
        failed_step_index: result.failed_step_index,
        failed_step_error: result.failed_step_error,
        step_results: result.step_results,
        ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
      };
    }

    if (emptyNumberedFindings.length > 0 && emptyNumberedPolicy === 'error') {
      // Unreachable while the preview above and the step executor agree on
      // the end state; reported rather than ignored if they ever diverge.
      const refusal = emptyNumberedBatchError(session.doc, emptyNumberedFindings);
      return {
        success: false,
        error: {
          code: EMPTY_NUMBERED_PARAGRAPH_ERROR_CODE,
          message: `${refusal.message} The steps were applied before this was detected.`,
          hint: 'Completed steps have already been applied. Reapply to original DOCX if rollback is needed.',
        },
        file_path: manager.normalizePath(session.originalPath),
        completed_count: result.completed_step_ids.length,
        completed_step_ids: result.completed_step_ids,
        step_results: result.step_results,
        empty_numbered_paragraphs: refusal.findings,
        ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
      };
    }
    if (emptyNumberedPolicy === 'warn') {
      allWarnings.push(...emptyNumberedWarnings(session.doc, emptyNumberedFindings));
    } else if (emptyNumberedPolicy === 'remove_paragraph' && emptyNumberedFindings.length > 0) {
      allWarnings.push(...await removeEmptyNumberedParagraphsAtBatchEnd(manager, session, emptyNumberedFindings, ctx));
    }

    return ok({
      file_path: manager.normalizePath(session.originalPath),
      edit_count: session.editCount,
      completed_count: result.completed_step_ids.length,
      completed_step_ids: result.completed_step_ids,
      step_results: result.step_results,
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
    });
  } catch (e: unknown) {
    if (e instanceof SafeDocxError) {
      return err(e.code, e.message, e.hint);
    }
    return err('BATCH_EDIT_ERROR', `Failed to apply batch edit: ${errorMessage(e)}`);
  }
}
