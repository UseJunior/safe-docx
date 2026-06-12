import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, expect } from 'vitest';
import { serializeXml } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { SessionManager, getRevisionContextForSession, type DocxSession } from '../session/manager.js';
import { beginGuardedAiWrite } from '../session/post_write_guard.js';
import { assertFailure, assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { getFileStatus } from './get_file_status.js';
import { replaceText } from './replace_text.js';
import { save } from './save.js';

const TEST_FEATURE = 'add-ai-revision-validator';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function createManager(): SessionManager {
  return new SessionManager({ ttlMs: 60_000, defaultAiAuthor: 'SafeDocX' });
}

async function getDocxSession(mgr: SessionManager, filePath: string): Promise<DocxSession> {
  const session = await mgr.getSessionByFilePath(filePath);
  if (!session || session.provider !== 'docx') {
    throw new Error('DOCX session not found');
  }
  return session;
}

function liveDocumentXml(session: DocxSession): string {
  return serializeXml(session.doc.getDocumentXmlClone());
}

function appendMalformedSessionRevision(session: DocxSession): void {
  if (!session.revisionIdState) throw new Error('revision id state was not initialized');
  const paragraph = session.doc.getParagraphs()[0];
  if (!paragraph) throw new Error('test document has no paragraph');
  const owner = paragraph.ownerDocument;
  const bad = owner.createElementNS(W_NS, 'w:ins');
  bad.setAttributeNS(W_NS, 'w:id', String(session.revisionIdState.startId));
  paragraph.appendChild(bad);
}

function appendUnmatchedFieldEnd(session: DocxSession): void {
  const paragraph = session.doc.getParagraphs()[0];
  if (!paragraph) throw new Error('test document has no paragraph');
  const owner = paragraph.ownerDocument;
  const run = owner.createElementNS(W_NS, 'w:r');
  const fldChar = owner.createElementNS(W_NS, 'w:fldChar');
  fldChar.setAttributeNS(W_NS, 'w:fldCharType', 'end');
  run.appendChild(fldChar);
  paragraph.appendChild(run);
}

describe('AI revision validation guard', () => {
  registerCleanup();

  test.openspec('failed post-write validation rolls back the edit')(
    'Scenario: failed post-write validation rolls back the edit',
    async ({ given, when, then, and }: AllureBddContext) => {
      const opened = await given('a tracked DOCX session', () =>
        openSession(['Alpha'], { mgr: createManager() }),
      );
      const session = await getDocxSession(opened.mgr, opened.inputPath);
      await getRevisionContextForSession(session);
      const beforeXml = liveDocumentXml(session);

      const failure = await when('a guarded write appends malformed session-owned revision markup', async () => {
        const guard = await beginGuardedAiWrite(session);
        appendMalformedSessionRevision(session);
        return guard.verify();
      });

      await then('the guard returns REVISION_VALIDATION_FAILED', () => {
        expect(failure).not.toBeNull();
        assertFailure(failure!, 'REVISION_VALIDATION_FAILED', 'guard verification');
      });
      await and('the live document XML and edit count are restored', async () => {
        expect(liveDocumentXml(session)).toBe(beforeXml);
        const status = await getFileStatus(opened.mgr, { file_path: opened.inputPath });
        expect(status.success).toBe(true);
        expect(status.edit_count).toBe(0);
      });
    },
  );

  test.openspec('save aborts before writing artifacts')(
    'Scenario: save aborts before writing artifacts',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a tracked DOCX session with malformed session-owned revision markup', async () => {
        const result = await openSession(['Alpha'], { mgr: createManager() });
        const session = await getDocxSession(result.mgr, result.inputPath);
        await getRevisionContextForSession(session);
        appendMalformedSessionRevision(session);
        return result;
      });

      const outputPath = path.join(opened.tmpDir, 'should-not-save.docx');
      const result = await when('save is called', () =>
        save(opened.mgr, {
          file_path: opened.inputPath,
          save_to_local_path: outputPath,
          save_format: 'clean',
        }),
      );

      await then('save refuses the session-caused validation error', () => {
        assertFailure(result, 'REVISION_VALIDATION_FAILED', 'save validation');
      });
    },
  );

  test.openspec('pre-existing third-party defects do not block AI edits')(
    'Scenario: pre-existing third-party defects do not block AI edits',
    async ({ given, when, then }: AllureBddContext) => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}"><w:body>` +
        `<w:p><w:r><w:t>Alpha Beta</w:t></w:r></w:p>` +
        `<w:p><w:del w:id="1"/></w:p>` +
        `</w:body></w:document>`;
      const opened = await given('a document with malformed pre-existing revision markup', () =>
        openSession([], { mgr: createManager(), xml }),
      );

      const result = await when('replace_text emits a valid session-owned revision', () =>
        replaceText(opened.mgr, {
          file_path: opened.inputPath,
          target_paragraph_id: opened.paraIds[0]!,
          old_string: 'Alpha',
          new_string: 'Gamma',
          instruction: 'Replace text despite pre-existing junk.',
        }),
      );

      await then('the edit succeeds instead of hard-erroring on the old revision defect', () => {
        assertSuccess(result, 'replace_text');
      });
    },
  );

  test.openspec('missing baseline degrades global defects to warnings')(
    'Scenario: missing baseline degrades global defects to warnings',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('a tracked session with no validation baseline and a global field defect', async () => {
        const result = await openSession(['Alpha'], { mgr: createManager() });
        const session = await getDocxSession(result.mgr, result.inputPath);
        await getRevisionContextForSession(session);
        session.validationBaseline = null;
        appendUnmatchedFieldEnd(session);
        return result;
      });

      const result = await when('save is called', () =>
        save(opened.mgr, {
          file_path: opened.inputPath,
          save_to_local_path: path.join(opened.tmpDir, 'baseline-missing.docx'),
          save_format: 'clean',
        }),
      );

      await then('save succeeds with a revision baseline warning', () => {
        assertSuccess(result, 'save');
        expect(result.validation).toMatchObject({
          revision_warning: expect.stringContaining('baseline was unavailable'),
        });
      });
    },
  );

  test.openspec('apply_plan remains step-level transactional')(
    'Scenario: apply_plan remains step-level transactional',
    async ({ when, then }: AllureBddContext) => {
      let source = '';
      await when('the apply_plan implementation is inspected', async () => {
        source = await fs.readFile(new URL('./apply_plan.ts', import.meta.url), 'utf8');
      });

      await then('it delegates to guarded tools without creating an outer AI write guard', () => {
        expect(source).toContain('replaceText(');
        expect(source).toContain('insertParagraph(');
        expect(source).not.toContain('beginGuardedAiWrite');
      });
    },
  );

  test.openspec('accept_changes is outside AI write validation')(
    'Scenario: accept_changes is outside AI write validation',
    async ({ when, then }: AllureBddContext) => {
      let source = '';
      await when('the accept_changes tool implementation is inspected', async () => {
        source = await fs.readFile(new URL('./accept_changes.ts', import.meta.url), 'utf8');
      });

      await then('it does not use the AI post-write guard because it consumes existing revisions', () => {
        expect(source).not.toContain('beginGuardedAiWrite');
        expect(source).toContain('acceptChanges');
      });
    },
  );
});
