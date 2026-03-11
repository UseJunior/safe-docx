import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { applyPlan } from './apply_plan.js';
import { insertParagraph } from './insert_paragraph.js';
import { readFile } from './read_file.js';
import { mergePlans } from './merge_plans.js';
import {
  openSession,
  assertSuccess,
  assertFailure,
  registerCleanup,
  createTrackedTempDir,
} from '../testing/session-test-utils.js';

describe('apply_plan tool', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: 'apply_plan tool' });
  registerCleanup();

  // ---------------------------------------------------------------------------
  // Step normalization
  // ---------------------------------------------------------------------------

  test('normalizes raw step format (top-level fields)', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with two paragraphs open', async () => {
      opened = await openSession(['Hello world', 'Second paragraph']);
    });

    await when('applyPlan is called with a raw-format replace_text step', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'replace_text',
            target_paragraph_id: opened.paraIds[0],
            old_string: 'Hello world',
            new_string: 'Hello earth',
            instruction: 'replace',
          },
        ],
      });
    });

    await then('the step is completed and completed_count is 1', () => {
      assertSuccess(result);
      expect(result.completed_count).toBe(1);
      expect(result.completed_step_ids).toEqual(['s1']);
    });
  });

  test('normalizes merged format with arguments envelope', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let mergedSteps: unknown[];
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session open and a merged plan produced by merge_plans', async () => {
      opened = await openSession(['Hello world', 'Second paragraph']);
      const merged = await mergePlans({
        plans: [
          {
            plan_id: 'plan-a',
            steps: [
              {
                step_id: 's1',
                operation: 'replace_text',
                target_paragraph_id: opened.paraIds[0],
                old_string: 'Hello world',
                new_string: 'Hello earth',
                instruction: 'test',
                range: { start: 0, end: 11 },
              },
            ],
          },
        ],
      });
      assertSuccess(merged);
      mergedSteps = (merged.merged_plan as { steps: unknown[] }).steps;
    });

    await when('applyPlan is called with the merged plan steps', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: mergedSteps,
      });
    });

    await then('the step is completed and completed_count is 1', () => {
      assertSuccess(result);
      expect(result.completed_count).toBe(1);
      expect(result.completed_step_ids).toEqual(['s1']);
    });
  });

  test('rejects steps with __proto__ key', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session open and a step object with __proto__ injected as an own property', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('applyPlan is called with the poisoned step', async () => {
      const steps = [{ step_id: 's1', operation: 'replace_text', __proto__: {} }];
      const rawSteps = JSON.parse(JSON.stringify(steps));
      Object.defineProperty(rawSteps[0], '__proto__', {
        value: { polluted: true },
        enumerable: true,
        configurable: true,
        writable: true,
      });
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: rawSteps,
      });
    });

    await then('the call fails to protect against prototype pollution', () => {
      expect(result.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  test('validation failure returns all errors without applying', async ({ given, when, then, and }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with "Hello world" open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('applyPlan is called with two steps both referencing non-existent paragraph IDs', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'replace_text',
            target_paragraph_id: '_bk_nonexistent',
            old_string: 'Hello',
            new_string: 'Hi',
            instruction: 'test',
          },
          {
            step_id: 's2',
            operation: 'insert_paragraph',
            positional_anchor_node_id: '_bk_also_missing',
            new_string: 'New text',
            instruction: 'test',
          },
        ],
      });
    });

    await then('the result fails with VALIDATION_FAILED and all step errors are reported', () => {
      assertFailure(result, 'VALIDATION_FAILED');
      const steps = (result as Record<string, unknown>).steps as Array<{ step_id: string; valid: boolean; errors: string[] }>;
      expect(steps).toHaveLength(2);
      expect(steps[0]!.valid).toBe(false);
      expect(steps[1]!.valid).toBe(false);
      expect(steps[0]!.errors.length).toBeGreaterThan(0);
      expect(steps[1]!.errors.length).toBeGreaterThan(0);
    });
    await and('no edits were applied to the document', async () => {
      const read = await readFile(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(read);
      expect(String(read.content)).toContain('Hello world');
    });
  });

  test('rejects empty step_id', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with a document open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('applyPlan is called with a step that has an empty step_id', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: '',
            operation: 'replace_text',
            target_paragraph_id: opened.firstParaId,
            old_string: 'Hello',
            new_string: 'Hi',
            instruction: 'test',
          },
        ],
      });
    });

    await then('the result fails with NORMALIZATION_ERROR', () => {
      assertFailure(result, 'NORMALIZATION_ERROR');
    });
  });

  test('rejects unsupported operation', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with a document open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('applyPlan is called with an unsupported "delete_paragraph" operation', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'delete_paragraph',
            target_paragraph_id: opened.firstParaId,
            instruction: 'test',
          },
        ],
      });
    });

    await then('the result fails with NORMALIZATION_ERROR mentioning unsupported operation', () => {
      assertFailure(result, 'NORMALIZATION_ERROR');
      expect((result as { error: { message: string } }).error.message).toContain('unsupported operation');
    });
  });

  test('rejects legacy aliases (smart_edit, smart_insert)', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result1: Awaited<ReturnType<typeof applyPlan>>;
    let result2: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with a document open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('applyPlan is called with smart_edit and separately with smart_insert', async () => {
      result1 = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          { step_id: 's1', operation: 'smart_edit', target_paragraph_id: opened.firstParaId, old_string: 'Hello', new_string: 'Hi', instruction: 'test' },
        ],
      });
      result2 = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          { step_id: 's1', operation: 'smart_insert', positional_anchor_node_id: opened.firstParaId, new_string: 'New', instruction: 'test' },
        ],
      });
    });

    await then('both calls fail with NORMALIZATION_ERROR mentioning legacy operation', () => {
      assertFailure(result1, 'NORMALIZATION_ERROR');
      expect((result1 as { error: { message: string } }).error.message).toContain('legacy operation');
      assertFailure(result2, 'NORMALIZATION_ERROR');
      expect((result2 as { error: { message: string } }).error.message).toContain('legacy operation');
    });
  });

  test('validates missing required fields for replace_text', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with a document open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('applyPlan is called with a replace_text step missing old_string, new_string, and instruction', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'replace_text',
            target_paragraph_id: opened.firstParaId,
            // missing old_string, new_string, instruction
          },
        ],
      });
    });

    await then('the result fails with VALIDATION_FAILED', () => {
      assertFailure(result, 'VALIDATION_FAILED');
    });
  });

  test('validates missing required fields for insert_paragraph', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with a document open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('applyPlan is called with an insert_paragraph step missing all required fields', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'insert_paragraph',
            // missing positional_anchor_node_id, new_string, instruction
          },
        ],
      });
    });

    await then('the result fails with VALIDATION_FAILED', () => {
      assertFailure(result, 'VALIDATION_FAILED');
    });
  });

  // ---------------------------------------------------------------------------
  // Apply: multi-step success
  // ---------------------------------------------------------------------------

  test('applies multiple steps successfully', async ({ given, when, then, and }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with two paragraphs open', async () => {
      opened = await openSession(['Hello world', 'Second paragraph']);
    });

    await when('applyPlan is called with two replace_text steps', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'replace_text',
            target_paragraph_id: opened.paraIds[0],
            old_string: 'Hello world',
            new_string: 'Hello earth',
            instruction: 'replace greeting',
          },
          {
            step_id: 's2',
            operation: 'replace_text',
            target_paragraph_id: opened.paraIds[1],
            old_string: 'Second paragraph',
            new_string: 'Updated paragraph',
            instruction: 'replace second',
          },
        ],
      });
    });

    await then('both steps are completed and completed_count is 2', () => {
      assertSuccess(result);
      expect(result.completed_count).toBe(2);
      expect(result.completed_step_ids).toEqual(['s1', 's2']);
    });
    await and('both replacements appear in the document', async () => {
      const read = await readFile(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(read);
      const content = String(read.content);
      expect(content).toContain('Hello earth');
      expect(content).toContain('Updated paragraph');
    });
  });

  // ---------------------------------------------------------------------------
  // Apply: partial failure with completed_step_ids
  // ---------------------------------------------------------------------------

  test('old_string mismatch is caught at validation, not execution', async ({ given, when, then, and }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with two paragraphs open', async () => {
      opened = await openSession(['Hello world', 'Second paragraph']);
    });

    await when('applyPlan is called where one step has a bad old_string', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'replace_text',
            target_paragraph_id: opened.paraIds[0],
            old_string: 'Hello world',
            new_string: 'Hello earth',
            instruction: 'replace greeting',
          },
          {
            step_id: 's2',
            operation: 'replace_text',
            target_paragraph_id: opened.paraIds[1],
            old_string: 'NONEXISTENT STRING',
            new_string: 'Updated',
            instruction: 'this should fail validation',
          },
          {
            step_id: 's3',
            operation: 'replace_text',
            target_paragraph_id: opened.paraIds[1],
            old_string: 'Second',
            new_string: 'Third',
            instruction: 'should not run',
          },
        ],
      });
    });

    await then('the result fails with VALIDATION_FAILED and only s2 is marked invalid', () => {
      assertFailure(result, 'VALIDATION_FAILED');
      const steps = (result as Record<string, unknown>).steps as Array<{ step_id: string; valid: boolean; errors: string[] }>;
      expect(steps).toHaveLength(3);
      expect(steps[0]!.valid).toBe(true);
      expect(steps[1]!.valid).toBe(false);
      expect(steps[1]!.errors[0]).toContain('old_string not found');
      expect(steps[2]!.valid).toBe(true);
    });
    await and('no edits were applied and the document is unchanged', async () => {
      const read = await readFile(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(read);
      expect(String(read.content)).toContain('Hello world');
      expect(String(read.content)).not.toContain('Hello earth');
    });
  });

  // ---------------------------------------------------------------------------
  // apply_plan with insert_paragraph steps
  // ---------------------------------------------------------------------------

  test('applies insert_paragraph steps', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with "Heading" and "Body text" paragraphs open', async () => {
      opened = await openSession(['Heading', 'Body text']);
    });

    await when('applyPlan is called with an insert_paragraph step AFTER the heading', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'insert_paragraph',
            positional_anchor_node_id: opened.paraIds[0],
            position: 'AFTER',
            new_string: 'Inserted paragraph',
            instruction: 'add paragraph',
          },
        ],
      });
    });

    await then('the step is completed and the inserted paragraph appears in the document', async () => {
      assertSuccess(result);
      expect(result.completed_count).toBe(1);
      const read = await readFile(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(read);
      expect(String(read.content)).toContain('Inserted paragraph');
    });
  });

  // ---------------------------------------------------------------------------
  // plan_file_path
  // ---------------------------------------------------------------------------

  test('loads steps from plan_file_path', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let planPath: string;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session open and a plan JSON file written to disk', async () => {
      opened = await openSession(['Hello world']);
      const tmpDir = await createTrackedTempDir();
      planPath = path.join(tmpDir, 'plan.json');
      const steps = [
        {
          step_id: 's1',
          operation: 'replace_text',
          target_paragraph_id: opened.firstParaId,
          old_string: 'Hello world',
          new_string: 'Hello file',
          instruction: 'from file',
        },
      ];
      await fs.writeFile(planPath, JSON.stringify(steps));
    });

    await when('applyPlan is called with plan_file_path pointing to the plan file', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        plan_file_path: planPath,
      });
    });

    await then('the step from the file is applied and the replacement appears in the document', async () => {
      assertSuccess(result);
      expect(result.completed_count).toBe(1);
      const read = await readFile(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(read);
      expect(String(read.content)).toContain('Hello file');
    });
  });

  test('rejects both steps and plan_file_path provided', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with a document open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('applyPlan is called with both steps and plan_file_path', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [{ step_id: 's1', operation: 'replace_text' }],
        plan_file_path: '/tmp/plan.json',
      });
    });

    await then('the result fails with INVALID_PARAMS', () => {
      assertFailure(result, 'INVALID_PARAMS');
    });
  });

  test('rejects neither steps nor plan_file_path', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with a document open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('applyPlan is called with neither steps nor plan_file_path', async () => {
      result = await applyPlan(opened.mgr, { session_id: opened.sessionId });
    });

    await then('the result fails with INVALID_PARAMS', () => {
      assertFailure(result, 'INVALID_PARAMS');
    });
  });

  test('rejects plan_file_path without .json extension', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with a document open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('applyPlan is called with a .txt plan_file_path', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        plan_file_path: '/tmp/plan.txt',
      });
    });

    await then('the result fails with INVALID_PLAN_FILE', () => {
      assertFailure(result, 'INVALID_PLAN_FILE');
    });
  });

  test('rejects oversized plan file', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let planPath: string;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session open and a plan file larger than 1MB on disk', async () => {
      opened = await openSession(['Hello world']);
      const tmpDir = await createTrackedTempDir();
      planPath = path.join(tmpDir, 'big.json');
      const bigContent = '[' + '"x"'.repeat(600_000).split('').join(',') + ']';
      await fs.writeFile(planPath, bigContent);
    });

    await when('applyPlan is called with that oversized plan_file_path', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        plan_file_path: planPath,
      });
    });

    await then('the result fails with PLAN_FILE_TOO_LARGE', () => {
      assertFailure(result, 'PLAN_FILE_TOO_LARGE');
    });
  });

  // ---------------------------------------------------------------------------
  // style_source_id on insert_paragraph
  // ---------------------------------------------------------------------------

  test('style_source_id clones formatting from specified paragraph', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof insertParagraph>>;

    await given('a document with a Heading1-styled paragraph and a Normal-styled paragraph open', async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>` +
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Heading</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>Body text here</w:t></w:r></w:p>` +
        `</w:body></w:document>`;
      opened = await openSession([], { xml });
    });

    await when('insertParagraph is called after the heading with style_source_id pointing to the body paragraph', async () => {
      const headingId = opened.paraIds[0]!;
      const bodyId = opened.paraIds[1]!;
      result = await insertParagraph(opened.mgr, {
        session_id: opened.sessionId,
        positional_anchor_node_id: headingId,
        position: 'AFTER',
        new_string: 'Inserted with body style',
        instruction: 'insert body after heading',
        style_source_id: bodyId,
      });
    });

    await then('the insert succeeds without a style_source_warning and the text appears', async () => {
      assertSuccess(result);
      expect(result.style_source_warning).toBeUndefined();
      const read = await readFile(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(read);
      expect(String(read.content)).toContain('Inserted with body style');
    });
  });

  test('style_source_id falls back to anchor with warning when ID not found', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof insertParagraph>>;

    await given('a session with a single paragraph open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('insertParagraph is called with a non-existent style_source_id', async () => {
      result = await insertParagraph(opened.mgr, {
        session_id: opened.sessionId,
        positional_anchor_node_id: opened.firstParaId,
        position: 'AFTER',
        new_string: 'Inserted text',
        instruction: 'insert with fallback',
        style_source_id: '_bk_nonexistent',
      });
    });

    await then('the insert succeeds with a style_source_warning noting not found and fallback', () => {
      assertSuccess(result);
      expect(result.style_source_warning).toBeDefined();
      expect(String(result.style_source_warning)).toContain('not found');
      expect(String(result.style_source_warning)).toContain('fell back');
    });
  });

  test('style_source_id omitted uses anchor formatting (backward compatible)', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof insertParagraph>>;

    await given('a session with a single paragraph open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('insertParagraph is called without style_source_id', async () => {
      result = await insertParagraph(opened.mgr, {
        session_id: opened.sessionId,
        positional_anchor_node_id: opened.firstParaId,
        position: 'AFTER',
        new_string: 'Inserted text',
        instruction: 'insert without style source',
      });
    });

    await then('the insert succeeds with no style_source_warning', () => {
      assertSuccess(result);
      expect(result.style_source_warning).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // style_source_id validation warning in apply_plan
  // ---------------------------------------------------------------------------

  test('apply_plan surfaces style_source_id warnings', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with a single paragraph open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('applyPlan is called with an insert_paragraph step using a non-existent style_source_id', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [
          {
            step_id: 's1',
            operation: 'insert_paragraph',
            positional_anchor_node_id: opened.firstParaId,
            position: 'AFTER',
            new_string: 'New para',
            instruction: 'insert',
            style_source_id: '_bk_missing_style',
          },
        ],
      });
    });

    await then('the call succeeds with a warning for step s1 about the missing style', () => {
      assertSuccess(result);
      const warnings = result.warnings as Array<{ step_id: string; warning: string }> | undefined;
      expect(warnings).toBeDefined();
      expect(warnings!.length).toBeGreaterThan(0);
      expect(warnings![0]!.step_id).toBe('s1');
      expect(warnings![0]!.warning).toContain('not found');
    });
  });

  // ---------------------------------------------------------------------------
  // Merged plan → apply_plan round-trip
  // ---------------------------------------------------------------------------

  test('merge_plans output feeds directly into apply_plan', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let mergedSteps: unknown[];
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session open and two plans merged via merge_plans', async () => {
      opened = await openSession(['Hello world', 'Second paragraph']);
      const merged = await mergePlans({
        plans: [
          {
            plan_id: 'plan-a',
            steps: [
              {
                step_id: 's1',
                operation: 'replace_text',
                target_paragraph_id: opened.paraIds[0],
                old_string: 'Hello world',
                new_string: 'Merged result',
                instruction: 'merged edit',
                range: { start: 0, end: 11 },
              },
            ],
          },
          {
            plan_id: 'plan-b',
            steps: [
              {
                step_id: 's2',
                operation: 'insert_paragraph',
                positional_anchor_node_id: opened.paraIds[1],
                position: 'AFTER',
                new_string: 'Merged insert',
                instruction: 'merged insert',
              },
            ],
          },
        ],
      });
      assertSuccess(merged);
      mergedSteps = (merged.merged_plan as { steps: unknown[] }).steps;
    });

    await when('applyPlan is called with the merged plan steps', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: mergedSteps,
      });
    });

    await then('both steps complete and both results appear in the document', async () => {
      assertSuccess(result);
      expect(result.completed_count).toBe(2);
      const read = await readFile(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(read);
      const content = String(read.content);
      expect(content).toContain('Merged result');
      expect(content).toContain('Merged insert');
    });
  });

  // ---------------------------------------------------------------------------
  // Empty plan
  // ---------------------------------------------------------------------------

  test('rejects empty steps array', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof applyPlan>>;

    await given('a session with a document open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('applyPlan is called with an empty steps array', async () => {
      result = await applyPlan(opened.mgr, {
        session_id: opened.sessionId,
        steps: [],
      });
    });

    await then('the result fails with EMPTY_PLAN', () => {
      assertFailure(result, 'EMPTY_PLAN');
    });
  });
});
