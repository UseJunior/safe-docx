import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { SessionManager, type DocxSession } from '../session/manager.js';
import { addComment } from './add_comment.js';
import { clearFormatting } from './clear_formatting.js';
import { formatLayout } from './format_layout.js';
import { getFileStatus } from './get_file_status.js';
import { readFile } from './read_file.js';
import { replaceText } from './replace_text.js';
import { save } from './save.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';

const TEST_FEATURE = 'add-ai-revision-validator';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AI = 'SafeDocX AI';

const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

function manager(): SessionManager {
  return new SessionManager({ defaultAiAuthor: AI });
}

function documentXml(body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`
  );
}

async function docxSession(mgr: SessionManager, filePath: string): Promise<DocxSession> {
  const session = await mgr.getSessionByFilePath(filePath);
  if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
  return session;
}

describe('AI revision validation guard', () => {
  registerCleanup();

  test.openspec('invalid AI revision mutation is rejected')('Scenario: invalid AI revision mutation is rejected', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a session containing malformed AI-authored revision markup', () =>
      openSession([], {
        mgr: manager(),
        xml: documentXml(
          `<w:p><w:r><w:t>Alpha</w:t></w:r>` +
          `<w:ins w:id="1" w:author="${AI}"><w:r><w:t>Bad</w:t></w:r></w:ins></w:p>`,
        ),
      }),
    );

    const result = await when('a tracked layout write is requested', () =>
      formatLayout(opened.mgr, {
        file_path: opened.filePath,
        strict: true,
        paragraph_spacing: {
          paragraph_ids: [opened.firstParaId],
          before_twips: 120,
        },
      }),
    );

    await then('the request is rejected with structured diagnostics', () => {
      assertFailure(result, 'AI_REVISION_VALIDATION_FAILED');
      expect(result.diagnostics).toMatchObject({
        errors: expect.arrayContaining([expect.objectContaining({ code: 'REVISION_METADATA_MISSING' })]),
      });
    });
  });

  test.openspec('failed validation leaves session unchanged')('Scenario: failed validation leaves session unchanged', async ({ given, when, then, and }: AllureBddContext) => {
    const opened = await given('a session with a known revision and malformed AI revision markup', () =>
      openSession([], {
        mgr: manager(),
        xml: documentXml(
          `<w:p><w:r><w:t>Alpha</w:t></w:r>` +
          `<w:ins w:id="2" w:author="${AI}"><w:r><w:t>Bad</w:t></w:r></w:ins></w:p>`,
        ),
      }),
    );
    const beforeStatus = await getFileStatus(opened.mgr, { file_path: opened.filePath });
    assertSuccess(beforeStatus);
    const beforeRead = await readFile(opened.mgr, { file_path: opened.filePath, format: 'toon' });
    assertSuccess(beforeRead);
    const beforeSession = await docxSession(opened.mgr, opened.filePath);
    const cacheSizeBefore = beforeSession.saveCache.size;

    await when('the preflight validator rejects a write', async () => {
      const result = await formatLayout(opened.mgr, {
        file_path: opened.filePath,
        strict: true,
        paragraph_spacing: {
          paragraph_ids: [opened.firstParaId],
          after_twips: 240,
        },
      });
      assertFailure(result, 'AI_REVISION_VALIDATION_FAILED');
    });

    await then('edit revision and edit count are unchanged', async () => {
      const afterStatus = await getFileStatus(opened.mgr, { file_path: opened.filePath });
      assertSuccess(afterStatus);
      expect(afterStatus.edit_revision).toBe(beforeStatus.edit_revision);
      expect(afterStatus.edit_count).toBe(beforeStatus.edit_count);
    });
    await and('read output and save cache state are unchanged', async () => {
      const afterRead = await readFile(opened.mgr, { file_path: opened.filePath, format: 'toon' });
      assertSuccess(afterRead);
      expect(afterRead.content).toBe(beforeRead.content);
      const afterSession = await docxSession(opened.mgr, opened.filePath);
      expect(afterSession.saveCache.size).toBe(cacheSizeBefore);
    });
  });

  test.openspec('invalid AI revision mutation is rejected')('Scenario: replace_text validation failure leaves session unchanged', async ({ given, when, then, and }: AllureBddContext) => {
    const opened = await given('a session containing malformed AI-authored revision markup', () =>
      openSession([], {
        mgr: manager(),
        xml: documentXml(
          `<w:p><w:r><w:t>Alpha Beta</w:t></w:r>` +
          `<w:ins w:id="8" w:author="${AI}"><w:r><w:t>Bad</w:t></w:r></w:ins></w:p>`,
        ),
      }),
    );
    const beforeStatus = await getFileStatus(opened.mgr, { file_path: opened.filePath });
    assertSuccess(beforeStatus);
    const beforeRead = await readFile(opened.mgr, { file_path: opened.filePath, format: 'toon' });
    assertSuccess(beforeRead);

    const result = await when('replace_text is requested', () =>
      replaceText(opened.mgr, {
        file_path: opened.filePath,
        target_paragraph_id: opened.firstParaId,
        old_string: 'Beta',
        new_string: 'Gamma',
        instruction: 'replace Beta',
      }),
    );

    await then('the write is rejected by the AI revision guard', () => {
      assertFailure(result, 'AI_REVISION_VALIDATION_FAILED');
      expect(result.diagnostics).toMatchObject({
        errors: expect.arrayContaining([expect.objectContaining({ code: 'REVISION_METADATA_MISSING' })]),
      });
    });
    await and('the session content and revision counters are unchanged', async () => {
      const afterStatus = await getFileStatus(opened.mgr, { file_path: opened.filePath });
      assertSuccess(afterStatus);
      expect(afterStatus.edit_revision).toBe(beforeStatus.edit_revision);
      expect(afterStatus.edit_count).toBe(beforeStatus.edit_count);
      const afterRead = await readFile(opened.mgr, { file_path: opened.filePath, format: 'toon' });
      assertSuccess(afterRead);
      expect(afterRead.content).toBe(beforeRead.content);
    });
  });

  test.openspec('foreign revision anomalies do not block AI writes')('Scenario: foreign revision anomalies do not block AI writes', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a session with malformed foreign revision metadata', () =>
      openSession([], {
        mgr: manager(),
        xml: documentXml(
          // Schema-valid but validator-flagged: w:date is optional in the OOXML
          // schema yet required by the AI revision validator, so the missing
          // date is a foreign warning without polluting the emitted-XML
          // schema corpus captured in CI.
          `<w:p><w:r><w:t>Alpha</w:t></w:r>` +
          `<w:del w:id="901" w:author="Human"><w:r><w:delText>Old</w:delText></w:r></w:del></w:p>`,
        ),
      }),
    );

    const result = await when('a valid AI layout write is requested', () =>
      formatLayout(opened.mgr, {
        file_path: opened.filePath,
        strict: true,
        paragraph_spacing: {
          paragraph_ids: [opened.firstParaId],
          before_twips: 120,
        },
      }),
    );

    await then('the write succeeds', async () => {
      assertSuccess(result);
      const status = await getFileStatus(opened.mgr, { file_path: opened.filePath });
      assertSuccess(status);
      expect(status.edit_revision).toBe(1);
    });
  });

  test.openspec('save fails on invalid AI revisions')('Scenario: save fails on invalid AI revisions', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a session containing malformed AI-authored revision markup', () =>
      openSession([], {
        mgr: manager(),
        xml: documentXml(
          `<w:p><w:r><w:t>Alpha</w:t></w:r>` +
          `<w:ins w:id="4" w:author="${AI}"><w:r><w:t>Bad</w:t></w:r></w:ins></w:p>`,
        ),
      }),
    );
    const cleanPath = path.join(opened.tmpDir, 'invalid-clean.docx');
    const trackedPath = path.join(opened.tmpDir, 'invalid-redline.docx');

    const result = await when('save is called for a redline artifact', () =>
      save(opened.mgr, {
        file_path: opened.filePath,
        save_to_local_path: cleanPath,
        tracked_save_to_local_path: trackedPath,
        save_format: 'both',
      }),
    );

    await then('save fails and no artifacts are written', async () => {
      assertFailure(result, 'INVALID_AI_REVISIONS');
      expect(result.diagnostics).toMatchObject({
        errors: expect.arrayContaining([expect.objectContaining({ code: 'REVISION_METADATA_MISSING' })]),
      });
      await expect(fs.access(cleanPath)).rejects.toThrow();
      await expect(fs.access(trackedPath)).rejects.toThrow();
    });
  });

  test.openspec('save reports foreign revision warnings')('Scenario: save reports foreign revision warnings', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('a session with valid AI revisions and malformed foreign revisions', () =>
      openSession([], {
        mgr: manager(),
        xml: documentXml(
          // Foreign del intentionally lacks w:date (schema-valid, validator
          // warning) — see comment in the foreign-anomalies write test.
          `<w:p>` +
          `<w:ins w:id="5" w:author="${AI}" w:date="2026-01-01T00:00:00Z"><w:r><w:t>AI</w:t></w:r></w:ins>` +
          `<w:del w:id="902" w:author="Human"><w:r><w:delText>Human</w:delText></w:r></w:del>` +
          `</w:p>`,
        ),
      }),
    );
    const outPath = path.join(opened.tmpDir, 'foreign-warnings.docx');

    const result = await when('save is called', () =>
      save(opened.mgr, {
        file_path: opened.filePath,
        save_to_local_path: outPath,
        save_format: 'clean',
      }),
    );

    await then('save succeeds and includes warning diagnostics', async () => {
      assertSuccess(result);
      expect(result.validation).toMatchObject({
        warnings: expect.arrayContaining([expect.objectContaining({ severity: 'warning' })]),
      });
      await expect(fs.access(outPath)).resolves.toBeUndefined();
    });
  });

  test('pre-existing unattributable anomalies do not block writes or saves', async () => {
    const opened = await openSession([], {
      mgr: manager(),
      xml: documentXml(
        `<w:p><w:r><w:t>Alpha Beta</w:t></w:r></w:p>` +
        `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>`,
      ),
    });

    const writeResult = await replaceText(opened.mgr, {
      file_path: opened.filePath,
      target_paragraph_id: opened.firstParaId,
      old_string: 'Beta',
      new_string: 'Gamma',
      instruction: 'replace Beta',
    });
    assertSuccess(writeResult);
    // The pre-existing anomaly is demoted rather than blocking, but it is
    // still a finding: the success response must surface it (#686) instead of
    // silently dropping the demoted diagnostics.
    expect(writeResult.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('FIELD_BEGIN_END_MISMATCH')]),
    );

    const outPath = path.join(opened.tmpDir, 'preexisting-anomaly.docx');
    const saveResult = await save(opened.mgr, {
      file_path: opened.filePath,
      save_to_local_path: outPath,
      save_format: 'clean',
    });
    assertSuccess(saveResult);
    expect(saveResult.validation).toMatchObject({
      warnings: expect.arrayContaining([
        expect.objectContaining({ code: 'FIELD_BEGIN_END_MISMATCH', severity: 'warning' }),
      ]),
    });
    await expect(fs.access(outPath)).resolves.toBeUndefined();
  });

  test('successful replace_text surfaces non-blocking validator warnings (#686)', async () => {
    const opened = await openSession([], {
      mgr: manager(),
      xml: documentXml(
        // Foreign del intentionally lacks w:date: schema-valid, but the AI
        // revision validator flags it as a non-blocking warning. Before #686
        // the success path returned bare null from the preflight and this
        // warning was structurally unreachable.
        `<w:p><w:r><w:t>Alpha Beta</w:t></w:r>` +
        `<w:del w:id="903" w:author="Human"><w:r><w:delText>Old</w:delText></w:r></w:del></w:p>`,
      ),
    });

    const result = await replaceText(opened.mgr, {
      file_path: opened.filePath,
      target_paragraph_id: opened.firstParaId,
      old_string: 'Beta',
      new_string: 'Gamma',
      instruction: 'replace Beta',
    });

    assertSuccess(result);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('REVISION_METADATA_MISSING')]),
    );
  });

  test('successful replace_text with no validator findings omits the warnings field (#686)', async () => {
    const opened = await openSession([], {
      mgr: manager(),
      xml: documentXml(`<w:p><w:r><w:t>Alpha Beta</w:t></w:r></w:p>`),
    });

    const result = await replaceText(opened.mgr, {
      file_path: opened.filePath,
      target_paragraph_id: opened.firstParaId,
      old_string: 'Beta',
      new_string: 'Gamma',
      instruction: 'replace Beta',
    });

    assertSuccess(result);
    expect('warnings' in result).toBe(false);
  });

  test('successful clear_formatting surfaces non-blocking validator warnings (#686)', async () => {
    const opened = await openSession([], {
      mgr: manager(),
      xml: documentXml(
        `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Alpha</w:t></w:r>` +
        `<w:del w:id="904" w:author="Human"><w:r><w:delText>Old</w:delText></w:r></w:del></w:p>`,
      ),
    });

    const result = await clearFormatting(opened.mgr, {
      file_path: opened.filePath,
      paragraph_ids: [opened.firstParaId],
      clear_bold: true,
    });

    assertSuccess(result);
    expect(result.paragraphs_modified).toBe(1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('REVISION_METADATA_MISSING')]),
    );
  });

  test('successful add_comment surfaces non-blocking validator warnings (#686)', async () => {
    const opened = await openSession([], {
      mgr: manager(),
      xml: documentXml(
        `<w:p><w:r><w:t>Alpha Beta</w:t></w:r>` +
        `<w:del w:id="905" w:author="Human"><w:r><w:delText>Old</w:delText></w:r></w:del></w:p>`,
      ),
    });

    const result = await addComment(opened.mgr, {
      file_path: opened.filePath,
      target_paragraph_id: opened.firstParaId,
      anchor_text: 'Beta',
      author: 'Reviewer',
      text: 'Please double-check this.',
    });

    assertSuccess(result);
    expect(result.mode).toBe('root');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('REVISION_METADATA_MISSING')]),
    );
  });

  test('formatAiRevisionWarning renders code, message, and any location fields (#686)', async () => {
    const { formatAiRevisionWarning } = await import('./ai_revision_guard.js');
    expect(
      formatAiRevisionWarning({ severity: 'warning', code: 'SOME_CODE', message: 'something odd' }),
    ).toBe('SOME_CODE: something odd');
    expect(
      formatAiRevisionWarning({
        severity: 'warning',
        code: 'SOME_CODE',
        message: 'something odd',
        part: 'word/document.xml',
        element: 'w:del',
        id: '9',
        author: 'Human',
      }),
    ).toBe('SOME_CODE: something odd (word/document.xml, w:del, id=9, author=Human)');
  });

  test('introduced instances of a pre-existing structural error still fail (count-based baseline)', async () => {
    const { splitIntroducedDiagnostics } = await import('./ai_revision_guard.js');
    const diag = (msg: string) => ({
      severity: 'error' as const,
      code: 'TEXT_INSIDE_DELETION',
      message: msg,
      part: 'word/document.xml',
      element: 'w:t',
    });
    const baseline = new Map([[
      'TEXT_INSIDE_DELETION|word/document.xml|w:t|||same message',
      1,
    ]]);
    const { introduced, demoted } = splitIntroducedDiagnostics(
      [diag('same message'), diag('same message'), diag('same message')],
      baseline,
    );
    expect(demoted).toHaveLength(1);
    expect(introduced).toHaveLength(2);
  });

  test('batch_edit plan-level preflight rejects invalid markup despite skipped per-step preflights', async () => {
    const { batchEdit } = await import('./batch_edit.js');
    const opened = await openSession([], {
      mgr: manager(),
      xml: documentXml(
        `<w:p><w:r><w:t>Alpha Beta</w:t></w:r>` +
        `<w:ins w:id="12" w:author="${AI}"><w:r><w:t>Bad</w:t></w:r></w:ins></w:p>`,
      ),
    });

    const result = await batchEdit(opened.mgr, {
      file_path: opened.filePath,
      steps: [{
        step_id: 's1',
        operation: 'replace_text',
        target_paragraph_id: opened.firstParaId,
        old_string: 'Beta',
        new_string: 'Gamma',
        instruction: 'replace Beta',
      }],
    });
    assertFailure(result, 'AI_REVISION_VALIDATION_FAILED');
  });

  test('every tool that obtains an AI revision context preflights AI revision mutations', async () => {
    const toolsDir = path.dirname(new URL(import.meta.url).pathname);
    const entries = await fs.readdir(toolsDir);
    const offenders: string[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry === 'ai_revision_guard.ts') continue;
      const source = await fs.readFile(path.join(toolsDir, entry), 'utf8');
      if (!source.includes('getRevisionContextForSession')) continue;
      if (!source.includes('preflightAiRevisionMutation')) offenders.push(entry);
    }

    expect(offenders).toEqual([]);
  });
});
