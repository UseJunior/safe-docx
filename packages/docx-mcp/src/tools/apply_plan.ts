import fs from 'node:fs/promises';
import { findUniqueSubstringMatch } from '@usejunior/docx-core';
import { SessionManager } from '../session/manager.js';
import { errorMessage } from '../error_utils.js';
import { err, ok, type ToolResponse } from './types.js';
import { enforceReadPathPolicy } from './path_policy.js';
import { replaceText, stripSearchTags } from './replace_text.js';
import { insertParagraph } from './insert_paragraph.js';
import { resolveSessionForTool } from './session_resolution.js';

// ---------------------------------------------------------------------------
// Known fields per operation — only these are extracted during normalization.
// ---------------------------------------------------------------------------

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

const MAX_PLAN_FILE_BYTES = 1 * 1024 * 1024; // 1 MB

// ---------------------------------------------------------------------------
// Step normalization types
// ---------------------------------------------------------------------------

type NormalizedStep = {
  step_id: string;
  operation: 'replace_text' | 'insert_paragraph';
  fields: Record<string, unknown>;
};

type StepValidation = {
  step_id: string;
  step_index: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Normalization: accept both raw and merge_plans-envelope formats
// ---------------------------------------------------------------------------

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

    // Reject __proto__ pollution
    if (Object.prototype.hasOwnProperty.call(rawObj, '__proto__')) {
      errors.push(`Step ${i}: __proto__ key is not allowed.`);
      continue;
    }

    // Detect envelope format (merge_plans output has `arguments` sub-object)
    const hasEnvelope = typeof rawObj.arguments === 'object' && rawObj.arguments !== null && !Array.isArray(rawObj.arguments);
    const argsSource = hasEnvelope ? rawObj.arguments as Record<string, unknown> : rawObj;

    // Reject __proto__ in arguments envelope too
    if (hasEnvelope && Object.prototype.hasOwnProperty.call(argsSource, '__proto__')) {
      errors.push(`Step ${i}: __proto__ key is not allowed in arguments.`);
      continue;
    }

    // Extract operation — could be top-level or in arguments
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
      errors.push(`Step ${i}: unsupported operation '${operationRaw}'.`);
      continue;
    }

    const operation = operationRaw as 'replace_text' | 'insert_paragraph';

    // Extract step_id
    const stepId = typeof rawObj.step_id === 'string' ? rawObj.step_id.trim() : '';
    if (!stepId) {
      errors.push(`Step ${i}: missing or empty step_id.`);
      continue;
    }

    // Extract only known fields into a fresh object (prevents __proto__ pollution)
    const knownFields = operation === 'replace_text' ? REPLACE_TEXT_FIELDS : INSERT_PARAGRAPH_FIELDS;
    const fields: Record<string, unknown> = {};
    for (const key of knownFields) {
      if (key in argsSource) {
        fields[key] = argsSource[key];
      }
    }

    steps.push({ step_id: stepId, operation, fields });
  }

  return { steps, errors };
}

