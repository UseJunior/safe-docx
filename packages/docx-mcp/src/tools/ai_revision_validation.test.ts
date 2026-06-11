import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { SessionManager, type DocxSession } from '../session/manager.js';
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
          `<w:p><w:r><w:t>Alpha</w:t></w:r>` +
          `<w:del w:id="foreign" w:author="Human" w:date="bad-date"><w:r><w:delText>Old</w:delText></w:r></w:del></w:p>`,
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
          `<w:p>` +
          `<w:ins w:id="5" w:author="${AI}" w:date="2026-01-01T00:00:00Z"><w:r><w:t>AI</w:t></w:r></w:ins>` +
          `<w:del w:id="bad" w:author="Human" w:date="bad-date"><w:r><w:delText>Human</w:delText></w:r></w:del>` +
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
