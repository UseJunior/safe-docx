import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import { openDocument } from './open_document.js';
import { readFile } from './read_file.js';
import { getSessionStatus } from './get_session_status.js';
import { extractParaIdsFromToon, makeDocxWithDocumentXml } from '../testing/docx_test_utils.js';
import { testAllure, allureStep, allureJsonAttachment } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  openSession,
  registerCleanup,
  createTestSessionManager,
  createTrackedTempDir,
} from '../testing/session-test-utils.js';

const TEST_FEATURE = 'add-auto-normalization-on-open';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

type NormalizationSummary = {
  runs_merged?: number;
  redlines_simplified?: number;
  normalization_skipped?: boolean;
};

type ReusedSessionContext = {
  edit_revision?: number;
  edit_count?: number;
  created_at?: string;
  last_used_at?: string;
};

type SessionResolutionMetadata = {
  session_resolution?: string;
  resolved_session_id?: string;
  resolved_file_path?: string;
  reused_existing_session?: boolean;
  warning?: string;
  reused_session_context?: ReusedSessionContext;
  normalization?: NormalizationSummary;
};

function sessionMetadata(value: unknown): SessionResolutionMetadata {
  return value as SessionResolutionMetadata;
}

function normalizationSummary(value: unknown): NormalizationSummary {
  return sessionMetadata(value).normalization ?? {};
}

