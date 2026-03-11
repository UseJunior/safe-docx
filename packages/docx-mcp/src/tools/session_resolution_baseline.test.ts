import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveSessionForTool } from './session_resolution.js';
import { save } from './save.js';
import { compareDocuments_tool } from './compare_documents.js';
import { createTestSessionManager, createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';
import { makeDocxWithDocumentXml } from '../testing/docx_test_utils.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Session Resolution Baseline' });

/**
 * Regression tests for comparison baseline capture during auto-open
 * (session_resolution path).
 *
 * Before this fix, resolveSessionForTool normalized the document and inserted
 * bookmarks but never captured post-normalization baselines. This caused the
 * atomizer to treat every merged run as a tracked change.
 */

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const FRAGMENTED_RUNS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:body>` +
  `<w:p><w:r><w:t>By</w:t></w:r><w:r><w:t>laws</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Amend</w:t></w:r><w:r><w:t>ment</w:t></w:r></w:p>` +
  `</w:body></w:document>`;

async function createFragmentedDoc(dir: string, name = 'fragmented.docx'): Promise<string> {
  const filePath = path.join(dir, name);
  const buf = await makeDocxWithDocumentXml(FRAGMENTED_RUNS_XML, {
    '[Content_Types].xml': CONTENT_TYPES_XML,
    '_rels/.rels': RELS_XML,
  });
  await fs.writeFile(filePath, new Uint8Array(buf));
  return filePath;
}

describe('auto-open baseline capture regression', () => {
  registerCleanup();

  test('save(tracked) produces zero changes after auto-open of fragmented-runs doc', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let inputPath: string;
    let savePath: string;
    let trackedPath: string;
    let resolved: Awaited<ReturnType<typeof resolveSessionForTool>>;
    let result: Awaited<ReturnType<typeof save>>;

    await given('a fragmented-runs document auto-opened via session_resolution', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-baseline-save-');
      inputPath = await createFragmentedDoc(tmpDir);
      savePath = path.join(tmpDir, 'output.docx');
      trackedPath = path.join(tmpDir, 'output.tracked.docx');

      // Auto-open via file_path (the session_resolution path)
      resolved = await resolveSessionForTool(mgr, { file_path: inputPath }, { toolName: 'save' });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.metadata.session_resolution).toBe('opened_new_session');
    });
    await when('save is called with tracked format and no edits were made', async () => {
      if (!resolved.ok) return;
      result = await save(mgr, {
        session_id: resolved.session.sessionId,
        save_to_local_path: savePath,
        save_format: 'tracked',
        tracked_save_to_local_path: trackedPath,
      });
    });
    await then('the tracked changes stats show zero insertions, deletions, and modifications', () => {
      expect(result.success).toBe(true);
      if (!result.success) return;

      // The key assertion: zero tracked changes because baseline was captured
      // post-normalization, so merged runs don't appear as diffs.
      const stats = (result as Record<string, unknown>).tracked_changes_stats as
        | { insertions: number; deletions: number; modifications: number }
        | undefined;
      if (stats) {
        expect(stats.insertions).toBe(0);
        expect(stats.deletions).toBe(0);
        expect(stats.modifications).toBe(0);
      }
    });
  });

  test('compare_documents(session mode) produces zero changes after auto-open', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let inputPath: string;
    let comparePath: string;
    let resolved: Awaited<ReturnType<typeof resolveSessionForTool>>;
    let result: Awaited<ReturnType<typeof compareDocuments_tool>>;

    await given('a fragmented-runs document auto-opened via session_resolution', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-baseline-compare-');
      inputPath = await createFragmentedDoc(tmpDir);
      comparePath = path.join(tmpDir, 'compared.docx');

      // Auto-open via file_path
      resolved = await resolveSessionForTool(mgr, { file_path: inputPath }, { toolName: 'compare_documents' });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
    });
    await when('compareDocuments_tool is called in session mode with no edits', async () => {
      if (!resolved.ok) return;
      result = await compareDocuments_tool(mgr, {
        session_id: resolved.session.sessionId,
        save_to_local_path: comparePath,
      });
    });
    await then('the comparison stats show zero insertions, deletions, and modifications', () => {
      expect(result.success).toBe(true);
      if (!result.success) return;

      const stats = (result as Record<string, unknown>).stats as
        | { insertions: number; deletions: number; modifications: number }
        | undefined;
      if (stats) {
        expect(stats.insertions).toBe(0);
        expect(stats.deletions).toBe(0);
        expect(stats.modifications).toBe(0);
      }
    });
  });

  test('finalizeNewSession sets non-null baselines on auto-opened session', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createTestSessionManager>;
    let inputPath: string;
    let resolved: Awaited<ReturnType<typeof resolveSessionForTool>>;

    await given('a fragmented-runs document', async () => {
      mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-baseline-unit-');
      inputPath = await createFragmentedDoc(tmpDir);
    });
    await when('resolveSessionForTool auto-opens the document', async () => {
      resolved = await resolveSessionForTool(mgr, { file_path: inputPath }, { toolName: 'read_file' });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
    });
    await then('the session has non-null Buffer baselines', () => {
      if (!resolved.ok) return;
      const session = resolved.session;
      expect(session.comparisonBaseline).not.toBeNull();
      expect(session.comparisonBaselineWithBookmarks).not.toBeNull();
      expect(Buffer.isBuffer(session.comparisonBaseline)).toBe(true);
      expect(Buffer.isBuffer(session.comparisonBaselineWithBookmarks)).toBe(true);
      expect(session.comparisonBaseline!.length).toBeGreaterThan(0);
      expect(session.comparisonBaselineWithBookmarks!.length).toBeGreaterThan(0);
    });
  });
});
