import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { batchEdit } from './batch_edit.js';
import { readFile } from './read_file.js';
import {
  openSession,
  assertSuccess,
  assertFailure,
  registerCleanup,
  createTrackedTempDir,
} from '../testing/session-test-utils.js';

// Edge-case / branch coverage for batch_edit. The 12 spec-scenario behaviours live in
// `replace_plan_tools_with_batch_edit.test.ts`; this file exercises the normalization,
// validation, and plan_file_path error branches relocated from the former apply_plan tool.
describe('batch_edit tool — edge cases', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: 'batch_edit tool' });
  registerCleanup();

  test('rejects steps with __proto__ key', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof batchEdit>>;

    await given('a session open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('batch_edit is called with a step carrying an own __proto__ property', async () => {
      const rawSteps = JSON.parse(JSON.stringify([{ step_id: 's1', operation: 'replace_text' }]));
      Object.defineProperty(rawSteps[0], '__proto__', {
        value: { polluted: true },
        enumerable: true,
        configurable: true,
        writable: true,
      });
      result = await batchEdit(opened.mgr, { file_path: opened.inputPath, steps: rawSteps });
    });

    await then('the call fails without polluting the prototype', () => {
      expect(result.success).toBe(false);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });

  test('missing operation field is rejected at normalization', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof batchEdit>>;

    await given('a session open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('batch_edit is called with a step that has no operation', async () => {
      result = await batchEdit(opened.mgr, {
        file_path: opened.inputPath,
        steps: [{ step_id: 's1', target_paragraph_id: opened.firstParaId }],
      });
    });

    await then('the batch fails with NORMALIZATION_ERROR', () => {
      assertFailure(result, 'NORMALIZATION_ERROR');
    });
  });

  test('validation failure reports all step errors and applies nothing', async ({ given, when, then, and }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof batchEdit>>;

    await given('a session with "Hello world" open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('batch_edit is called with two steps referencing non-existent anchors', async () => {
      result = await batchEdit(opened.mgr, {
        file_path: opened.inputPath,
        steps: [
          { step_id: 's1', operation: 'replace_text', target_paragraph_id: '_bk_nope', old_string: 'Hello', new_string: 'Hi', instruction: 't' },
          { step_id: 's2', operation: 'insert_paragraph', positional_anchor_node_id: '_bk_missing', new_string: 'New', instruction: 't' },
        ],
      });
    });

    await then('the batch fails with VALIDATION_FAILED for both steps', () => {
      assertFailure(result, 'VALIDATION_FAILED');
      const steps = (result as Record<string, unknown>).steps as Array<{ valid: boolean; errors: string[] }>;
      expect(steps).toHaveLength(2);
      expect(steps.every((s) => !s.valid && s.errors.length > 0)).toBe(true);
    });
    await and('the document is unchanged', async () => {
      const read = await readFile(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(read);
      expect(String(read.content)).toContain('Hello world');
    });
  });

  test('validates missing required fields for replace_text', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof batchEdit>>;

    await given('a session open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('batch_edit is called with a replace_text step missing old_string/new_string', async () => {
      result = await batchEdit(opened.mgr, {
        file_path: opened.inputPath,
        steps: [{ step_id: 's1', operation: 'replace_text', target_paragraph_id: opened.firstParaId }],
      });
    });

    await then('the batch fails with VALIDATION_FAILED', () => {
      assertFailure(result, 'VALIDATION_FAILED');
    });
  });

  test('validates missing required fields for insert_paragraph', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof batchEdit>>;

    await given('a session open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('batch_edit is called with an insert_paragraph step missing all required fields', async () => {
      result = await batchEdit(opened.mgr, {
        file_path: opened.inputPath,
        steps: [{ step_id: 's1', operation: 'insert_paragraph' }],
      });
    });

    await then('the batch fails with VALIDATION_FAILED', () => {
      assertFailure(result, 'VALIDATION_FAILED');
    });
  });

  test('applies an insert_paragraph step', async ({ given, when, then, and }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof batchEdit>>;

    await given('a session with one paragraph open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('batch_edit inserts a paragraph after the anchor', async () => {
      result = await batchEdit(opened.mgr, {
        file_path: opened.inputPath,
        steps: [
          {
            step_id: 's1',
            operation: 'insert_paragraph',
            positional_anchor_node_id: opened.firstParaId,
            position: 'AFTER',
            new_string: 'Inserted paragraph',
            instruction: 'insert',
          },
        ],
      });
    });

    await then('the batch succeeds', () => {
      assertSuccess(result);
      expect(result.completed_count).toBe(1);
    });
    await and('the inserted text appears in the document', async () => {
      const read = await readFile(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(read);
      expect(String(read.content)).toContain('Inserted paragraph');
    });
  });

  test('replaces a cached field result split across runs', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof batchEdit>>;

    await given('a session containing a two-run PAGEREF cached result', async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body><w:p>` +
        `<w:r><w:t>Section One</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText xml:space="preserve"> PAGEREF _Toc1 \\h </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>1</w:t></w:r><w:r><w:t>2</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p></w:body></w:document>`;
      opened = await openSession([], { xml });
    });

    await when('batch_edit changes the cached page number', async () => {
      result = await batchEdit(opened.mgr, {
        file_path: opened.inputPath,
        steps: [{
          step_id: 'field-result',
          operation: 'replace_text',
          target_paragraph_id: opened.firstParaId,
          old_string: '12',
          new_string: '13',
          instruction: 'update cached page number',
        }],
      });
    });

    await then('the batch succeeds and preserves the complex-field markers', async () => {
      assertSuccess(result);
      const session = (await opened.mgr.getSessionByFilePath(opened.inputPath))!;
      expect(session.doc.getParagraphTextById(opened.firstParaId)).toBe('Section One13');
      const paragraph = session.doc.getParagraphElementById(opened.firstParaId)!;
      expect(
        paragraph.getElementsByTagNameNS(
          'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
          'fldChar',
        ),
      ).toHaveLength(3);
    });
  });

  test('rejects neither steps nor plan_file_path', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof batchEdit>>;

    await given('a session open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('batch_edit is called with neither steps nor plan_file_path', async () => {
      result = await batchEdit(opened.mgr, { file_path: opened.inputPath });
    });

    await then('the batch fails with INVALID_PARAMS', () => {
      assertFailure(result, 'INVALID_PARAMS');
    });
  });

  test('rejects empty steps array', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof batchEdit>>;

    await given('a session open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('batch_edit is called with an empty steps array', async () => {
      result = await batchEdit(opened.mgr, { file_path: opened.inputPath, steps: [] });
    });

    await then('the batch fails with EMPTY_BATCH', () => {
      assertFailure(result, 'EMPTY_BATCH');
    });
  });

  test('rejects plan_file_path without a .json extension', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof batchEdit>>;

    await given('a session open', async () => {
      opened = await openSession(['Hello world']);
    });

    await when('batch_edit is called with a .txt plan_file_path', async () => {
      result = await batchEdit(opened.mgr, { file_path: opened.inputPath, plan_file_path: '/tmp/plan.txt' });
    });

    await then('the batch fails with INVALID_PLAN_FILE', () => {
      assertFailure(result, 'INVALID_PLAN_FILE');
    });
  });

  test('rejects an oversized plan file', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let planPath: string;
    let result: Awaited<ReturnType<typeof batchEdit>>;

    await given('a session open and a plan file larger than 1MB on disk', async () => {
      opened = await openSession(['Hello world']);
      const tmpDir = await createTrackedTempDir();
      planPath = path.join(tmpDir, 'big.json');
      const bigContent = '[' + Array.from({ length: 600_000 }, () => '"x"').join(',') + ']';
      await fs.writeFile(planPath, bigContent);
    });

    await when('batch_edit is called with that oversized plan_file_path', async () => {
      result = await batchEdit(opened.mgr, { file_path: opened.inputPath, plan_file_path: planPath });
    });

    await then('the batch fails with PLAN_FILE_TOO_LARGE', () => {
      assertFailure(result, 'PLAN_FILE_TOO_LARGE');
    });
  });
});