// ---------------------------------------------------------------------------
// Validation phase: check ALL steps before applying
// ---------------------------------------------------------------------------

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
          // Check old_string exists and matches in the paragraph.
          // Apply the same tag-stripping that replaceText does before matching.
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
            }
          }
        }
      }

      if (typeof step.fields.new_string !== 'string') {
        validation.errors.push('Missing new_string.');
      }
      if (typeof step.fields.instruction !== 'string') {
        validation.errors.push('Missing instruction.');
      }
    } else if (step.operation === 'insert_paragraph') {
      const anchorId = step.fields.positional_anchor_node_id;
      if (typeof anchorId !== 'string' || !anchorId.trim()) {
        validation.errors.push('Missing positional_anchor_node_id.');
      } else {
        const text = doc.getParagraphTextById(anchorId);
        if (text === null) {
          validation.errors.push(`positional_anchor_node_id '${anchorId}' not found in document.`);
        }
      }

      if (typeof step.fields.new_string !== 'string') {
        validation.errors.push('Missing new_string.');
      }
      if (typeof step.fields.instruction !== 'string') {
        validation.errors.push('Missing instruction.');
      }

      // Validate style_source_id — warning only, not error
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

// ---------------------------------------------------------------------------
// Load steps from file path
// ---------------------------------------------------------------------------

async function loadStepsFromFile(filePath: string): Promise<{ steps: unknown[]; error?: undefined } | { steps?: undefined; error: ToolResponse }> {
  if (!filePath.endsWith('.json')) {
    return { error: err('INVALID_PLAN_FILE', `plan_file_path must have a .json extension: ${filePath}`) };
  }

  const pathCheck = await enforceReadPathPolicy(filePath);
  if (!pathCheck.ok) {
    return { error: pathCheck.response };
  }

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

// ---------------------------------------------------------------------------
// Apply phase: execute steps sequentially, stop on first error
// ---------------------------------------------------------------------------

async function executeSteps(
  manager: SessionManager,
  sessionId: string,
  steps: NormalizedStep[],
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
        session_id: sessionId,
        target_paragraph_id: step.fields.target_paragraph_id as string,
        old_string: step.fields.old_string as string,
        new_string: step.fields.new_string as string,
        instruction: step.fields.instruction as string,
        normalize_first: step.fields.normalize_first as boolean | undefined,
      });
    } else {
      result = await insertParagraph(manager, {
        session_id: sessionId,
        positional_anchor_node_id: step.fields.positional_anchor_node_id as string,
        new_string: step.fields.new_string as string,
        instruction: step.fields.instruction as string,
        position: step.fields.position as string | undefined,
        style_source_id: step.fields.style_source_id as string | undefined,
      });
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

// ---------------------------------------------------------------------------
// Main tool entry point
// ---------------------------------------------------------------------------

export async function applyPlan(
  manager: SessionManager,
  params: {
    session_id?: string;
    file_path?: string;
    steps?: unknown[];
    plan_file_path?: string;
  },
): Promise<ToolResponse> {
  try {
    // Validate mutual exclusivity of steps and plan_file_path
    if (params.steps && params.plan_file_path) {
      return err(
        'INVALID_PARAMS',
        'Cannot provide both steps and plan_file_path. Use one or the other.',
      );
    }

    if (!params.steps && !params.plan_file_path) {
      return err(
        'INVALID_PARAMS',
        'Must provide either steps (JSON array) or plan_file_path.',
      );
    }

    // Load steps
    let rawSteps: unknown[];
    if (params.plan_file_path) {
      const loaded = await loadStepsFromFile(params.plan_file_path);
      if (loaded.error) return loaded.error;
      rawSteps = loaded.steps;
    } else {
      rawSteps = params.steps!;
    }

    // Normalize steps
    const { steps, errors: normErrors } = normalizeSteps(rawSteps);
    if (normErrors.length > 0) {
      return err(
        'NORMALIZATION_ERROR',
        `Step normalization failed with ${normErrors.length} error(s): ${normErrors.join('; ')}`,
      );
    }

    if (steps.length === 0) {
      return err('EMPTY_PLAN', 'Plan contains no valid steps.');
    }

    // Resolve session
    const resolved = await resolveSessionForTool(manager, params, { toolName: 'apply_plan' });
    if (!resolved.ok) return resolved.response;
    const { session } = resolved;

    // Validation phase — check ALL steps before applying
    const validations = validateSteps(steps, session.doc);
    const overallValid = validations.every((v) => v.valid);

    if (!overallValid) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: `Plan validation failed: ${validations.filter((v) => !v.valid).length} of ${steps.length} step(s) have errors.`,
          hint: 'Fix the reported errors and resubmit.',
        },
        overall_valid: false,
        steps: validations,
      };
    }

    // Collect warnings
    const allWarnings = validations.flatMap((v) => v.warnings.map((w) => ({ step_id: v.step_id, warning: w })));

    // Apply phase — execute steps sequentially
    const result = await executeSteps(manager, session.sessionId, steps);

    if (result.failed_step_id !== undefined) {
      return {
        success: false,
        error: {
          code: 'APPLY_PARTIAL_FAILURE',
          message: `Plan execution stopped at step '${result.failed_step_id}' (index ${result.failed_step_index}).`,
          hint: 'Completed steps have already been applied. Reapply to original DOCX if rollback is needed.',
        },
        session_id: session.sessionId,
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
      session_id: session.sessionId,
      edit_count: session.editCount,
      completed_count: result.completed_step_ids.length,
      completed_step_ids: result.completed_step_ids,
      step_results: result.step_results,
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
    });
  } catch (e: unknown) {
    return err('APPLY_PLAN_ERROR', `Failed to apply plan: ${errorMessage(e)}`);
  }
}
