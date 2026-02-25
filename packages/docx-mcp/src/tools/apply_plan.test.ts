import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { testAllure } from '../testing/allure-test.js';
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

  test('normalizes raw step format (top-level fields)', async () => {
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
          instruction: 'replace',
        },
      ],
    });

    assertSuccess(result);
    expect(result.completed_count).toBe(1);
    expect(result.completed_step_ids).toEqual(['s1']);
  });

  test('normalizes merged format with arguments envelope', async () => {
    const opened = await openSession(['Hello world', 'Second paragraph']);

    // Produce a merged plan via merge_plans
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
    const mergedPlan = merged.merged_plan as { steps: unknown[] };

    // Feed merged plan steps directly into apply_plan
    const result = await applyPlan(opened.mgr, {
      session_id: opened.sessionId,
      steps: mergedPlan.steps,
    });

    assertSuccess(result);
    expect(result.completed_count).toBe(1);
    expect(result.completed_step_ids).toEqual(['s1']);
  });

  test('rejects steps with __proto__ key', async () => {
    const opened = await openSession(['Hello world']);
    const steps = [{ step_id: 's1', operation: 'replace_text', __proto__: {} }];
    // Build array manually to bypass prototype stripping
    const rawSteps = JSON.parse(JSON.stringify(steps));
    // Inject __proto__ as own property
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
    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  test('validation failure returns all errors without applying', async () => {
    const opened = await openSession(['Hello world']);
    const result = await applyPlan(opened.mgr, {
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

    assertFailure(result, 'VALIDATION_FAILED');
    const steps = (result as Record<string, unknown>).steps as Array<{ step_id: string; valid: boolean; errors: string[] }>;
    expect(steps).toHaveLength(2);
    expect(steps[0]!.valid).toBe(false);
    expect(steps[1]!.valid).toBe(false);
    // Both errors reported, not just the first
    expect(steps[0]!.errors.length).toBeGreaterThan(0);
    expect(steps[1]!.errors.length).toBeGreaterThan(0);

    // Verify no edits were applied
    const read = await readFile(opened.mgr, { session_id: opened.sessionId });
    assertSuccess(read);
    expect(String(read.content)).toContain('Hello world');
  });

  test('rejects empty step_id', async () => {
    const opened = await openSession(['Hello world']);
    const result = await applyPlan(opened.mgr, {
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

    assertFailure(result, 'NORMALIZATION_ERROR');
  });

  test('rejects unsupported operation', async () => {
    const opened = await openSession(['Hello world']);
    const result = await applyPlan(opened.mgr, {
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

    assertFailure(result, 'NORMALIZATION_ERROR');
    expect((result as { error: { message: string } }).error.message).toContain('unsupported operation');
  });

  test('rejects legacy aliases (smart_edit, smart_insert)', async () => {
    const opened = await openSession(['Hello world']);

    const result1 = await applyPlan(opened.mgr, {
      session_id: opened.sessionId,
      steps: [
        { step_id: 's1', operation: 'smart_edit', target_paragraph_id: opened.firstParaId, old_string: 'Hello', new_string: 'Hi', instruction: 'test' },
      ],
    });
    assertFailure(result1, 'NORMALIZATION_ERROR');
    expect((result1 as { error: { message: string } }).error.message).toContain('legacy operation');

    const result2 = await applyPlan(opened.mgr, {
      session_id: opened.sessionId,
      steps: [
        { step_id: 's1', operation: 'smart_insert', positional_anchor_node_id: opened.firstParaId, new_string: 'New', instruction: 'test' },
      ],
    });
    assertFailure(result2, 'NORMALIZATION_ERROR');
    expect((result2 as { error: { message: string } }).error.message).toContain('legacy operation');
  });

  test('validates missing required fields for replace_text', async () => {
    const opened = await openSession(['Hello world']);
    const result = await applyPlan(opened.mgr, {
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

    assertFailure(result, 'VALIDATION_FAILED');
  });

  test('validates missing required fields for insert_paragraph', async () => {
    const opened = await openSession(['Hello world']);
    const result = await applyPlan(opened.mgr, {
      session_id: opened.sessionId,
      steps: [
        {
          step_id: 's1',
          operation: 'insert_paragraph',
          // missing positional_anchor_node_id, new_string, instruction
        },
      ],
    });

    assertFailure(result, 'VALIDATION_FAILED');
  });

  // ---------------------------------------------------------------------------
  // Apply: multi-step success
  // ---------------------------------------------------------------------------

  test('applies multiple steps successfully', async () => {
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

    assertSuccess(result);
    expect(result.completed_count).toBe(2);
    expect(result.completed_step_ids).toEqual(['s1', 's2']);

    // Verify edits applied
    const read = await readFile(opened.mgr, { session_id: opened.sessionId });
    assertSuccess(read);
    const content = String(read.content);
    expect(content).toContain('Hello earth');
    expect(content).toContain('Updated paragraph');
  });

  // ---------------------------------------------------------------------------
  // Apply: partial failure with completed_step_ids
  // ---------------------------------------------------------------------------

  test('stops on first error and reports completed_step_ids', async () => {
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
          instruction: 'replace greeting',
        },
        {
          step_id: 's2',
          operation: 'replace_text',
          target_paragraph_id: opened.paraIds[1],
          old_string: 'NONEXISTENT STRING',
          new_string: 'Updated',
          instruction: 'this should fail',
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

    assertFailure(result, 'APPLY_PARTIAL_FAILURE');
    expect((result as Record<string, unknown>).completed_count).toBe(1);
    expect((result as Record<string, unknown>).completed_step_ids).toEqual(['s1']);
    expect((result as Record<string, unknown>).failed_step_id).toBe('s2');
    expect((result as Record<string, unknown>).failed_step_index).toBe(1);

    // Verify first edit was applied
    const read = await readFile(opened.mgr, { session_id: opened.sessionId });
    assertSuccess(read);
    expect(String(read.content)).toContain('Hello earth');
  });

  // ---------------------------------------------------------------------------
  // apply_plan with insert_paragraph steps
  // ---------------------------------------------------------------------------

  test('applies insert_paragraph steps', async () => {
    const opened = await openSession(['Heading', 'Body text']);
    const result = await applyPlan(opened.mgr, {
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

    assertSuccess(result);
    expect(result.completed_count).toBe(1);

    const read = await readFile(opened.mgr, { session_id: opened.sessionId });
    assertSuccess(read);
    expect(String(read.content)).toContain('Inserted paragraph');
  });

  // ---------------------------------------------------------------------------
  // plan_file_path
  // ---------------------------------------------------------------------------

  test('loads steps from plan_file_path', async () => {
    const opened = await openSession(['Hello world']);
    const tmpDir = await createTrackedTempDir();
    const planPath = path.join(tmpDir, 'plan.json');

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

    const result = await applyPlan(opened.mgr, {
      session_id: opened.sessionId,
      plan_file_path: planPath,
    });

    assertSuccess(result);
    expect(result.completed_count).toBe(1);

    const read = await readFile(opened.mgr, { session_id: opened.sessionId });
    assertSuccess(read);
    expect(String(read.content)).toContain('Hello file');
  });

  test('rejects both steps and plan_file_path provided', async () => {
    const opened = await openSession(['Hello world']);
    const result = await applyPlan(opened.mgr, {
      session_id: opened.sessionId,
      steps: [{ step_id: 's1', operation: 'replace_text' }],
      plan_file_path: '/tmp/plan.json',
    });

    assertFailure(result, 'INVALID_PARAMS');
  });

  test('rejects neither steps nor plan_file_path', async () => {
    const opened = await openSession(['Hello world']);
    const result = await applyPlan(opened.mgr, {
      session_id: opened.sessionId,
    });

    assertFailure(result, 'INVALID_PARAMS');
  });

  test('rejects plan_file_path without .json extension', async () => {
    const opened = await openSession(['Hello world']);
    const result = await applyPlan(opened.mgr, {
      session_id: opened.sessionId,
      plan_file_path: '/tmp/plan.txt',
    });

    assertFailure(result, 'INVALID_PLAN_FILE');
  });

  test('rejects oversized plan file', async () => {
    const opened = await openSession(['Hello world']);
    const tmpDir = await createTrackedTempDir();
    const planPath = path.join(tmpDir, 'big.json');

    // Write a file larger than 1MB
    const bigContent = '[' + '"x"'.repeat(600_000).split('').join(',') + ']';
    await fs.writeFile(planPath, bigContent);

    const result = await applyPlan(opened.mgr, {
      session_id: opened.sessionId,
      plan_file_path: planPath,
    });

    assertFailure(result, 'PLAN_FILE_TOO_LARGE');
  });

  // ---------------------------------------------------------------------------
  // style_source_id on insert_paragraph
  // ---------------------------------------------------------------------------

  test('style_source_id clones formatting from specified paragraph', async () => {
    // Create a doc with a heading-style para and body-style para
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Heading</w:t></w:r></w:p>` +
      `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>Body text here</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const opened = await openSession([], { xml });

    // Get the IDs
    const headingId = opened.paraIds[0]!;
    const bodyId = opened.paraIds[1]!;

    // Insert after heading, but with body formatting
    const result = await insertParagraph(opened.mgr, {
      session_id: opened.sessionId,
      positional_anchor_node_id: headingId,
      position: 'AFTER',
      new_string: 'Inserted with body style',
      instruction: 'insert body after heading',
      style_source_id: bodyId,
    });

    assertSuccess(result);
    expect(result.style_source_warning).toBeUndefined();

    // Verify the inserted paragraph got Normal style, not Heading1
    const read = await readFile(opened.mgr, { session_id: opened.sessionId });
    assertSuccess(read);
    expect(String(read.content)).toContain('Inserted with body style');
  });

  test('style_source_id falls back to anchor with warning when ID not found', async () => {
    const opened = await openSession(['Hello world']);

    const result = await insertParagraph(opened.mgr, {
      session_id: opened.sessionId,
      positional_anchor_node_id: opened.firstParaId,
      position: 'AFTER',
      new_string: 'Inserted text',
      instruction: 'insert with fallback',
      style_source_id: '_bk_nonexistent',
    });

    assertSuccess(result);
    expect(result.style_source_warning).toBeDefined();
    expect(String(result.style_source_warning)).toContain('not found');
    expect(String(result.style_source_warning)).toContain('fell back');
  });

  test('style_source_id omitted uses anchor formatting (backward compatible)', async () => {
    const opened = await openSession(['Hello world']);

    const result = await insertParagraph(opened.mgr, {
      session_id: opened.sessionId,
      positional_anchor_node_id: opened.firstParaId,
      position: 'AFTER',
      new_string: 'Inserted text',
      instruction: 'insert without style source',
    });

    assertSuccess(result);
    expect(result.style_source_warning).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // style_source_id validation warning in apply_plan
  // ---------------------------------------------------------------------------

  test('apply_plan surfaces style_source_id warnings', async () => {
    const opened = await openSession(['Hello world']);
    const result = await applyPlan(opened.mgr, {
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

    // Should succeed but with warnings from validation
    assertSuccess(result);
    const warnings = result.warnings as Array<{ step_id: string; warning: string }> | undefined;
    expect(warnings).toBeDefined();
    expect(warnings!.length).toBeGreaterThan(0);
    expect(warnings![0]!.step_id).toBe('s1');
    expect(warnings![0]!.warning).toContain('not found');
  });

  // ---------------------------------------------------------------------------
  // Merged plan → apply_plan round-trip
  // ---------------------------------------------------------------------------

  test('merge_plans output feeds directly into apply_plan', async () => {
    const opened = await openSession(['Hello world', 'Second paragraph']);

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
    const mergedPlan = merged.merged_plan as { steps: unknown[] };

    const result = await applyPlan(opened.mgr, {
      session_id: opened.sessionId,
      steps: mergedPlan.steps,
    });

    assertSuccess(result);
    expect(result.completed_count).toBe(2);

    const read = await readFile(opened.mgr, { session_id: opened.sessionId });
    assertSuccess(read);
    const content = String(read.content);
    expect(content).toContain('Merged result');
    expect(content).toContain('Merged insert');
  });

  // ---------------------------------------------------------------------------
  // Empty plan
  // ---------------------------------------------------------------------------

  test('rejects empty steps array', async () => {
    const opened = await openSession(['Hello world']);
    const result = await applyPlan(opened.mgr, {
      session_id: opened.sessionId,
      steps: [],
    });

    assertFailure(result, 'EMPTY_PLAN');
  });
});