/** XML with two mergeable same-format runs in a paragraph. */
const MERGEABLE_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="${W_NS}">` +
  `<w:body>` +
  `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>World</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>` +
  `</w:body></w:document>`;

async function writeTestDocx(tmpDir: string, xml: string, filename = 'input.docx'): Promise<string> {
  const inputPath = path.join(tmpDir, filename);
  const buf = await makeDocxWithDocumentXml(xml);
  await fs.writeFile(inputPath, new Uint8Array(buf));
  return inputPath;
}

describe('Traceability: Auto-Normalization on Open', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
  const humanReadableTest = test.allure({
    tags: ['human-readable'],
    parameters: { audience: 'non-technical' },
  });
  registerCleanup();

  // ── ADDED: Automatic Document Normalization ─────────────────────────

  humanReadableTest.openspec('document is normalized on open by default')('Scenario: document is normalized on open by default', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('norm-allure-default-');
    const inputPath = await writeTestDocx(tmpDir, MERGEABLE_XML);

    const opened = await allureStep('When a document is opened via open_document without skip_normalization', async () => {
      const r = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(r, 'open_document');
      await allureJsonAttachment('open_document response', r);
      return r;
    });

    await allureStep('Then normalization SHALL have merged runs', () => {
      const norm = normalizationSummary(opened);
      expect(norm.runs_merged).toBeGreaterThanOrEqual(1);
      expect(norm.normalization_skipped).toBe(false);
    });
  });

  humanReadableTest.openspec('skip_normalization bypasses preprocessing')('Scenario: skip_normalization bypasses preprocessing', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('norm-allure-skip-');
    const inputPath = await writeTestDocx(tmpDir, MERGEABLE_XML);

    const opened = await allureStep('When a document is opened with skip_normalization=true', async () => {
      const r = await openDocument(mgr, { file_path: inputPath, skip_normalization: true });
      assertSuccess(r, 'open_document');
      await allureJsonAttachment('open_document response', r);
      return r;
    });

    await allureStep('Then session metadata SHALL report normalization_skipped=true', () => {
      const norm = normalizationSummary(opened);
      expect(norm.normalization_skipped).toBe(true);
    });
  });

  humanReadableTest.openspec('normalization stats in session metadata')('Scenario: normalization stats in session metadata', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('norm-allure-stats-');
    const inputPath = await writeTestDocx(tmpDir, MERGEABLE_XML);

    const opened = await allureStep('Given a document that has been normalized on open', async () => {
      const r = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(r, 'open_document');
      return r;
    });

    const status = await allureStep('When get_session_status is called', async () => {
      const r = await getSessionStatus(mgr, { session_id: opened.session_id as string });
      assertSuccess(r, 'get_session_status');
      await allureJsonAttachment('get_session_status response', r);
      return r;
    });

    await allureStep('Then the response SHALL include runs_merged, redlines_simplified, and normalization_skipped fields', () => {
      const norm = normalizationSummary(status);
      expect(norm).toBeTruthy();
      expect(typeof norm.runs_merged).toBe('number');
      expect(typeof norm.redlines_simplified).toBe('number');
      expect(typeof norm.normalization_skipped).toBe('boolean');
      expect(norm.normalization_skipped).toBe(false);
    });
  });

  humanReadableTest.openspec('_bk_* IDs stable across normalization')('Scenario: _bk_* IDs stable across normalization', async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${W_NS}">` +
      `<w:body>` +
      `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>World</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>` +
      `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Third </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const normalizedIds = await allureStep('Given a document opened with normalization enabled', async () => {
      const mgr1 = createTestSessionManager();
      const tmpDir1 = await createTrackedTempDir('norm-allure-ids-on-');
      const inputPath1 = await writeTestDocx(tmpDir1, xml);
      const opened1 = await openDocument(mgr1, { file_path: inputPath1 });
      assertSuccess(opened1, 'open with normalization');
      const read1 = await readFile(mgr1, { session_id: opened1.session_id as string });
      assertSuccess(read1, 'read with normalization');
      return extractParaIdsFromToon(String(read1.content));
    });

    const skippedIds = await allureStep('And the same document opened with normalization disabled', async () => {
      const mgr2 = createTestSessionManager();
      const tmpDir2 = await createTrackedTempDir('norm-allure-ids-off-');
      const inputPath2 = await writeTestDocx(tmpDir2, xml);
      const opened2 = await openDocument(mgr2, { file_path: inputPath2, skip_normalization: true });
      assertSuccess(opened2, 'open without normalization');
      const read2 = await readFile(mgr2, { session_id: opened2.session_id as string });
      assertSuccess(read2, 'read without normalization');
      return extractParaIdsFromToon(String(read2.content));
    });

    await allureStep('Then unchanged paragraphs SHALL receive the same _bk_* identifiers', async () => {
      await allureJsonAttachment('normalized IDs', normalizedIds);
      await allureJsonAttachment('skipped IDs', skippedIds);
      expect(normalizedIds.length).toBe(3);
      expect(skippedIds.length).toBe(3);
      expect(normalizedIds).toEqual(skippedIds);
    });
  });

  // ── MODIFIED: Tool Session Entry ────────────────────────────────────

  humanReadableTest.openspec('document tools accept file-first entry without pre-open')('Scenario: document tools accept file-first entry without pre-open', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('norm-allure-filefirst-');
    const inputPath = await writeTestDocx(tmpDir, MERGEABLE_XML);

    const result = await allureStep('When readFile is called with file_path and without session_id', async () => {
      const r = await readFile(mgr, { file_path: inputPath });
      assertSuccess(r, 'readFile file-first');
      await allureJsonAttachment('readFile response', r);
      return r;
    });

    await allureStep('Then the server SHALL resolve a session and return session_resolution metadata', () => {
      const meta = sessionMetadata(result);
      expect(meta.session_resolution).toBe('opened_new_session');
      expect(meta.resolved_session_id).toBeTruthy();
      expect(meta.resolved_file_path).toBeTruthy();
    });
  });

  humanReadableTest.openspec('reuse policy selects most-recently-used session')('Scenario: reuse policy selects most-recently-used session', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('norm-allure-reuse-');
    const inputPath = await writeTestDocx(tmpDir, MERGEABLE_XML);

    const first = await allureStep('Given a document is opened via file_path', async () => {
      const r = await readFile(mgr, { file_path: inputPath });
      assertSuccess(r, 'first read');
      return r;
    });

    const second = await allureStep('When the same tool is called again with the same file_path', async () => {
      const r = await readFile(mgr, { file_path: inputPath });
      assertSuccess(r, 'second read');
      await allureJsonAttachment('second readFile response', r);
      return r;
    });

    await allureStep('Then the second call SHALL reuse the existing session', () => {
      const firstMeta = sessionMetadata(first);
      const secondMeta = sessionMetadata(second);
      expect(secondMeta.resolved_session_id).toBe(firstMeta.resolved_session_id);
      expect(secondMeta.session_resolution).toBe('reused_existing_session');
    });
  });

  humanReadableTest.openspec('existing session reuse is non-blocking and warns via metadata')('Scenario: existing session reuse is non-blocking and warns via metadata', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('norm-allure-warn-');
    const inputPath = await writeTestDocx(tmpDir, MERGEABLE_XML);

    await allureStep('Given an active editing session already exists for a file', async () => {
      const r = await readFile(mgr, { file_path: inputPath });
      assertSuccess(r, 'initial open');
    });

    const reused = await allureStep('When a document tool is called with that file_path and no session_id', async () => {
      const r = await readFile(mgr, { file_path: inputPath });
      assertSuccess(r, 'reuse read');
      await allureJsonAttachment('reuse response', r);
      return r;
    });

    await allureStep('Then the server SHALL return warning metadata indicating existing session reuse', () => {
      const meta = sessionMetadata(reused);
      expect(meta.reused_existing_session).toBe(true);
      expect(meta.warning).toBeTruthy();
    });

    await allureStep('And SHALL include reuse context in the response', () => {
      const ctx = sessionMetadata(reused).reused_session_context;
      expect(ctx).toBeTruthy();
      if (!ctx) throw new Error('expected reused_session_context');
      expect(typeof ctx.edit_revision).toBe('number');
      expect(typeof ctx.edit_count).toBe('number');
      expect(ctx.created_at).toBeTruthy();
      expect(ctx.last_used_at).toBeTruthy();
    });
  });

  humanReadableTest.openspec('conflicting `session_id` and `file_path` is rejected')('Scenario: conflicting session_id and file_path is rejected', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('norm-allure-conflict-');
    const inputPath1 = await writeTestDocx(tmpDir, MERGEABLE_XML, 'doc1.docx');
    const inputPath2 = await writeTestDocx(tmpDir, MERGEABLE_XML, 'doc2.docx');

    const opened = await allureStep('Given a session opened for one document', async () => {
      const r = await openDocument(mgr, { file_path: inputPath1 });
      assertSuccess(r, 'open doc1');
      return r;
    });

    const result = await allureStep('When a tool call provides that session_id with a different file_path', async () => {
      const r = await readFile(mgr, {
        session_id: opened.session_id as string,
        file_path: inputPath2,
      });
      await allureJsonAttachment('conflict response', r);
      return r;
    });

    await allureStep('Then the server SHALL reject the call with a conflict error', () => {
      assertFailure(result, 'SESSION_FILE_CONFLICT', 'conflict');
    });
  });

  humanReadableTest.openspec('new session creation includes normalization')('Scenario: new session creation includes normalization', async () => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('norm-allure-newsession-');
    const inputPath = await writeTestDocx(tmpDir, MERGEABLE_XML);

    const read = await allureStep('When readFile is called with file_path on a doc with mergeable runs', async () => {
      const r = await readFile(mgr, { file_path: inputPath });
      assertSuccess(r, 'readFile file-first');
      return r;
    });

    const status = await allureStep('And get_session_status is called for the resolved session', async () => {
      const resolvedSessionId = sessionMetadata(read).resolved_session_id;
      expect(resolvedSessionId).toBeTruthy();
      const r = await getSessionStatus(mgr, { session_id: resolvedSessionId as string });
      assertSuccess(r, 'get_session_status');
      await allureJsonAttachment('session status', r);
      return r;
    });

    await allureStep('Then normalization stats SHALL be present and not skipped', () => {
      const norm = normalizationSummary(status);
      expect(norm).toBeTruthy();
      expect(norm.normalization_skipped).toBe(false);
      expect(norm.runs_merged).toBeGreaterThanOrEqual(1);
      expect(typeof norm.redlines_simplified).toBe('number');
    });
  });
});
