import { err, ok, type ToolResponse } from './types.js';

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

type NormalizedOperation = 'replace_text' | 'insert_paragraph';

type NormalizedStep = {
  step_id: string;
  operation: NormalizedOperation;
  source_plan_id: string;
  source_plan_index: number;
  source_step_index: number;
  target_paragraph_id?: string;
  positional_anchor_node_id?: string;
  position?: 'BEFORE' | 'AFTER';
  range?: { start: number; end: number };
  note?: string;
  arguments: Record<string, unknown>;
};

type NormalizedPlan = {
  plan_id: string;
  base_revision: number | null;
  source_plan_index: number;
  steps: NormalizedStep[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeOperation(value: unknown): NormalizedOperation | null {
  const raw = asTrimmedString(value)?.toLowerCase();
  if (!raw) return null;
  if (raw === 'replace_text') return 'replace_text';
  if (raw === 'insert_paragraph') return 'insert_paragraph';
  return null;
}

function extractRange(step: Record<string, unknown>): { start: number; end: number } | null | 'invalid' {
  const rangeRaw = step.range ?? step.span ?? step.match_range;
  if (rangeRaw == null) return null;
  const rangeObj = asRecord(rangeRaw);
  if (!rangeObj) return 'invalid';

  const start = asInteger(rangeObj.start);
  const end = asInteger(rangeObj.end);
  if (start == null || end == null) return 'invalid';
  if (end <= start) return 'invalid';
  return { start, end };
}

function stepRef(step: NormalizedStep): StepRef {
  return {
    plan_id: step.source_plan_id,
    plan_index: step.source_plan_index,
    step_index: step.source_step_index,
    step_id: step.step_id,
  };
}

function buildAutoStepId(planIndex: number, stepIndex: number): string {
  return `auto_${planIndex + 1}_${stepIndex + 1}`;
}

function cloneArguments(step: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(step)) {
    if (key === 'operation' || key === 'op' || key === 'step_id' || key === 'note' || key === 'range' || key === 'span' || key === 'match_range') {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function normalizePlans(
  plansRaw: unknown,
): { plans: NormalizedPlan[]; conflicts: Conflict[]; plan_count: number } {
  if (!Array.isArray(plansRaw)) {
    return {
      plans: [],
      plan_count: 0,
      conflicts: [
        {
          code: 'INVALID_INPUT',
          severity: 'hard',
          message: "'plans' must be an array.",
          step_refs: [],
        },
      ],
    };
  }

  const plans: NormalizedPlan[] = [];
  const conflicts: Conflict[] = [];

  for (let pIdx = 0; pIdx < plansRaw.length; pIdx += 1) {
    const planObj = asRecord(plansRaw[pIdx]);
    const planId = asTrimmedString(planObj?.plan_id) ?? `plan_${pIdx + 1}`;

    if (!planObj) {
      conflicts.push({
        code: 'INVALID_PLAN',
        severity: 'hard',
        message: `Plan at index ${pIdx} is not an object.`,
        step_refs: [],
      });
      continue;
    }

    const baseRevisionRaw = planObj.base_revision;
    const baseRevision = baseRevisionRaw == null ? null : asInteger(baseRevisionRaw);
    if (baseRevisionRaw != null && baseRevision == null) {
      conflicts.push({
        code: 'INVALID_BASE_REVISION',
        severity: 'hard',
        message: `Plan '${planId}' has invalid base_revision. Expected a non-negative integer.`,
        step_refs: [],
      });
    }

    const stepsRaw = planObj.steps;
    if (!Array.isArray(stepsRaw)) {
      conflicts.push({
        code: 'INVALID_PLAN_STEPS',
        severity: 'hard',
        message: `Plan '${planId}' must include a 'steps' array.`,
        step_refs: [],
      });
      continue;
    }

    const normalizedSteps: NormalizedStep[] = [];
    for (let sIdx = 0; sIdx < stepsRaw.length; sIdx += 1) {
      const stepObj = asRecord(stepsRaw[sIdx]);
      const generatedStepId = buildAutoStepId(pIdx, sIdx);
      const providedStepId = asTrimmedString(stepObj?.step_id);
      const finalStepId = providedStepId ?? generatedStepId;

      if (!stepObj) {
        conflicts.push({
          code: 'INVALID_STEP',
          severity: 'hard',
          message: `Step ${sIdx} in plan '${planId}' is not an object.`,
          step_refs: [{ plan_id: planId, plan_index: pIdx, step_index: sIdx, step_id: finalStepId }],
        });
        continue;
      }

      const operation = normalizeOperation(stepObj.operation ?? stepObj.op);
      if (!operation) {
        conflicts.push({
          code: 'INVALID_STEP_OPERATION',
          severity: 'hard',
          message: `Step '${finalStepId}' in plan '${planId}' has unsupported operation.`,
          step_refs: [{ plan_id: planId, plan_index: pIdx, step_index: sIdx, step_id: finalStepId }],
        });
        continue;
      }

      const baseStep: Omit<NormalizedStep, 'operation'> = {
        step_id: finalStepId,
        source_plan_id: planId,
        source_plan_index: pIdx,
        source_step_index: sIdx,
        note: asTrimmedString(stepObj.note),
        arguments: cloneArguments(stepObj),
      };

      if (operation === 'replace_text') {
        const targetParagraphId = asTrimmedString(stepObj.target_paragraph_id);
        if (!targetParagraphId) {
          conflicts.push({
            code: 'INVALID_STEP_TARGET',
            severity: 'hard',
            message: `replace_text step '${finalStepId}' in plan '${planId}' requires target_paragraph_id.`,
            step_refs: [{ plan_id: planId, plan_index: pIdx, step_index: sIdx, step_id: finalStepId }],
          });
          continue;
        }

        const range = extractRange(stepObj);
        if (range === 'invalid') {
          conflicts.push({
            code: 'INVALID_STEP_RANGE',
            severity: 'hard',
            message: `replace_text step '${finalStepId}' in plan '${planId}' has invalid range/span metadata.`,
            paragraph_id: targetParagraphId,
            step_refs: [{ plan_id: planId, plan_index: pIdx, step_index: sIdx, step_id: finalStepId }],
          });
          continue;
        }

        normalizedSteps.push({
          ...baseStep,
          operation,
          target_paragraph_id: targetParagraphId,
          range: range ?? undefined,
        });
        continue;
      }

      const anchorParagraphId =
        asTrimmedString(stepObj.positional_anchor_node_id)
        ?? asTrimmedString(stepObj.anchor_paragraph_id);
      if (!anchorParagraphId) {
        conflicts.push({
          code: 'INVALID_STEP_TARGET',
          severity: 'hard',
          message: `insert_paragraph step '${finalStepId}' in plan '${planId}' requires positional_anchor_node_id.`,
          step_refs: [{ plan_id: planId, plan_index: pIdx, step_index: sIdx, step_id: finalStepId }],
        });
        continue;
      }

      const position = (asTrimmedString(stepObj.position) ?? 'AFTER').toUpperCase();
      if (position !== 'BEFORE' && position !== 'AFTER') {
        conflicts.push({
          code: 'INVALID_STEP_POSITION',
          severity: 'hard',
          message: `insert_paragraph step '${finalStepId}' in plan '${planId}' has invalid position '${String(stepObj.position)}'.`,
          paragraph_id: anchorParagraphId,
          step_refs: [{ plan_id: planId, plan_index: pIdx, step_index: sIdx, step_id: finalStepId }],
        });
        continue;
      }

      normalizedSteps.push({
        ...baseStep,
        operation,
        positional_anchor_node_id: anchorParagraphId,
        position: position as 'BEFORE' | 'AFTER',
      });
    }

    plans.push({
      plan_id: planId,
      base_revision: baseRevision,
      source_plan_index: pIdx,
      steps: normalizedSteps,
    });
  }

  return {
    plans,
    conflicts,
    plan_count: plansRaw.length,
  };
}

function detectDuplicateStepIdConflicts(steps: NormalizedStep[]): Conflict[] {
  const byStepId = new Map<string, NormalizedStep[]>();
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
      message: `Duplicate step_id '${stepId}' detected across submitted plans.`,
      step_refs: dupeSteps.map((s) => stepRef(s)),
      details: { duplicate_step_id: stepId },
    });
  }
  return conflicts;
}

function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function detectReplaceConflicts(steps: NormalizedStep[]): Conflict[] {
  const replaceSteps = steps.filter((s) => s.operation === 'replace_text' && !!s.target_paragraph_id);
  const byParagraph = new Map<string, NormalizedStep[]>();
  for (const step of replaceSteps) {
    const paragraphId = step.target_paragraph_id!;
    const arr = byParagraph.get(paragraphId) ?? [];
    arr.push(step);
    byParagraph.set(paragraphId, arr);
  }

  const conflicts: Conflict[] = [];

  for (const [paragraphId, paragraphSteps] of byParagraph.entries()) {
    if (paragraphSteps.length < 2) continue;

    const unknownRangeSteps = paragraphSteps.filter((s) => !s.range);
    if (unknownRangeSteps.length > 0) {
      conflicts.push({
        code: 'UNKNOWN_REPLACE_RANGE',
        severity: 'hard',
        message: `replace_text steps targeting paragraph '${paragraphId}' require explicit non-overlapping ranges for deterministic merge.`,
        paragraph_id: paragraphId,
        step_refs: paragraphSteps.map((s) => stepRef(s)),
      });
      continue;
    }

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

function detectInsertSlotCollisions(steps: NormalizedStep[]): Conflict[] {
  const insertSteps = steps.filter(
    (s) => s.operation === 'insert_paragraph' && !!s.positional_anchor_node_id && !!s.position,
  );
  const bySlot = new Map<string, NormalizedStep[]>();
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

function detectBaseRevisionConflicts(
  plans: NormalizedPlan[],
  requireSharedBaseRevision: boolean,
): { conflicts: Conflict[]; mergedBaseRevision: number | null } {
  const revisions = new Set<number>();
  for (const plan of plans) {
    if (plan.base_revision == null) continue;
    revisions.add(plan.base_revision);
  }

  if (revisions.size === 0) {
    return { conflicts: [], mergedBaseRevision: null };
  }

  const mergedBaseRevision = revisions.size === 1 ? [...revisions][0]! : null;
  if (!requireSharedBaseRevision || revisions.size <= 1) {
    return { conflicts: [], mergedBaseRevision };
  }

  return {
    mergedBaseRevision,
    conflicts: [
      {
        code: 'BASE_REVISION_CONFLICT',
        severity: 'hard',
        message: `Submitted plans have mismatched base_revision values: ${[...revisions].sort((a, b) => a - b).join(', ')}.`,
        step_refs: [],
        details: {
          base_revisions: [...revisions].sort((a, b) => a - b),
        },
      },
    ],
  };
}

export async function mergePlans(
  params: {
    plans: unknown;
    fail_on_conflict?: boolean;
    require_shared_base_revision?: boolean;
  },
): Promise<ToolResponse> {
  try {
    const failOnConflict = asBoolean(params.fail_on_conflict, true);
    const requireSharedBaseRevision = asBoolean(params.require_shared_base_revision, true);

    const normalized = normalizePlans(params.plans);
    const normalizedPlans = normalized.plans;

    const flattenedSteps = normalizedPlans.flatMap((plan) => plan.steps);

    const revisionCheck = detectBaseRevisionConflicts(normalizedPlans, requireSharedBaseRevision);

    const conflicts: Conflict[] = [
      ...normalized.conflicts,
      ...revisionCheck.conflicts,
      ...detectDuplicateStepIdConflicts(flattenedSteps),
      ...detectReplaceConflicts(flattenedSteps),
      ...detectInsertSlotCollisions(flattenedSteps),
    ];

    const hasConflicts = conflicts.length > 0;

    const mergedPlan = {
      format: 'safe_docx_merged_plan_v1',
      generated_at: new Date().toISOString(),
      base_revision: revisionCheck.mergedBaseRevision,
      plan_count: normalized.plan_count,
      step_count: flattenedSteps.length,
      steps: flattenedSteps,
    };

    if (hasConflicts && failOnConflict) {
      return {
        success: false,
        error: {
          code: 'PLAN_CONFLICT',
          message: `Detected ${conflicts.length} hard conflict(s) while merging plans.`,
          hint: 'Resolve reported conflicts, or set fail_on_conflict=false to inspect diagnostics without hard failure.',
        },
        has_conflicts: true,
        conflict_count: conflicts.length,
        conflicts,
        merged_plan: mergedPlan,
      };
    }

    return ok({
      has_conflicts: hasConflicts,
      conflict_count: conflicts.length,
      conflicts,
      merged_plan: mergedPlan,
      conflict_policy: {
        fail_on_conflict: failOnConflict,
        require_shared_base_revision: requireSharedBaseRevision,
      },
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return err('MERGE_PLAN_ERROR', `Failed to merge plans: ${msg}`);
  }
}
