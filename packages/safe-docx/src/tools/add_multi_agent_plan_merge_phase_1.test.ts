import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';

import { initPlan } from './init_plan.js';
import { mergePlans } from './merge_plans.js';
import { testAllure } from '../testing/allure-test.js';
import {
  createTestSessionManager,
  createTrackedTempDir,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';

const TEST_FEATURE = 'add-multi-agent-plan-merge-phase-1';

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

async function writeDocx(paragraphs: string[], filename = 'input.docx'): Promise<string> {
  const dir = await createTrackedTempDir('safe-docx-plan-merge-');
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, new Uint8Array(await makeMinimalDocx(paragraphs)));
  return filePath;
}

describe('Traceability: Multi-Agent Plan Merge (Phase 1)', () => {
  registerCleanup();
  const test = testAllure.epic('OpenSpec Traceability').withLabels({ feature: TEST_FEATURE });
  const humanReadableTest = test.allure({
    tags: ['human-readable'],
    parameters: { audience: 'non-technical' },
  });

  humanReadableTest.openspec('init_plan returns revision-bound context')(
    'Scenario: init_plan returns revision-bound context',
    async () => {
      const manager = createTestSessionManager();
      const filePath = await writeDocx(['Alpha paragraph']);

      const result = await initPlan(manager, {
        file_path: filePath,
        plan_name: 'agreement-review',
        orchestrator_id: 'coordinator-1',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.plan_context_id).toMatch(/^plctx_[A-Za-z0-9]{12}$/);
      expect(result.base_revision).toBe(0);
      expect(typeof result.resolved_session_id).toBe('string');
      expect(result.resolved_file_path).toBe(manager.normalizePath(filePath));
      expect(result.plan_context).toMatchObject({
        plan_name: 'agreement-review',
        orchestrator_id: 'coordinator-1',
      });
    },
  );

  humanReadableTest.openspec('init_plan uses file-first session resolution')(
    'Scenario: init_plan uses file-first session resolution',
    async () => {
      const manager = createTestSessionManager();
      const filePath = await writeDocx(['Beta paragraph'], 'beta.docx');

      const result = await initPlan(manager, { file_path: filePath });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.session_resolution).toBe('opened_new_session');
      expect(typeof result.resolved_session_id).toBe('string');
      expect(result.resolved_file_path).toBe(manager.normalizePath(filePath));
    },
  );

  humanReadableTest.openspec('merge_plans returns merged artifact when no conflicts')(
    'Scenario: merge_plans returns merged artifact when no conflicts',
    async () => {
      const result = await mergePlans({
        plans: [
          {
            plan_id: 'termination',
            base_revision: 4,
            steps: [replaceStep('s1', 'jr_para_1', 0, 10)],
          },
          {
            plan_id: 'governing-law',
            base_revision: 4,
            steps: [replaceStep('s2', 'jr_para_1', 12, 20), insertStep('s3', 'jr_para_9', 'AFTER')],
          },
        ],
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.has_conflicts).toBe(false);
      expect(result.conflict_count).toBe(0);
      const merged = result.merged_plan as { steps: Array<{ step_id: string }> };
      expect(merged.steps.map((s) => s.step_id)).toEqual(['s1', 's2', 's3']);
    },
  );

  humanReadableTest.openspec('merge_plans reports base-revision conflict')(
    'Scenario: merge_plans reports base-revision conflict',
    async () => {
      const result = await mergePlans({
        plans: [
          { plan_id: 'a', base_revision: 1, steps: [replaceStep('s1', 'jr_para_1', 0, 5)] },
          { plan_id: 'b', base_revision: 2, steps: [replaceStep('s2', 'jr_para_2', 0, 5)] },
        ],
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      const conflicts = result.conflicts as Array<{ code: string }>;
      expect(conflicts.some((c) => c.code === 'BASE_REVISION_CONFLICT')).toBe(true);
    },
  );

  humanReadableTest.openspec('merge_plans reports overlapping replace ranges')(
    'Scenario: merge_plans reports overlapping replace ranges',
    async () => {
      const result = await mergePlans({
        plans: [
          { plan_id: 'a', base_revision: 9, steps: [replaceStep('s1', 'jr_para_7', 0, 8)] },
          { plan_id: 'b', base_revision: 9, steps: [replaceStep('s2', 'jr_para_7', 6, 12)] },
        ],
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      const conflicts = result.conflicts as Array<{ code: string }>;
      expect(conflicts.some((c) => c.code === 'OVERLAPPING_REPLACE_RANGE')).toBe(true);
    },
  );

  humanReadableTest.openspec('merge_plans reports unknown-range conflict for same paragraph')(
    'Scenario: merge_plans reports unknown-range conflict for same paragraph',
    async () => {
      const result = await mergePlans({
        plans: [
          {
            plan_id: 'a',
            base_revision: 5,
            steps: [
              {
                step_id: 's1',
                operation: 'replace_text',
                target_paragraph_id: 'jr_para_8',
                old_string: 'A',
                new_string: 'B',
                instruction: 'replace',
              },
            ],
          },
          {
            plan_id: 'b',
            base_revision: 5,
            steps: [replaceStep('s2', 'jr_para_8', 4, 9)],
          },
        ],
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      const conflicts = result.conflicts as Array<{ code: string }>;
      expect(conflicts.some((c) => c.code === 'UNKNOWN_REPLACE_RANGE')).toBe(true);
    },
  );

  humanReadableTest.openspec('merge_plans reports insert-slot collision')(
    'Scenario: merge_plans reports insert-slot collision',
    async () => {
      const result = await mergePlans({
        plans: [
          { plan_id: 'a', base_revision: 11, steps: [insertStep('s1', 'jr_para_10', 'AFTER')] },
          { plan_id: 'b', base_revision: 11, steps: [insertStep('s2', 'jr_para_10', 'AFTER')] },
        ],
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      const conflicts = result.conflicts as Array<{ code: string }>;
      expect(conflicts.some((c) => c.code === 'INSERT_SLOT_COLLISION')).toBe(true);
    },
  );

  humanReadableTest.openspec('merge_plans reports duplicate step IDs')(
    'Scenario: merge_plans reports duplicate step IDs',
    async () => {
      const result = await mergePlans({
        plans: [
          { plan_id: 'a', base_revision: 2, steps: [replaceStep('dup-id', 'jr_para_1', 0, 2)] },
          { plan_id: 'b', base_revision: 2, steps: [replaceStep('dup-id', 'jr_para_2', 0, 2)] },
        ],
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      const conflicts = result.conflicts as Array<{ code: string }>;
      expect(conflicts.some((c) => c.code === 'DUPLICATE_STEP_ID')).toBe(true);
    },
  );

  humanReadableTest.openspec('merge_plans fails by default when conflicts exist')(
    'Scenario: merge_plans fails by default when conflicts exist',
    async () => {
      const result = await mergePlans({
        plans: [
          { plan_id: 'a', base_revision: 1, steps: [replaceStep('s1', 'jr_para_1', 0, 8)] },
          { plan_id: 'b', base_revision: 1, steps: [replaceStep('s2', 'jr_para_1', 4, 10)] },
        ],
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('PLAN_CONFLICT');
      expect(result.has_conflicts).toBe(true);
    },
  );

  humanReadableTest.openspec('merge_plans can return diagnostics without hard failure')(
    'Scenario: merge_plans can return diagnostics without hard failure',
    async () => {
      const result = await mergePlans({
        fail_on_conflict: false,
        plans: [
          { plan_id: 'a', base_revision: 1, steps: [replaceStep('s1', 'jr_para_1', 0, 8)] },
          { plan_id: 'b', base_revision: 1, steps: [replaceStep('s2', 'jr_para_1', 4, 10)] },
        ],
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.has_conflicts).toBe(true);
      expect(result.conflict_count).toBeGreaterThan(0);
      expect((result.merged_plan as { step_count: number }).step_count).toBe(2);
    },
  );
});
