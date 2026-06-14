import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';

import { MCP_TOOLS } from './server.js';
import { batchEdit } from './tools/batch_edit.js';
import { readFile } from './tools/read_file.js';
import { save } from './tools/save.js';
import { testAllure } from './testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  createTrackedTempDir,
  openSession,
  parseOutputXml,
  registerCleanup,
} from './testing/session-test-utils.js';

const TEST_FEATURE = 'replace-plan-tools-with-batch-edit';

describe('Traceability: replace plan tools with batch_edit', () => {
  registerCleanup();
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
  const humanReadableTest = test.allure({
    tags: ['human-readable'],
    parameters: { audience: 'non-technical' },
  });

  humanReadableTest.openspec('batch_edit applies all valid steps in order')('Scenario: batch_edit applies all valid steps in order', async () => {
    const opened = await openSession(['Hello world', 'Anchor paragraph']);
    const result = await batchEdit(opened.mgr, {
      file_path: opened.inputPath,
      steps: [
        {
          step_id: 's1',
          operation: 'replace_text',
          target_paragraph_id: opened.paraIds[0],
          old_string: 'Hello world',
          new_string: 'Hello batch',
          instruction: 'replace first paragraph',
        },
        {
          step_id: 's2',
          operation: 'insert_paragraph',
          positional_anchor_node_id: opened.paraIds[1],
          new_string: 'Inserted paragraph',
          instruction: 'insert after anchor',
          position: 'AFTER',
        },
      ],
    });

    assertSuccess(result);
    expect(result.completed_count).toBe(2);
    expect(result.completed_step_ids).toEqual(['s1', 's2']);

    const read = await readFile(opened.mgr, { file_path: opened.inputPath });
    assertSuccess(read);
    expect(String(read.content)).toContain('Hello batch');
    expect(String(read.content)).toContain('Inserted paragraph');
  });

  humanReadableTest.openspec('batch_edit validation failure applies zero steps')('Scenario: batch_edit validation failure applies zero steps', async () => {
    const opened = await openSession(['Hello world', 'Anchor paragraph']);
    const result = await batchEdit(opened.mgr, {
      file_path: opened.inputPath,
      steps: [
        {
          step_id: 's1',
          operation: 'replace_text',
          target_paragraph_id: opened.paraIds[0],
          old_string: 'Hello world',
          new_string: 'Hello batch',
          instruction: 'valid but must not apply',
        },
        {
          step_id: 's2',
          operation: 'insert_paragraph',
          positional_anchor_node_id: '_bk_missing',
          new_string: 'Inserted paragraph',
          instruction: 'invalid anchor',
        },
      ],
    });

    assertFailure(result, 'VALIDATION_FAILED');
    const read = await readFile(opened.mgr, { file_path: opened.inputPath });
    assertSuccess(read);
    expect(String(read.content)).toContain('Hello world');
    expect(String(read.content)).not.toContain('Hello batch');
    expect(String(read.content)).not.toContain('Inserted paragraph');
  });

  humanReadableTest.openspec('batch_edit conflict pre-flight rejects overlapping replace ranges')('Scenario: batch_edit conflict pre-flight rejects overlapping replace ranges', async () => {
    const opened = await openSession(['abcdef']);
    const result = await batchEdit(opened.mgr, {
      file_path: opened.inputPath,
      steps: [
        {
          step_id: 's1',
          operation: 'replace_text',
          target_paragraph_id: opened.firstParaId,
          old_string: 'abc',
          new_string: 'ABC',
          instruction: 'first overlapping replace',
        },
        {
          step_id: 's2',
          operation: 'replace_text',
          target_paragraph_id: opened.firstParaId,
          old_string: 'bcd',
          new_string: 'BCD',
          instruction: 'second overlapping replace',
        },
      ],
    });

    assertFailure(result, 'BATCH_CONFLICT');
    const conflicts = (result as { conflicts?: Array<{ code: string }> }).conflicts ?? [];
    expect(conflicts.some((conflict) => conflict.code === 'OVERLAPPING_REPLACE_RANGE')).toBe(true);
    const read = await readFile(opened.mgr, { file_path: opened.inputPath });
    assertSuccess(read);
    expect(String(read.content)).toContain('abcdef');
  });

  humanReadableTest.openspec('batch_edit conflict pre-flight rejects duplicate step ids')('Scenario: batch_edit conflict pre-flight rejects duplicate step ids', async () => {
    const opened = await openSession(['Alpha', 'Beta']);
    const result = await batchEdit(opened.mgr, {
      file_path: opened.inputPath,
      steps: [
        {
          step_id: 'dup',
          operation: 'replace_text',
          target_paragraph_id: opened.paraIds[0],
          old_string: 'Alpha',
          new_string: 'One',
          instruction: 'first duplicate id',
        },
        {
          step_id: 'dup',
          operation: 'replace_text',
          target_paragraph_id: opened.paraIds[1],
          old_string: 'Beta',
          new_string: 'Two',
          instruction: 'second duplicate id',
        },
      ],
    });

    assertFailure(result, 'BATCH_CONFLICT');
    const conflicts = (result as { conflicts?: Array<{ code: string }> }).conflicts ?? [];
    expect(conflicts.some((conflict) => conflict.code === 'DUPLICATE_STEP_ID')).toBe(true);
  });

  humanReadableTest.openspec('batch_edit conflict pre-flight rejects insert-slot collision')('Scenario: batch_edit conflict pre-flight rejects insert-slot collision', async () => {
    const opened = await openSession(['Anchor']);
    const result = await batchEdit(opened.mgr, {
      file_path: opened.inputPath,
      steps: [
        {
          step_id: 's1',
          operation: 'insert_paragraph',
          positional_anchor_node_id: opened.firstParaId,
          new_string: 'First',
          instruction: 'first insert',
          position: 'AFTER',
        },
        {
          step_id: 's2',
          operation: 'insert_paragraph',
          positional_anchor_node_id: opened.firstParaId,
          new_string: 'Second',
          instruction: 'second insert',
          position: 'AFTER',
        },
      ],
    });

    assertFailure(result, 'BATCH_CONFLICT');
    const conflicts = (result as { conflicts?: Array<{ code: string }> }).conflicts ?? [];
    expect(conflicts.some((conflict) => conflict.code === 'INSERT_SLOT_COLLISION')).toBe(true);
    const read = await readFile(opened.mgr, { file_path: opened.inputPath });
    assertSuccess(read);
    expect(String(read.content)).not.toContain('First');
    expect(String(read.content)).not.toContain('Second');
  });

  humanReadableTest.openspec('batch_edit preserves run formatting on replace')('Scenario: batch_edit preserves run formatting on replace', async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Alpha</w:t></w:r>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Beta</w:t></w:r>` +
      `</w:p></w:body></w:document>`;
    const opened = await openSession([], { xml, prefix: 'safe-docx-batch-formatting-' });
    const result = await batchEdit(opened.mgr, {
      file_path: opened.inputPath,
      steps: [
        {
          step_id: 's1',
          operation: 'replace_text',
          target_paragraph_id: opened.firstParaId,
          old_string: 'AlphaBeta',
          new_string: 'Gamma',
          instruction: 'replace split bold runs',
        },
      ],
    });
    assertSuccess(result);

    const outPath = path.join(opened.tmpDir, 'out.docx');
    const saved = await save(opened.mgr, {
      file_path: opened.inputPath,
      save_to_local_path: outPath,
      clean_bookmarks: true,
      save_format: 'clean',
    });
    assertSuccess(saved);

    const { runs, runText, hasBold } = await parseOutputXml(outPath);
    const replacementRun = runs.find((run) => runText(run) === 'Gamma');
    expect(replacementRun).toBeTruthy();
    expect(hasBold(replacementRun!)).toBe(true);
  });

  humanReadableTest.openspec('batch_edit execution failure stops at first failing step')('Scenario: batch_edit execution failure stops at first failing step', async () => {
    const opened = await openSession(['Alpha Beta', 'Tail']);
    const result = await batchEdit(opened.mgr, {
      file_path: opened.inputPath,
      steps: [
        {
          step_id: 's1',
          operation: 'replace_text',
          target_paragraph_id: opened.firstParaId,
          old_string: 'Alpha',
          new_string: 'Beta Beta',
          instruction: 'introduce duplicate Beta matches',
        },
        {
          step_id: 's2',
          operation: 'replace_text',
          target_paragraph_id: opened.firstParaId,
          old_string: 'Beta',
          new_string: 'Gamma',
          instruction: 'fails after first edit makes match non-unique',
        },
        {
          step_id: 's3',
          operation: 'replace_text',
          target_paragraph_id: opened.paraIds[1],
          old_string: 'Tail',
          new_string: 'Should not run',
          instruction: 'must not execute',
        },
      ],
    });

    assertFailure(result, 'BATCH_PARTIAL_FAILURE');
    expect(result.completed_step_ids).toEqual(['s1']);
    expect(result.failed_step_id).toBe('s2');
    expect(result.failed_step_index).toBe(1);

    const read = await readFile(opened.mgr, { file_path: opened.inputPath });
    assertSuccess(read);
    expect(String(read.content)).toContain('Beta Beta Beta');
    expect(String(read.content)).not.toContain('Should not run');
  });

  humanReadableTest.openspec('batch_edit reads steps from plan_file_path json array')('Scenario: batch_edit reads steps from plan_file_path json array', async () => {
    const opened = await openSession(['Hello world']);
    const tmpDir = await createTrackedTempDir('batch-edit-plan-file-');
    const planPath = path.join(tmpDir, 'plan.json');
    await fs.writeFile(planPath, JSON.stringify([
      {
        step_id: 's1',
        operation: 'replace_text',
        target_paragraph_id: opened.firstParaId,
        old_string: 'Hello world',
        new_string: 'Hello from file',
        instruction: 'read steps from file',
      },
    ]), 'utf-8');

    const result = await batchEdit(opened.mgr, {
      file_path: opened.inputPath,
      plan_file_path: planPath,
    });

    assertSuccess(result);
    expect(result.completed_step_ids).toEqual(['s1']);
  });

  humanReadableTest.openspec('batch_edit rejects both steps and plan_file_path together')('Scenario: batch_edit rejects both steps and plan_file_path together', async () => {
    const opened = await openSession(['Hello world']);
    const result = await batchEdit(opened.mgr, {
      file_path: opened.inputPath,
      steps: [],
      plan_file_path: '/tmp/plan.json',
    });

    assertFailure(result, 'INVALID_PARAMS');
  });

  humanReadableTest.openspec('batch_edit rejects unsupported operations and legacy aliases')('Scenario: batch_edit rejects unsupported operations and legacy aliases', async () => {
    const opened = await openSession(['Hello world']);
    const result = await batchEdit(opened.mgr, {
      file_path: opened.inputPath,
      steps: [
        {
          step_id: 's1',
          operation: 'delete_paragraph',
          target_paragraph_id: opened.firstParaId,
          instruction: 'unsupported operation',
        },
        {
          step_id: 's2',
          operation: 'smart_insert',
          positional_anchor_node_id: opened.firstParaId,
          new_string: 'legacy insert',
          instruction: 'legacy alias',
        },
      ],
    });

    assertFailure(result, 'NORMALIZATION_ERROR');
    const message = String(result.error?.message ?? '');
    expect(message).toContain('delete_paragraph');
    expect(message).toContain('smart_insert');
    expect(message).toContain('replace_text');
    expect(message).toContain('insert_paragraph');
  });

  humanReadableTest.openspec('canonical names are advertised')('Scenario: canonical names are advertised', async () => {
    const toolNames = new Set<string>(MCP_TOOLS.map((tool) => tool.name));
    expect(toolNames.has('replace_text')).toBe(true);
    expect(toolNames.has('insert_paragraph')).toBe(true);
    expect(toolNames.has('batch_edit')).toBe(true);
  });

  humanReadableTest.openspec('legacy aliases are unavailable')('Scenario: legacy aliases are unavailable', async () => {
    const toolNames = new Set<string>(MCP_TOOLS.map((tool) => tool.name));
    expect(toolNames.has('smart_edit')).toBe(false);
    expect(toolNames.has('smart_insert')).toBe(false);
    expect(toolNames.has(`init_${'plan'}`)).toBe(false);
    expect(toolNames.has(`merge_${'plans'}`)).toBe(false);
    expect(toolNames.has(`apply_${'plan'}`)).toBe(false);
  });
});
