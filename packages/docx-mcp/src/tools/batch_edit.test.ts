import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { batchEdit } from './batch_edit.js';
import { readFile } from './read_file.js';
import { replaceText } from './replace_text.js';
import { SessionManager } from '../session/manager.js';
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

  test('returns an actionable hyperlink-boundary error without applying the batch', async ({ given, when, then, and }: AllureBddContext) => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.22' });
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof batchEdit>>;

    await given('a paragraph with literal text followed by an anchored hyperlink', async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body><w:p>` +
        `<w:r><w:t xml:space="preserve">See Section </w:t></w:r>` +
        `<w:hyperlink w:anchor="_Ref1"><w:r><w:t>4.2(b)(ix)</w:t></w:r></w:hyperlink>` +
        `<w:r><w:t xml:space="preserve"> for details.</w:t></w:r>` +
        `</w:p></w:body></w:document>`;
      opened = await openSession([], { xml });
    });

    await when('a batch replacement genuinely crosses the hyperlink boundary', async () => {
      result = await batchEdit(opened.mgr, {
        file_path: opened.inputPath,
        steps: [{
          step_id: 'cross-hyperlink',
          operation: 'replace_text',
          target_paragraph_id: opened.firstParaId,
          old_string: 'Section 4.2(b)(ix)',
          new_string: 'Clause 5.3(c)(xii)!',
          instruction: 'cross hyperlink boundary',
        }],
      });
    });

    await then('batch_edit preserves the structured boundary code and exact localization', () => {
      assertFailure(result, 'UNSAFE_CONTAINER_BOUNDARY');
      expect(result.error.message).toContain('range [4, 22)');
      expect(result.error.message).toContain('at offset 12');
      expect(result.error.message).toContain('(w:p → w:hyperlink)');
      expect(result.error.message).toContain('[12, 22) in w:hyperlink, "4.2(b)(ix)"');
      expect(result.error.hint).toContain('each side of offset 12');
    });

    await and('the original session remains unchanged', async () => {
      const session = await opened.mgr.getSessionByFilePath(opened.inputPath);
      expect(session?.doc.getParagraphTextById(opened.firstParaId))
        .toBe('See Section 4.2(b)(ix) for details.');
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

  // A step whose planner refuses only on the document the earlier steps leave
  // behind passes validation, so the refusal comes from the dry run. The whole
  // batch is refused there, before any step touches the session (#1525).
  async function bodyTexts(opened: Awaited<ReturnType<typeof openSession>>): Promise<string[]> {
    const session = await opened.mgr.getSessionByFilePath(opened.filePath);
    if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
    return session.doc.buildDocumentView({ includeSemanticTags: false }).nodes.map((n) => n.clean_text);
  }

  // Two dry runs can refuse: the AI-revision preflight (an AI author is set)
  // and, under "error" without an AI author, the empty-numbered preview.
  const dryRuns = [
    { name: 'AI-revision preflight', policy: 'ignore', aiAuthor: 'SafeDocX AI' },
    { name: 'empty-numbered preview', policy: 'error', aiAuthor: null },
  ] as const;
  for (const { name, policy, aiAuthor } of dryRuns) {
    test(`refuses the whole batch when a replace_text planner refuses in the ${name}`, async ({ given, when, then }: AllureBddContext) => {
      let opened: Awaited<ReturnType<typeof openSession>>;
      let before: string[];
      let result: Awaited<ReturnType<typeof batchEdit>>;

      await given('a paragraph where the first step makes the second step\'s old_string ambiguous', async () => {
        opened = await openSession(['The cat sat near the dog.', 'Second paragraph.'], {
          mgr: new SessionManager({ defaultAiAuthor: aiAuthor }),
        });
        before = await bodyTexts(opened);
      });

      await when('batch_edit runs both steps', async () => {
        const pid = opened.paraIds[0]!;
        result = await batchEdit(opened.mgr, {
          file_path: opened.filePath,
          on_empty_numbered_paragraph: policy,
          steps: [
            { step_id: 'a', operation: 'replace_text', target_paragraph_id: opened.paraIds[1]!, old_string: 'Second', new_string: 'Other', instruction: 'rename' },
            { step_id: 'b', operation: 'replace_text', target_paragraph_id: pid, old_string: 'dog', new_string: 'cat', instruction: 'swap' },
            { step_id: 'c', operation: 'replace_text', target_paragraph_id: pid, old_string: 'cat', new_string: 'bird', instruction: 'rename' },
          ],
        });
      });

      await then('the batch is refused and no step is applied', async () => {
        expect(result.success).toBe(false);
        expect(JSON.stringify(result)).toContain('MULTIPLE_MATCHES');
        expect((result as { error?: { code?: string } }).error?.code).toBe('BATCH_EDIT_ERROR');
        expect(result).not.toHaveProperty('completed_step_ids');
        expect(await bodyTexts(opened)).toEqual(before);
      });
    });

    test(`refuses the whole batch when an insert_paragraph planner refuses in the ${name}`, async ({ given, when, then }: AllureBddContext) => {
      let opened: Awaited<ReturnType<typeof openSession>>;
      let before: string[];
      let result: Awaited<ReturnType<typeof batchEdit>>;

      await given('a session with two paragraphs', async () => {
        opened = await openSession(['First paragraph.', 'Second paragraph.'], {
          mgr: new SessionManager({ defaultAiAuthor: aiAuthor }),
        });
        before = await bodyTexts(opened);
      });

      await when('batch_edit runs a valid replace then an insert whose new_string has an unclosed tag', async () => {
        result = await batchEdit(opened.mgr, {
          file_path: opened.filePath,
          on_empty_numbered_paragraph: policy,
          steps: [
            { step_id: 'a', operation: 'replace_text', target_paragraph_id: opened.paraIds[0]!, old_string: 'First', new_string: 'Opening', instruction: 'rename' },
            { step_id: 'b', operation: 'insert_paragraph', positional_anchor_node_id: opened.paraIds[1]!, new_string: '<b>Unclosed bold', instruction: 'add' },
          ],
        });
      });

      await then('the batch is refused and no step is applied', async () => {
        expect(result.success).toBe(false);
        expect((result as { error?: { code?: string } }).error?.code).toBe('BATCH_EDIT_ERROR');
        expect(result).not.toHaveProperty('completed_step_ids');
        expect(await bodyTexts(opened)).toEqual(before);
      });
    });
  }

  test('reports empty numbered paragraphs under "error" when a concurrent edit lands between the preview and the steps', async ({ given, when, then }: AllureBddContext) => {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof batchEdit>>;
    let concurrent: Awaited<ReturnType<typeof replaceText>>;

    await given('a numbered item "cat dog" and a replace_text call that removes "dog" while the batch is between its preview and its steps', async () => {
      opened = await openSession([], {
        mgr: new SessionManager({ defaultAiAuthor: null }),
        xml: `<w:document xmlns:w="${ns}"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>cat dog</w:t></w:r></w:p><w:p><w:r><w:t>Tail</w:t></w:r></w:p></w:body></w:document>`,
        extraFiles: {
          'word/numbering.xml': `<w:numbering xmlns:w="${ns}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
        },
      });
    });

    await when('batch_edit blanks "cat" with on_empty_numbered_paragraph "error"', async () => {
      const mgr = opened.mgr;
      const id = opened.paraIds[0]!;
      const original = mgr.mutateSession.bind(mgr);
      let entered!: () => void;
      let release!: () => void;
      const enteredPromise = new Promise<void>((r) => { entered = r; });
      const gate = new Promise<void>((r) => { release = r; });
      let calls = 0;
      // Hold the concurrent replace inside its mutation until the batch's
      // first step mutation is queued behind it, after the batch's preview.
      mgr.mutateSession = (async (active: Parameters<typeof original>[0], execute: Parameters<typeof original>[1]) => {
        calls += 1;
        if (calls === 1) return original(active, async (candidate) => { entered(); await gate; return execute(candidate); });
        release();
        return original(active, execute);
      }) as typeof mgr.mutateSession;
      const pending = replaceText(mgr, { file_path: opened.filePath, target_paragraph_id: id, old_string: 'dog', new_string: '', instruction: 'remove dog', on_empty_numbered_paragraph: 'ignore' });
      await enteredPromise;
      result = await batchEdit(mgr, {
        file_path: opened.filePath,
        on_empty_numbered_paragraph: 'error',
        steps: [{ step_id: 'blank-cat', operation: 'replace_text', target_paragraph_id: id, old_string: 'cat', new_string: ' ', instruction: 'blank cat' }],
      });
      concurrent = await pending;
    });

    await then('the batch fails with EMPTY_NUMBERED_PARAGRAPH and says the step was applied', () => {
      assertSuccess(concurrent, 'concurrent replace_text');
      assertFailure(result, 'EMPTY_NUMBERED_PARAGRAPH');
      expect((result as { error: { message: string } }).error.message).toContain('The steps were applied before this was detected.');
      expect((result as { completed_step_ids?: string[] }).completed_step_ids).toEqual(['blank-cat']);
    });
  });
});
