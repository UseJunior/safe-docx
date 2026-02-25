import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';

import { MCP_TOOLS } from '../server.js';
import { testAllure } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  createTrackedTempDir,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { applyPlan } from './apply_plan.js';
import { insertParagraph } from './insert_paragraph.js';
import { mergePlans } from './merge_plans.js';
import { readFile } from './read_file.js';

const TEST_FEATURE = 'add-apply-plan-and-style-source';

describe('Traceability: apply_plan + style_source_id', () => {
  registerCleanup();
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
  const humanReadableTest = test.allure({
    tags: ['human-readable'],
    parameters: { audience: 'non-technical' },
  });

  humanReadableTest.openspec('successful apply executes all steps')(
    'Scenario: successful apply executes all steps',
    async () => {
      const opened = await openSession(['Hello world', 'Second paragraph']);
      const result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'replace_text',
            target_paragraph_id: opened.paraIds[0],
            old_string: 'Hello world',
            new_string: 'Hello earth',
            instruction: 'replace first paragraph text',
          },
          {
            step_id: 's2',
            operation: 'replace_text',
            target_paragraph_id: opened.paraIds[1],
            old_string: 'Second paragraph',
            new_string: 'Updated paragraph',
            instruction: 'replace second paragraph text',
          },
        ],
      });

      assertSuccess(result);
      expect(result.completed_count).toBe(2);
      expect(result.completed_step_ids).toEqual(['s1', 's2']);
    },
  );

  humanReadableTest.openspec('validation failure returns all errors without applying')(
    'Scenario: validation failure returns all errors without applying',
    async () => {
      const opened = await openSession(['Hello world']);
      const result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'replace_text',
            target_paragraph_id: '_bk_missing_1',
            old_string: 'Hello',
            new_string: 'Hi',
            instruction: 'invalid replacement target',
          },
          {
            step_id: 's2',
            operation: 'insert_paragraph',
            positional_anchor_node_id: '_bk_missing_2',
            new_string: 'Inserted paragraph',
            instruction: 'invalid insert anchor',
          },
        ],
      });

      assertFailure(result, 'VALIDATION_FAILED');
      const steps = (result as { steps?: Array<{ step_id: string; valid: boolean; errors: string[] }> }).steps;
      expect(steps).toHaveLength(2);
      expect(steps?.[0]?.valid).toBe(false);
      expect(steps?.[1]?.valid).toBe(false);

      const read = await readFile(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(read);
      expect(String(read.content)).toContain('Hello world');
      expect(String(read.content)).not.toContain('Inserted paragraph');
    },
  );

  humanReadableTest.openspec('partial apply failure stops on first error')(
    'Scenario: partial apply failure stops on first error',
    async () => {
      const opened = await openSession(['Hello world', 'Second paragraph']);
      const result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'replace_text',
            target_paragraph_id: opened.paraIds[0],
            old_string: 'Hello world',
            new_string: 'Hello earth',
            instruction: 'first edit succeeds',
          },
          {
            step_id: 's2',
            operation: 'replace_text',
            target_paragraph_id: opened.paraIds[0],
            old_string: 'Hello world',
            new_string: 'Should fail on execution',
            instruction: 'fails after step 1 changes text',
          },
          {
            step_id: 's3',
            operation: 'replace_text',
            target_paragraph_id: opened.paraIds[1],
            old_string: 'Second paragraph',
            new_string: 'Should not run',
            instruction: 'must not execute',
          },
        ],
      });

      assertFailure(result, 'APPLY_PARTIAL_FAILURE');
      expect(result.completed_count).toBe(1);
      expect(result.completed_step_ids).toEqual(['s1']);
      expect(result.failed_step_id).toBe('s2');
      expect(result.failed_step_index).toBe(1);

      const read = await readFile(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(read);
      expect(String(read.content)).toContain('Hello earth');
      expect(String(read.content)).not.toContain('Should not run');
    },
  );

  humanReadableTest.openspec('step normalization accepts raw format')(
    'Scenario: step normalization accepts raw format',
    async () => {
      const opened = await openSession(['Hello world']);
      const result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'replace_text',
            target_paragraph_id: opened.firstParaId,
            old_string: 'Hello world',
            new_string: 'Hello raw format',
            instruction: 'raw format step',
          },
        ],
      });

      assertSuccess(result);
      expect(result.completed_count).toBe(1);
      expect(result.completed_step_ids).toEqual(['s1']);
    },
  );

  humanReadableTest.openspec('step normalization accepts merged format')(
    'Scenario: step normalization accepts merged format',
    async () => {
      const opened = await openSession(['Hello world']);
      const merged = await mergePlans({
        plans: [
          {
            plan_id: 'plan-a',
            steps: [
              {
                step_id: 's1',
                operation: 'replace_text',
                target_paragraph_id: opened.firstParaId,
                old_string: 'Hello world',
                new_string: 'Hello merged format',
                instruction: 'merged format step',
                range: { start: 0, end: 11 },
              },
            ],
          },
        ],
      });
      assertSuccess(merged);

      const result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: (merged.merged_plan as { steps: unknown[] }).steps,
      });

      assertSuccess(result);
      expect(result.completed_count).toBe(1);
      expect(result.completed_step_ids).toEqual(['s1']);
    },
  );

  humanReadableTest.openspec('__proto__ in step fields is rejected')(
    'Scenario: __proto__ in step fields is rejected',
    async () => {
      const opened = await openSession(['Hello world']);
      const steps = [{ step_id: 's1', operation: 'replace_text', __proto__: {} }];
      const rawSteps = JSON.parse(JSON.stringify(steps));
      Object.defineProperty(rawSteps[0], '__proto__', {
        value: { polluted: true },
        enumerable: true,
        configurable: true,
        writable: true,
      });

      const result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: rawSteps,
      });

      assertFailure(result, 'NORMALIZATION_ERROR');
      expect(String(result.error?.message ?? '')).toContain('__proto__');
    },
  );

  humanReadableTest.openspec('plan steps loaded from file path')(
    'Scenario: plan steps loaded from file path',
    async () => {
      const opened = await openSession(['Hello world']);
      const tmpDir = await createTrackedTempDir('apply-plan-file-');
      const planPath = path.join(tmpDir, 'plan.json');

      const fileSteps = [
        {
          step_id: 's1',
          operation: 'replace_text',
          target_paragraph_id: opened.firstParaId,
          old_string: 'Hello world',
          new_string: 'Hello from plan file',
          instruction: 'load plan from file',
        },
      ];
      await fs.writeFile(planPath, JSON.stringify(fileSteps), 'utf-8');

      const result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        plan_file_path: planPath,
      });

      assertSuccess(result);
      expect(result.completed_count).toBe(1);
      expect(result.completed_step_ids).toEqual(['s1']);
    },
  );

  humanReadableTest.openspec('error when both steps and plan_file_path supplied')(
    'Scenario: error when both steps and plan_file_path supplied',
    async () => {
      const opened = await openSession(['Hello world']);
      const result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [{ step_id: 's1', operation: 'replace_text' }],
        plan_file_path: '/tmp/plan.json',
      });

      assertFailure(result, 'INVALID_PARAMS');
    },
  );

  humanReadableTest.openspec('unsupported operation is rejected during validation')(
    'Scenario: unsupported operation is rejected during validation',
    async () => {
      const opened = await openSession(['Hello world']);
      const result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'delete_paragraph',
            target_paragraph_id: opened.firstParaId,
            instruction: 'unsupported operation',
          },
        ],
      });

      assertFailure(result, 'NORMALIZATION_ERROR');
      expect(String(result.error?.message ?? '')).toContain('unsupported operation');
    },
  );

  humanReadableTest.openspec('legacy aliases rejected during validation')(
    'Scenario: legacy aliases rejected during validation',
    async () => {
      const opened = await openSession(['Hello world']);
      const result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'smart_edit',
            target_paragraph_id: opened.firstParaId,
            old_string: 'Hello',
            new_string: 'Hi',
            instruction: 'legacy alias',
          },
        ],
      });

      assertFailure(result, 'NORMALIZATION_ERROR');
      expect(String(result.error?.message ?? '')).toContain('legacy operation');
    },
  );

  humanReadableTest.openspec('style_source_id clones formatting from specified paragraph')(
    'Scenario: style_source_id clones formatting from specified paragraph',
    async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>` +
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Heading</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>Body paragraph</w:t></w:r></w:p>` +
        `</w:body></w:document>`;

      const opened = await openSession([], { xml });
      const result = await insertParagraph(opened.mgr, {
        session_id: opened.sessionId,
        positional_anchor_node_id: opened.paraIds[0],
        position: 'AFTER',
        new_string: 'Inserted with body style source',
        instruction: 'insert after heading',
        style_source_id: opened.paraIds[1],
      });

      assertSuccess(result);
      expect(result.style_source_warning).toBeUndefined();
    },
  );

  humanReadableTest.openspec('style_source_id falls back to anchor with warning')(
    'Scenario: style_source_id falls back to anchor with warning',
    async () => {
      const opened = await openSession(['Hello world']);
      const result = await insertParagraph(opened.mgr, {
        session_id: opened.sessionId,
        positional_anchor_node_id: opened.firstParaId,
        position: 'AFTER',
        new_string: 'Inserted with fallback',
        instruction: 'insert with missing style source',
        style_source_id: '_bk_missing_style_source',
      });

      assertSuccess(result);
      expect(String(result.style_source_warning ?? '')).toContain('not found');
      expect(String(result.style_source_warning ?? '')).toContain('fell back');
    },
  );

  humanReadableTest.openspec('style_source_id omitted uses anchor formatting (backward compatible)')(
    'Scenario: style_source_id omitted uses anchor formatting (backward compatible)',
    async () => {
      const opened = await openSession(['Hello world']);
      const result = await insertParagraph(opened.mgr, {
        session_id: opened.sessionId,
        positional_anchor_node_id: opened.firstParaId,
        position: 'AFTER',
        new_string: 'Inserted without style source',
        instruction: 'insert with anchor style',
      });

      assertSuccess(result);
      expect(result.style_source_warning).toBeUndefined();
    },
  );

  humanReadableTest.openspec('canonical names are advertised')(
    'Scenario: canonical names are advertised',
    async () => {
      const toolNames = new Set<string>(MCP_TOOLS.map((tool) => tool.name));
      expect(toolNames.has('replace_text')).toBe(true);
      expect(toolNames.has('insert_paragraph')).toBe(true);
    },
  );

  humanReadableTest.openspec('legacy aliases are unavailable')(
    'Scenario: legacy aliases are unavailable',
    async () => {
      const toolNames = new Set<string>(MCP_TOOLS.map((tool) => tool.name));
      expect(toolNames.has('smart_edit')).toBe(false);
      expect(toolNames.has('smart_insert')).toBe(false);
    },
  );

  humanReadableTest.openspec('legacy aliases are rejected inside plan operations')(
    'Scenario: legacy aliases are rejected inside plan operations',
    async () => {
      const result = await mergePlans({
        plans: [
          {
            plan_id: 'legacy-edit',
            steps: [
              {
                step_id: 's1',
                operation: 'smart_edit',
                target_paragraph_id: '_bk_1',
                old_string: 'old',
                new_string: 'new',
                instruction: 'legacy alias',
              },
            ],
          },
        ],
      });

      assertFailure(result);
      const conflicts = (result as { conflicts?: Array<{ code: string }> }).conflicts ?? [];
      expect(conflicts.some((conflict) => conflict.code === 'INVALID_STEP_OPERATION')).toBe(true);
    },
  );

  humanReadableTest.openspec('legacy aliases are rejected inside apply_plan steps')(
    'Scenario: legacy aliases are rejected inside apply_plan steps',
    async () => {
      const opened = await openSession(['Hello world']);
      const result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'smart_insert',
            positional_anchor_node_id: opened.firstParaId,
            new_string: 'Legacy alias insert',
            instruction: 'legacy alias',
          },
        ],
      });

      assertFailure(result, 'NORMALIZATION_ERROR');
      expect(String(result.error?.message ?? '')).toContain('legacy operation');
    },
  );
});
