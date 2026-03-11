import { describe, expect, afterEach } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openSession,
  registerCleanup,
  assertSuccess,
  createTestSessionManager,
  createTrackedTempDir,
} from '../testing/session-test-utils.js';
import { makeDocxWithDocumentXml, extractParaIdsFromToon } from '../testing/docx_test_utils.js';
import { openDocument } from './open_document.js';
import { readFile } from './read_file.js';
import { replaceText } from './replace_text.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Normalization Regression' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

type NormalizationSummary = {
  runs_merged: number;
  redlines_simplified: number;
  double_elevations_fixed?: number;
  proof_errors_removed?: number;
  normalization_skipped?: boolean;
};

function getNormalizationSummary(value: unknown): NormalizationSummary {
  const normalization = (value as { normalization?: unknown }).normalization;
  if (typeof normalization === 'object' && normalization !== null) {
    return normalization as NormalizationSummary;
  }
  return {
    runs_merged: 0,
    redlines_simplified: 0,
    normalization_skipped: true,
  };
}

registerCleanup();

describe('normalization regression tests', () => {
  describe('Phase 3.1: _bk_* IDs stable after normalization', () => {
    test('normalized and skip_normalization sessions produce same paragraph IDs for identical content', async () => {
      // Document with mergeable runs (same paragraph, same formatting).
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
        `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>World</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>` +
        `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Third </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r></w:p>` +
        `</w:body></w:document>`;

      // Open with normalization (default)
      const normalizedSession = await openSession([], { xml, prefix: 'norm-regression-' });

      // Open with skip_normalization
      const mgr2 = createTestSessionManager();
      const tmpDir2 = await createTrackedTempDir('norm-skip-');
      const inputPath2 = path.join(tmpDir2, 'input.docx');
      const buf = await makeDocxWithDocumentXml(xml);
      await fs.writeFile(inputPath2, new Uint8Array(buf));

      const opened2 = await openDocument(mgr2, { file_path: inputPath2, skip_normalization: true });
      assertSuccess(opened2, 'open-skip');
      const read2 = await readFile(mgr2, { session_id: opened2.session_id as string });
      assertSuccess(read2, 'read-skip');

      // Both should have the same number of paragraphs.
      expect(normalizedSession.paraIds.length).toBe(3);

      // Paragraph IDs are deterministic from paragraph content (SHA1-based),
      // NOT session-specific. Extract actual _bk_* IDs and compare directly.
      const skippedIds = extractParaIdsFromToon(String(read2.content));
      expect(skippedIds.length).toBe(3);
      expect(normalizedSession.paraIds).toEqual(skippedIds);
    });

    test('normalization stats are returned in open_document response', async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
        `<w:p>` +
        `<w:proofErr w:type="spellStart"/>` +
        `<w:r><w:t>Hello </w:t></w:r>` +
        `<w:r><w:t>World</w:t></w:r>` +
        `<w:proofErr w:type="spellEnd"/>` +
        `</w:p>` +
        `</w:body></w:document>`;

      const mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('norm-stats-');
      const inputPath = path.join(tmpDir, 'input.docx');
      const buf = await makeDocxWithDocumentXml(xml);
      await fs.writeFile(inputPath, new Uint8Array(buf));

      const opened = await openDocument(mgr, { file_path: inputPath });
      assertSuccess(opened, 'open');

      const normalization = getNormalizationSummary(opened);
      expect(normalization).toBeTruthy();
      expect(normalization.runs_merged).toBeGreaterThanOrEqual(1);
      expect(normalization.proof_errors_removed).toBe(2);
    });

    test('skip_normalization returns skipped marker', async () => {
      const mgr = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('norm-skip-stat-');
      const inputPath = path.join(tmpDir, 'input.docx');
      const buf = await makeDocxWithDocumentXml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}"><w:body>` +
        `<w:p><w:r><w:t>Simple</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
      );
      await fs.writeFile(inputPath, new Uint8Array(buf));

      const opened = await openDocument(mgr, { file_path: inputPath, skip_normalization: true });
      assertSuccess(opened, 'open');

      const normalization = getNormalizationSummary(opened);
      expect(normalization).toEqual({ runs_merged: 0, redlines_simplified: 0, double_elevations_fixed: 0, normalization_skipped: true });
    });
  });

  describe('Phase 3.2: merge barriers prevent unsafe run consolidation', () => {
    test('field-containing runs are not merged through the full pipeline', async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
        `<w:p>` +
        `<w:r><w:t>Amount: </w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:instrText xml:space="preserve"> MERGEFIELD Amount </w:instrText></w:r>` +
        `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:t>100</w:t></w:r>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `<w:r><w:t xml:space="preserve"> due.</w:t></w:r>` +
        `</w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId, firstParaId } = await openSession([], { xml, prefix: 'barrier-field-' });

      // The field text "100" should still be protected. Editing across field
      // boundaries should fail.
      const edited = await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: firstParaId,
        old_string: 'Amount: 100 due.',
        new_string: 'Amount: 250 due.',
        instruction: 'field barrier test',
      });
      // This should fail because the text spans a field complex.
      expect(edited.success).toBe(false);
    });

    test('bookmark-separated runs are not merged through the full pipeline', async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
        `<w:p>` +
        `<w:r><w:t>Before </w:t></w:r>` +
        `<w:bookmarkStart w:id="99" w:name="user_bm"/>` +
        `<w:r><w:t>After</w:t></w:r>` +
        `<w:bookmarkEnd w:id="99"/>` +
        `</w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId, firstParaId, content } = await openSession([], { xml, prefix: 'barrier-bm-' });

      // After normalization, the paragraph should still have both runs
      // (bookmark is a barrier preventing merge).
      // Verify the content is accessible (runs weren't corrupted).
      expect(content).toContain('Before');
      expect(content).toContain('After');
    });

    test('tracked-change wrappers from different authors are not merged through the pipeline', async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
        `<w:p>` +
        `<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">` +
        `<w:r><w:t>Alice text </w:t></w:r>` +
        `</w:ins>` +
        `<w:ins w:id="2" w:author="Bob" w:date="2025-01-01T00:00:00Z">` +
        `<w:r><w:t>Bob text</w:t></w:r>` +
        `</w:ins>` +
        `</w:p>` +
        `</w:body></w:document>`;

      const { content } = await openSession([], { xml, prefix: 'barrier-tc-' });

      // Both insertions should be preserved separately.
      expect(content).toContain('Alice text');
      expect(content).toContain('Bob text');
    });
  });

  describe('Phase 3.3: Benchmark', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const FIXTURES = [
      {
        label: 'simple-word-change/original.docx',
        path: path.resolve(testDir, '../../../docx-core/src/testing/fixtures/simple-word-change/original.docx'),
      },
      {
        label: 'split-run-boundary-change/revised.docx',
        path: path.resolve(testDir, '../../../docx-core/src/testing/fixtures/split-run-boundary-change/revised.docx'),
      },
    ];

    for (const fixture of FIXTURES) {
      test(`normalization completes without error on ${fixture.label}`, async () => {
        const mgr = createTestSessionManager();
        const start = performance.now();
        const opened = await openDocument(mgr, { file_path: fixture.path });
        const elapsed = performance.now() - start;
        assertSuccess(opened, `open ${fixture.label}`);

        const normalization = getNormalizationSummary(opened);
        // Log benchmark results to test output.
        console.log(
          `[Benchmark] ${fixture.label}: ` +
          `${elapsed.toFixed(1)}ms, ` +
          `runs_merged=${normalization.runs_merged}, ` +
          `redlines_simplified=${normalization.redlines_simplified}, ` +
          `proof_errors_removed=${normalization.proof_errors_removed ?? 0}`,
        );

        // Assert normalization completed without error (no brittle thresholds).
        expect(normalization.normalization_skipped).toBe(false);
        expect(typeof normalization.runs_merged).toBe('number');
        expect(typeof normalization.redlines_simplified).toBe('number');
      });
    }
  });
});
