import { describe, expect } from 'vitest';
import { mergePlans } from './merge_plans.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const replaceStep = (
  stepId: string,
  paragraphId: string,
  start: number,
  end: number,
): Record<string, unknown> => ({
  step_id: stepId,
  operation: 'replace_text',
  target_paragraph_id: paragraphId,
  range: { start, end },
  old_string: 'old',
  new_string: 'new',
  instruction: 'replace',
});

const insertStep = (
  stepId: string,
  anchorId: string,
  position: 'BEFORE' | 'AFTER',
): Record<string, unknown> => ({
  step_id: stepId,
  operation: 'insert_paragraph',
  positional_anchor_node_id: anchorId,
  position,
  new_string: 'inserted text',
  instruction: 'insert',
});

describe('merge_plans tool', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: 'merge_plans tool' });

  test('returns merged artifact when no hard conflicts exist', async ({ given, when, then }: AllureBddContext) => {
    let result: Awaited<ReturnType<typeof mergePlans>>;

    await given('two plans at the same base revision with non-overlapping steps', () => {
      // plans defined inline in when
    });

    await when('mergePlans is called with the two plans', async () => {
      result = await mergePlans({
        plans: [
          {
            plan_id: 'termination',
            base_revision: 4,
            steps: [replaceStep('s1', '_bk_1', 0, 10)],
          },
          {
            plan_id: 'governing-law',
            base_revision: 4,
            steps: [replaceStep('s2', '_bk_1', 12, 20), insertStep('s3', '_bk_9', 'AFTER')],
          },
        ],
      });
    });

    await then('a merged plan with all 3 steps is returned without conflicts', () => {
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.has_conflicts).toBe(false);
      expect(result.conflict_count).toBe(0);
      const merged = result.merged_plan as { step_count: number; base_revision: number; steps: Array<{ step_id: string }> };
      expect(merged.step_count).toBe(3);
      expect(merged.base_revision).toBe(4);
      expect(merged.steps.map((s) => s.step_id)).toEqual(['s1', 's2', 's3']);
    });
  });

  test('fails by default on base revision mismatch', async ({ given, when, then }: AllureBddContext) => {
    let result: Awaited<ReturnType<typeof mergePlans>>;

    await given('two plans at different base revisions', () => {
      // plans defined inline in when
    });

    await when('mergePlans is called', async () => {
      result = await mergePlans({
        plans: [
          { plan_id: 'a', base_revision: 1, steps: [replaceStep('s1', '_bk_1', 0, 5)] },
          { plan_id: 'b', base_revision: 2, steps: [replaceStep('s2', '_bk_2', 0, 5)] },
        ],
      });
    });

    await then('the result fails with a BASE_REVISION_CONFLICT', () => {
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('PLAN_CONFLICT');
      expect(result.has_conflicts).toBe(true);
      const conflicts = result.conflicts as Array<{ code: string }>;
      expect(conflicts.some((c) => c.code === 'BASE_REVISION_CONFLICT')).toBe(true);
    });
  });

  test('detects overlapping replace ranges', async ({ given, when, then }: AllureBddContext) => {
    let result: Awaited<ReturnType<typeof mergePlans>>;

    await given('two plans with overlapping replace ranges on the same paragraph', () => {
      // plans defined inline in when
    });

    await when('mergePlans is called', async () => {
      result = await mergePlans({
        plans: [
          { plan_id: 'a', base_revision: 9, steps: [replaceStep('s1', '_bk_7', 0, 8)] },
          { plan_id: 'b', base_revision: 9, steps: [replaceStep('s2', '_bk_7', 6, 12)] },
        ],
      });
    });

    await then('an OVERLAPPING_REPLACE_RANGE conflict is reported', () => {
      expect(result.success).toBe(false);
      if (result.success) return;
      const conflicts = result.conflicts as Array<{ code: string }>;
      expect(conflicts.some((c) => c.code === 'OVERLAPPING_REPLACE_RANGE')).toBe(true);
    });
  });

  test('detects unknown replace range conflict for same paragraph', async ({ given, when, then }: AllureBddContext) => {
    let result: Awaited<ReturnType<typeof mergePlans>>;

    await given('two plans where one step has a range and the other does not, targeting the same paragraph', () => {
      // plans defined inline in when
    });

    await when('mergePlans is called', async () => {
      result = await mergePlans({
        plans: [
          {
            plan_id: 'a',
            base_revision: 5,
            steps: [{ step_id: 's1', operation: 'replace_text', target_paragraph_id: '_bk_8', old_string: 'A', new_string: 'B', instruction: 'replace' }],
          },
          {
            plan_id: 'b',
            base_revision: 5,
            steps: [replaceStep('s2', '_bk_8', 4, 9)],
          },
        ],
      });
    });

    await then('an UNKNOWN_REPLACE_RANGE conflict is reported', () => {
      expect(result.success).toBe(false);
      if (result.success) return;
      const conflicts = result.conflicts as Array<{ code: string }>;
      expect(conflicts.some((c) => c.code === 'UNKNOWN_REPLACE_RANGE')).toBe(true);
    });
  });

  test('detects insert slot collisions', async ({ given, when, then }: AllureBddContext) => {
    let result: Awaited<ReturnType<typeof mergePlans>>;

    await given('two plans both inserting AFTER the same anchor paragraph', () => {
      // plans defined inline in when
    });

    await when('mergePlans is called', async () => {
      result = await mergePlans({
        plans: [
          { plan_id: 'a', base_revision: 11, steps: [insertStep('s1', '_bk_10', 'AFTER')] },
          { plan_id: 'b', base_revision: 11, steps: [insertStep('s2', '_bk_10', 'AFTER')] },
        ],
      });
    });

    await then('an INSERT_SLOT_COLLISION conflict is reported', () => {
      expect(result.success).toBe(false);
      if (result.success) return;
      const conflicts = result.conflicts as Array<{ code: string }>;
      expect(conflicts.some((c) => c.code === 'INSERT_SLOT_COLLISION')).toBe(true);
    });
  });

  test('detects duplicate step IDs', async ({ given, when, then }: AllureBddContext) => {
    let result: Awaited<ReturnType<typeof mergePlans>>;

    await given('two plans that both use the same step ID', () => {
      // plans defined inline in when
    });

    await when('mergePlans is called', async () => {
      result = await mergePlans({
        plans: [
          { plan_id: 'a', base_revision: 2, steps: [replaceStep('dup-id', '_bk_1', 0, 2)] },
          { plan_id: 'b', base_revision: 2, steps: [replaceStep('dup-id', '_bk_2', 0, 2)] },
        ],
      });
    });

    await then('a DUPLICATE_STEP_ID conflict is reported', () => {
      expect(result.success).toBe(false);
      if (result.success) return;
      const conflicts = result.conflicts as Array<{ code: string }>;
      expect(conflicts.some((c) => c.code === 'DUPLICATE_STEP_ID')).toBe(true);
    });
  });

  test('rejects legacy operation aliases', async ({ given, when, then }: AllureBddContext) => {
    let result: Awaited<ReturnType<typeof mergePlans>>;

    await given('a plan with a step using the deprecated "smart_edit" operation', () => {
      // plan defined inline in when
    });

    await when('mergePlans is called', async () => {
      result = await mergePlans({
        plans: [
          {
            plan_id: 'legacy',
            base_revision: 3,
            steps: [
              {
                step_id: 's1',
                operation: 'smart_edit',
                target_paragraph_id: '_bk_1',
                old_string: 'old',
                new_string: 'new',
                instruction: 'replace',
              },
            ],
          },
        ],
      });
    });

    await then('the result fails with an INVALID_STEP_OPERATION conflict', () => {
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('PLAN_CONFLICT');
      const conflicts = result.conflicts as Array<{ code: string }>;
      expect(conflicts.some((c) => c.code === 'INVALID_STEP_OPERATION')).toBe(true);
    });
  });

  test('returns diagnostics without hard failure when fail_on_conflict=false', async ({ given, when, then }: AllureBddContext) => {
    let result: Awaited<ReturnType<typeof mergePlans>>;

    await given('two plans with an overlapping range conflict and fail_on_conflict disabled', () => {
      // plans defined inline in when
    });

    await when('mergePlans is called with fail_on_conflict=false', async () => {
      result = await mergePlans({
        fail_on_conflict: false,
        plans: [
          { plan_id: 'a', base_revision: 1, steps: [replaceStep('s1', '_bk_1', 0, 8)] },
          { plan_id: 'b', base_revision: 1, steps: [replaceStep('s2', '_bk_1', 4, 10)] },
        ],
      });
    });

    await then('the call succeeds but reports conflicts in the diagnostics', () => {
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.has_conflicts).toBe(true);
      expect(result.conflict_count).toBeGreaterThan(0);
    });
  });
});
