import fs from 'node:fs/promises';
import {
  DocxDocument,
  SafeDocxError,
  findUniqueSubstringMatch,
  replaceParagraphTextRange,
  type RevisionContext,
} from '@usejunior/docx-core';
import { SessionManager, getRevisionContextForSession } from '../session/manager.js';
import { errorMessage } from '../error_utils.js';
import { err, ok, type ToolResponse } from './types.js';
import { enforceReadPathPolicy } from './path_policy.js';
import { replaceText, stripSearchTags } from './replace_text.js';
import { insertParagraph } from './insert_paragraph.js';
import { resolveSessionForTool } from './session_resolution.js';
import { preflightAiRevisionMutation } from './ai_revision_guard.js';

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

function detectInsertSlotCollisions(steps: ConflictStep[]): Conflict[] {
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
    };
  });
}

async function executeSteps(
  manager: SessionManager,
  filePath: string,
  steps: NormalizedStep[],
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
      result = await replaceText(manager, {
        file_path: filePath,
        target_paragraph_id: step.fields.target_paragraph_id as string,
        old_string: step.fields.old_string as string,
        new_string: step.fields.new_string as string,
        instruction: step.fields.instruction as string,
        normalize_first: step.fields.normalize_first as boolean | undefined,
        skip_ai_revision_preflight: true,
      }, ctx);
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

function invalidateDocumentCaches(doc: unknown): void {
  const mutableDoc = doc as { dirty?: boolean; documentViewCache?: unknown };
  mutableDoc.dirty = true;
  mutableDoc.documentViewCache = null;
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

function executeStepsOnDoc(doc: DocxDocument, steps: NormalizedStep[], ctx?: RevisionContext): void {
  for (const step of steps) executeStepOnDoc(doc, step, ctx);
}

export async function batchEdit(
  manager: SessionManager,
  params: {
    file_path?: string;
    steps?: unknown[];
    plan_file_path?: string;
  },
): Promise<ToolResponse> {
  try {
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

    const allWarnings = validations.flatMap((v) => v.warnings.map((w) => ({ step_id: v.step_id, warning: w })));
    const conflictSteps = buildConflictView(steps);
    const conflicts = [
      ...detectDuplicateStepIdConflicts(conflictSteps),
      ...detectReplaceConflicts(conflictSteps),
      ...detectInsertSlotCollisions(conflictSteps),
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

    const ctx = await getRevisionContextForSession(session);
    const revisionPreflight = await preflightAiRevisionMutation(
      session,
      ctx,
      (previewDoc, previewCtx) => executeStepsOnDoc(previewDoc, steps, previewCtx),
    );
    if (revisionPreflight.blocked) return revisionPreflight.blocked;

    const result = await executeSteps(manager, manager.normalizePath(session.originalPath), steps, ctx);
    if (result.failed_step_id !== undefined) {
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
