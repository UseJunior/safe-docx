import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';

import { MCP_TOOLS } from '../server.js';
import { testAllure, allureStep } from '../testing/allure-test.js';
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
      const result = await allureStep('Given a session with two paragraphs and a two-step replace plan', async () => {
        const opened = await openSession(['Hello world', 'Second paragraph']);
        return applyPlan(opened.mgr, {
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
      });

      await allureStep('Then both steps complete successfully', () => {
        assertSuccess(result);
        expect(result.completed_count).toBe(2);
        expect(result.completed_step_ids).toEqual(['s1', 's2']);
      });
    },
  );

  humanReadableTest.openspec('validation failure returns all errors without applying')(
    'Scenario: validation failure returns all errors without applying',
    async () => {
      const { opened, result } = await allureStep('Given a plan with two steps targeting missing paragraphs', async () => {
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
        return { opened, result };
      });

      await allureStep('Then validation fails and both steps are marked invalid', () => {
        assertFailure(result, 'VALIDATION_FAILED');
        const steps = (result as { steps?: Array<{ step_id: string; valid: boolean; errors: string[] }> }).steps;
        expect(steps).toHaveLength(2);
        expect(steps?.[0]?.valid).toBe(false);
        expect(steps?.[1]?.valid).toBe(false);
      });

      await allureStep('Then the document content is unchanged', async () => {
        const read = await readFile(opened.mgr, { session_id: opened.sessionId });
        assertSuccess(read);
        expect(String(read.content)).toContain('Hello world');
        expect(String(read.content)).not.toContain('Inserted paragraph');
      });
    },
  );

  humanReadableTest.openspec('partial apply failure stops on first error')(
    'Scenario: partial apply failure stops on first error',
    async () => {
      const { opened, result } = await allureStep('Given a three-step plan where step 2 targets stale text', async () => {
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
        return { opened, result };
      });

      await allureStep('Then apply stops at step 2 with partial failure', () => {
        assertFailure(result, 'APPLY_PARTIAL_FAILURE');
        expect(result.completed_count).toBe(1);
        expect(result.completed_step_ids).toEqual(['s1']);
        expect(result.failed_step_id).toBe('s2');
        expect(result.failed_step_index).toBe(1);
      });

      await allureStep('Then only step 1 changes are present in the document', async () => {
        const read = await readFile(opened.mgr, { session_id: opened.sessionId });
        assertSuccess(read);
        expect(String(read.content)).toContain('Hello earth');
        expect(String(read.content)).not.toContain('Should not run');
      });
    },
  );

  humanReadableTest.openspec('step normalization accepts raw format')(
    'Scenario: step normalization accepts raw format',
    async () => {
      const result = await allureStep('Given a plan with a raw-format step', async () => {
        const opened = await openSession(['Hello world']);
        return applyPlan(opened.mgr, {
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
      });

      await allureStep('Then the raw-format step completes successfully', () => {
        assertSuccess(result);
        expect(result.completed_count).toBe(1);
        expect(result.completed_step_ids).toEqual(['s1']);
      });
    },
  );

  humanReadableTest.openspec('step normalization accepts merged format')(
    'Scenario: step normalization accepts merged format',
    async () => {
      const result = await allureStep('Given a plan whose steps come from mergePlans output', async () => {
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

        return applyPlan(opened.mgr, {
          session_id: opened.sessionId,
          steps: (merged.merged_plan as { steps: unknown[] }).steps,
        });
      });

      await allureStep('Then the merged-format step completes successfully', () => {
        assertSuccess(result);
        expect(result.completed_count).toBe(1);
        expect(result.completed_step_ids).toEqual(['s1']);
      });
    },
  );

  humanReadableTest.openspec('__proto__ in step fields is rejected')(
    'Scenario: __proto__ in step fields is rejected',
    async () => {
      const result = await allureStep('Given a plan step containing a __proto__ field', async () => {
        const opened = await openSession(['Hello world']);
        const steps = [{ step_id: 's1', operation: 'replace_text', __proto__: {} }];
        const rawSteps = JSON.parse(JSON.stringify(steps));
        Object.defineProperty(rawSteps[0], '__proto__', {
          value: { polluted: true },
          enumerable: true,
          configurable: true,
          writable: true,
        });

        return applyPlan(opened.mgr, {
          session_id: opened.sessionId,
          steps: rawSteps,
        });
      });

      await allureStep('Then normalization rejects the step with a __proto__ error', () => {
        assertFailure(result, 'NORMALIZATION_ERROR');
        expect(String(result.error?.message ?? '')).toContain('__proto__');
      });
    },
  );

  humanReadableTest.openspec('plan steps loaded from file path')(
    'Scenario: plan steps loaded from file path',
    async () => {
      const result = await allureStep('Given a plan written to a JSON file and applied via plan_file_path', async () => {
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

        return applyPlan(opened.mgr, {
          session_id: opened.sessionId,
          plan_file_path: planPath,
        });
      });

      await allureStep('Then the file-loaded plan step completes successfully', () => {
        assertSuccess(result);
        expect(result.completed_count).toBe(1);
        expect(result.completed_step_ids).toEqual(['s1']);
      });
    },
  );

  humanReadableTest.openspec('error when both steps and plan_file_path supplied')(
    'Scenario: error when both steps and plan_file_path supplied',
    async () => {
      const result = await allureStep('Given a plan with both steps and plan_file_path supplied', async () => {
        const opened = await openSession(['Hello world']);
        return applyPlan(opened.mgr, {
          session_id: opened.sessionId,
          steps: [{ step_id: 's1', operation: 'replace_text' }],
          plan_file_path: '/tmp/plan.json',
        });
      });

      await allureStep('Then INVALID_PARAMS error is returned', () => {
        assertFailure(result, 'INVALID_PARAMS');
      });
    },
  );

  humanReadableTest.openspec('unsupported operation is rejected during validation')(
    'Scenario: unsupported operation is rejected during validation',
    async () => {
      const result = await allureStep('Given a plan step with an unsupported operation type', async () => {
        const opened = await openSession(['Hello world']);
        return applyPlan(opened.mgr, {
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
      });

      await allureStep('Then normalization rejects the unsupported operation', () => {
        assertFailure(result, 'NORMALIZATION_ERROR');
        expect(String(result.error?.message ?? '')).toContain('unsupported operation');
      });
    },
  );

  humanReadableTest.openspec('legacy aliases rejected during validation')(
    'Scenario: legacy aliases rejected during validation',
    async () => {
      const result = await allureStep('Given a plan step using legacy smart_edit operation', async () => {
        const opened = await openSession(['Hello world']);
        return applyPlan(opened.mgr, {
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
      });

      await allureStep('Then normalization rejects the legacy operation', () => {
        assertFailure(result, 'NORMALIZATION_ERROR');
        expect(String(result.error?.message ?? '')).toContain('legacy operation');
      });
    },
  );

  humanReadableTest.openspec('style_source_id clones formatting from specified paragraph')(
    'Scenario: style_source_id clones formatting from specified paragraph',
    async () => {
      const result = await allureStep('Given a document with Heading1 and Normal paragraphs, inserting after heading with body style_source_id', async () => {
        const xml =
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
          `<w:body>` +
          `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Heading</w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>Body paragraph</w:t></w:r></w:p>` +
          `</w:body></w:document>`;

        const opened = await openSession([], { xml });
        return insertParagraph(opened.mgr, {
          session_id: opened.sessionId,
          positional_anchor_node_id: opened.paraIds[0],
          position: 'AFTER',
          new_string: 'Inserted with body style source',
          instruction: 'insert after heading',
          style_source_id: opened.paraIds[1],
        });
      });

      await allureStep('Then the insert succeeds without style warnings', () => {
        assertSuccess(result);
        expect(result.style_source_warning).toBeUndefined();
      });
    },
  );

  humanReadableTest.openspec('style_source_id falls back to anchor with warning')(
    'Scenario: style_source_id falls back to anchor with warning',
    async () => {
      const result = await allureStep('Given an insert with a non-existent style_source_id', async () => {
        const opened = await openSession(['Hello world']);
        return insertParagraph(opened.mgr, {
          session_id: opened.sessionId,
          positional_anchor_node_id: opened.firstParaId,
          position: 'AFTER',
          new_string: 'Inserted with fallback',
          instruction: 'insert with missing style source',
          style_source_id: '_bk_missing_style_source',
        });
      });

      await allureStep('Then the insert succeeds with a fallback warning', () => {
        assertSuccess(result);
        expect(String(result.style_source_warning ?? '')).toContain('not found');
        expect(String(result.style_source_warning ?? '')).toContain('fell back');
      });
    },
  );

  humanReadableTest.openspec('style_source_id omitted uses anchor formatting (backward compatible)')(
    'Scenario: style_source_id omitted uses anchor formatting (backward compatible)',
    async () => {
      const result = await allureStep('Given an insert without style_source_id', async () => {
        const opened = await openSession(['Hello world']);
        return insertParagraph(opened.mgr, {
          session_id: opened.sessionId,
          positional_anchor_node_id: opened.firstParaId,
          position: 'AFTER',
          new_string: 'Inserted without style source',
          instruction: 'insert with anchor style',
        });
      });

      await allureStep('Then the insert succeeds using anchor formatting with no warning', () => {
        assertSuccess(result);
        expect(result.style_source_warning).toBeUndefined();
      });
    },
  );

  humanReadableTest.openspec('canonical names are advertised')(
    'Scenario: canonical names are advertised',
    async () => {
      const toolNames = await allureStep('Given the MCP_TOOLS list', () => {
        return new Set<string>(MCP_TOOLS.map((tool) => tool.name));
      });

      await allureStep('Then canonical tool names replace_text and insert_paragraph are present', () => {
        expect(toolNames.has('replace_text')).toBe(true);
        expect(toolNames.has('insert_paragraph')).toBe(true);
      });
    },
  );

  humanReadableTest.openspec('legacy aliases are unavailable')(
    'Scenario: legacy aliases are unavailable',
    async () => {
      const toolNames = await allureStep('Given the MCP_TOOLS list', () => {
        return new Set<string>(MCP_TOOLS.map((tool) => tool.name));
      });

      await allureStep('Then legacy aliases smart_edit and smart_insert are absent', () => {
        expect(toolNames.has('smart_edit')).toBe(false);
        expect(toolNames.has('smart_insert')).toBe(false);
      });
    },
  );

  humanReadableTest.openspec('legacy aliases are rejected inside plan operations')(
    'Scenario: legacy aliases are rejected inside plan operations',
    async () => {
      const result = await allureStep('Given a merge plan containing a legacy smart_edit operation', async () => {
        return mergePlans({
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
      });

      await allureStep('Then merge fails with INVALID_STEP_OPERATION conflict', () => {
        assertFailure(result);
        const conflicts = (result as { conflicts?: Array<{ code: string }> }).conflicts ?? [];
        expect(conflicts.some((conflict) => conflict.code === 'INVALID_STEP_OPERATION')).toBe(true);
      });
    },
  );

  humanReadableTest.openspec('legacy aliases are rejected inside apply_plan steps')(
    'Scenario: legacy aliases are rejected inside apply_plan steps',
    async () => {
      const result = await allureStep('Given a plan step using legacy smart_insert operation', async () => {
        const opened = await openSession(['Hello world']);
        return applyPlan(opened.mgr, {
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
      });

      await allureStep('Then normalization rejects the legacy operation', () => {
        assertFailure(result, 'NORMALIZATION_ERROR');
        expect(String(result.error?.message ?? '')).toContain('legacy operation');
      });
    },
  );
});
