/**
 * Live E2E tests for Google Docs integration (~35 tests, 8 phases).
 *
 * These tests require:
 *   GOOGLE_SERVICE_ACCOUNT_KEY — path to SA JSON key file
 *   GOOGLE_IMPERSONATE_USER   — email for domain-wide delegation (e.g. junior@usejunior.com)
 *
 * If GOOGLE_SERVICE_ACCOUNT_KEY is not set, the entire suite is skipped.
 * If GOOGLE_TEST_DOC_ID is set, that doc is used instead of creating ephemeral ones.
 *
 * Two-document isolation:
 *   baselineDoc — read-only + anchor injection (Phases A, B, F)
 *   mutableDoc  — all mutations (Phases C, D, E, G, H)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GoogleDocsDocument } from '../../document.js';
import { buildDocumentViewNodes } from '../../document-view.js';
import {
  isInternalAnchor,
  extractExistingAnchors,
  buildAnchorCleanupRequests,
} from '../../anchors.js';
import { mapGoogleError } from '../../errors.js';
import { IndexTracker } from '../../index-tracker.js';
import {
  buildBatchUpdateRequests,
  buildParagraphStyleRequest,
  type EditOperation,
} from '../../write-operations.js';
import {
  shouldRunE2E,
  buildCredentialsFromEnv,
  createRichTestDoc,
  deleteTestDoc,
  RICH_DOC_CONTENT,
  getRawParagraphStyle,
  type TestDocContext,
} from './test-doc-helper.js';
import type { CachedParagraph } from '../../types.js';

/** Filter paragraphs in the multi-paragraph cell (row 2, col 2 — "Notes" column, last data row) */
function getMultiParaCellParagraphs(paras: CachedParagraph[]) {
  return paras.filter(
    p => p.tableMetadata?.rowIndex === 2 && p.tableMetadata?.colIndex === 2,
  );
}

const RUN = shouldRunE2E();

describe.skipIf(!RUN)('Google Docs E2E', { timeout: 180_000 }, () => {
  let baselineCtx: TestDocContext;
  let mutableCtx: TestDocContext;
  let baselineDoc: GoogleDocsDocument;
  let mutableDoc: GoogleDocsDocument;

  beforeAll(async () => {
    const creds = buildCredentialsFromEnv();
    [baselineCtx, mutableCtx] = await Promise.all([
      createRichTestDoc(creds, 'safe-docx E2E baseline'),
      createRichTestDoc(creds, 'safe-docx E2E mutable'),
    ]);
    console.log(`[E2E] Baseline: https://docs.google.com/document/d/${baselineCtx.docId}/edit`);
    console.log(`[E2E] Mutable:  https://docs.google.com/document/d/${mutableCtx.docId}/edit`);
  });

  afterAll(async () => {
    const deletions: Promise<void>[] = [];
    if (baselineCtx) deletions.push(deleteTestDoc(baselineCtx));
    if (mutableCtx) deletions.push(deleteTestDoc(mutableCtx));
    await Promise.all(deletions);
  });

  // ── Phase A: Document structure — read-only ─────────────────────────

  describe('Phase A: Document structure', () => {
    it('A1: Auth + load document', async () => {
      baselineDoc = await GoogleDocsDocument.load(baselineCtx.docId, baselineCtx.credentials);
      expect(baselineDoc.getDocId()).toBe(baselineCtx.docId);
      expect(baselineDoc.getRevisionId()).toBeTruthy();
    });

    it('A2: Body paragraphs (exact text)', () => {
      const { body, afterTable } = RICH_DOC_CONTENT;
      const paras = baselineDoc.getParagraphs();
      const bodyParas = paras.filter(p => !p.inTable);
      expect(bodyParas.length).toBeGreaterThanOrEqual(5);
      expect(bodyParas[0].text).toBe(body.paragraphOne);
      expect(bodyParas[1].text).toBe(body.paragraphTwo);
      expect(bodyParas[2].text).toBe(body.paragraphThreeEmoji);
      expect(bodyParas[3].text).toBe(body.paragraphFourCjk);
      const afterTablePara = bodyParas.find(p => p.text === afterTable);
      expect(afterTablePara).toBeDefined();
    });

    it('A3: Table header row content', () => {
      const { header } = RICH_DOC_CONTENT.table;
      const paras = baselineDoc.getParagraphs();
      const headerParas = paras.filter(p => p.tableMetadata?.isHeaderRow);
      expect(headerParas.length).toBe(3);
      const headerTexts = headerParas.map(p => p.text);
      expect(headerTexts).toContain(header.name);
      expect(headerTexts).toContain(header.value);
      expect(headerTexts).toContain(header.notes);
    });

    it('A4: Table data row content', () => {
      const { row1, row2 } = RICH_DOC_CONTENT.table;
      const paras = baselineDoc.getParagraphs();
      const dataParas = paras.filter(p => p.inTable && !p.tableMetadata?.isHeaderRow);
      const dataTexts = dataParas.map(p => p.text);
      expect(dataTexts).toContain(row1.name);
      expect(dataTexts).toContain(row1.value);
      expect(dataTexts).toContain(row2.name);
      expect(dataTexts).toContain(row2.value);
      expect(dataTexts).toContain(row1.notes);
    });

    it('A5: Table metadata completeness', () => {
      const paras = baselineDoc.getParagraphs();
      const tableParas = paras.filter(p => p.inTable);
      // 9 cells, but one cell (row 2, col 2) has 2 paragraphs → 10 total
      expect(tableParas.length).toBeGreaterThanOrEqual(10);

      for (const p of tableParas) {
        expect(p.tableMetadata).toBeDefined();
        expect(p.tableMetadata!.tableId).toBeTruthy();
        expect(p.tableMetadata!.totalRows).toBe(3);
        expect(p.tableMetadata!.totalCols).toBe(3);
        expect(typeof p.tableMetadata!.rowIndex).toBe('number');
        expect(typeof p.tableMetadata!.colIndex).toBe('number');
        expect(typeof p.tableMetadata!.isHeaderRow).toBe('boolean');
        expect(typeof p.tableMetadata!.paraInCell).toBe('number');
        expect(typeof p.tableMetadata!.cellParaCount).toBe('number');
        expect(typeof p.tableMetadata!.colHeader).toBe('string');
      }
    });

    it('A6: Multi-paragraph cell metadata', () => {
      const [lineOne, lineTwo] = RICH_DOC_CONTENT.multiCellTexts;
      const paras = baselineDoc.getParagraphs();
      const multiCellParas = getMultiParaCellParagraphs(paras);
      expect(multiCellParas.length).toBe(2);
      expect(multiCellParas[0].tableMetadata!.cellParaCount).toBe(2);
      expect(multiCellParas[0].tableMetadata!.paraInCell).toBe(0);
      expect(multiCellParas[1].tableMetadata!.paraInCell).toBe(1);
      expect(multiCellParas[0].text).toBe(lineOne);
      expect(multiCellParas[1].text).toBe(lineTwo);
    });

    it('A7: Document view — th/td styles + table_context', () => {
      const paras = baselineDoc.getParagraphs();
      const nodes = buildDocumentViewNodes(paras);

      // Body paragraphs have style 'body'
      const bodyNodes = nodes.filter(n => n.style === 'body');
      expect(bodyNodes.length).toBeGreaterThanOrEqual(5);
      expect(bodyNodes[0].text).toBe(RICH_DOC_CONTENT.body.paragraphOne);

      // Header cells → th(0,N)
      const thNodes = nodes.filter(n => n.style.startsWith('th('));
      expect(thNodes.length).toBe(3);
      expect(thNodes.map(n => n.style)).toContain('th(0,0)');
      expect(thNodes.map(n => n.style)).toContain('th(0,1)');
      expect(thNodes.map(n => n.style)).toContain('th(0,2)');

      // Data cells → td(R,C)
      const tdNodes = nodes.filter(n => n.style.startsWith('td('));
      expect(tdNodes.length).toBeGreaterThanOrEqual(7);

      // All table nodes have table_context populated
      const tableNodes = nodes.filter(n => n.table_context);
      for (const n of tableNodes) {
        expect(n.table_context!.table_id).toBeTruthy();
        expect(typeof n.table_context!.total_rows).toBe('number');
        expect(typeof n.table_context!.total_cols).toBe('number');
        expect(typeof n.table_context!.para_in_cell).toBe('number');
        expect(typeof n.table_context!.cell_para_count).toBe('number');
      }
    });
  });

  // ── Phase B: Anchor injection ───────────────────────────────────────

  describe('Phase B: Anchor injection', () => {
    it('B8: Inject anchors — all paragraphs', async () => {
      const result = await baselineDoc.injectAnchors();
      expect(result.injectedCount).toBeGreaterThan(0);
      const paras = baselineDoc.getParagraphs();
      const anchored = paras.filter(p => p.anchorName);
      expect(anchored.length).toBe(paras.length);
    });

    it('B9: Table cell paragraphs have anchors', () => {
      const paras = baselineDoc.getParagraphs();
      const tableParas = paras.filter(p => p.inTable);
      for (const p of tableParas) {
        expect(p.anchorName).toBeTruthy();
        expect(isInternalAnchor(p.anchorName!)).toBe(true);
      }
    });

    it('B10: Multi-paragraph cell anchors are distinct', () => {
      const paras = baselineDoc.getParagraphs();
      const multiCellParas = getMultiParaCellParagraphs(paras);
      expect(multiCellParas.length).toBe(2);
      expect(multiCellParas[0].anchorName).toBeTruthy();
      expect(multiCellParas[1].anchorName).toBeTruthy();
      expect(multiCellParas[0].anchorName).not.toBe(multiCellParas[1].anchorName);
    });

    it('B11: Anchors survive re-fetch', async () => {
      await baselineDoc.fetchDocument();
      const paras = baselineDoc.getParagraphs();
      const anchored = paras.filter(p => p.anchorName);
      expect(anchored.length).toBe(paras.length);
      for (const p of anchored) {
        expect(isInternalAnchor(p.anchorName!)).toBe(true);
      }
    });

    it('B12: Anchors survive fresh load', async () => {
      const freshDoc = await GoogleDocsDocument.load(baselineCtx.docId, baselineCtx.credentials);
      const paras = freshDoc.getParagraphs();
      const anchored = paras.filter(p => p.anchorName);
      expect(anchored.length).toBe(paras.length);
    });

    it('B13: Read by anchor ID (body + table cell)', () => {
      const paras = baselineDoc.getParagraphs();

      // Body paragraph
      const bodyPara = paras.find(p => !p.inTable && p.text === RICH_DOC_CONTENT.body.paragraphOne);
      expect(bodyPara).toBeDefined();
      expect(baselineDoc.getParagraphTextById(bodyPara!.anchorId)).toBe(RICH_DOC_CONTENT.body.paragraphOne);

      // Table cell paragraph
      const cellPara = paras.find(p => p.inTable && p.text === 'Alpha');
      expect(cellPara).toBeDefined();
      expect(baselineDoc.getParagraphTextById(cellPara!.anchorId)).toBe('Alpha');
    });
  });

  // ── Phase C: Text operations — body ─────────────────────────────────

  describe('Phase C: Text operations — body', () => {
    beforeAll(async () => {
      mutableDoc = await GoogleDocsDocument.load(mutableCtx.docId, mutableCtx.credentials);
      await mutableDoc.injectAnchors();
    });

    it('C14: Replace text (same length)', async () => {
      const paras = mutableDoc.getParagraphs();
      const target = paras.find(p => p.text === 'Paragraph one');
      expect(target).toBeDefined();

      await mutableDoc.replaceText(target!.anchorId, 'one', 'ONE');
      expect(mutableDoc.getParagraphTextById(target!.anchorId)).toBe('Paragraph ONE');
    });

    it('C15: Replace with longer text', async () => {
      const paras = mutableDoc.getParagraphs();
      const target = paras.find(p => p.text === 'Paragraph two');
      expect(target).toBeDefined();

      await mutableDoc.replaceText(target!.anchorId, 'two', 'TWO EXTENDED');
      expect(mutableDoc.getParagraphTextById(target!.anchorId)).toBe('Paragraph TWO EXTENDED');
    });

    it('C16: Replace text adjacent to emoji', async () => {
      const paras = mutableDoc.getParagraphs();
      const target = paras.find(p => p.text.includes('🎉'));
      expect(target).toBeDefined();

      await mutableDoc.replaceText(target!.anchorId, 'sparkles', 'SPARKLES');
      const updated = mutableDoc.getParagraphTextById(target!.anchorId);
      expect(updated).toContain('🎉');
      expect(updated).toContain('SPARKLES');
    });

    it('C17: Insert paragraph AFTER', async () => {
      const paras = mutableDoc.getParagraphs();
      const target = paras.find(p => p.text === 'Paragraph ONE');
      expect(target).toBeDefined();

      const { newAnchorId } = await mutableDoc.insertParagraph(
        target!.anchorId, 'AFTER', 'Inserted AFTER one',
      );
      expect(newAnchorId).toBeTruthy();
      expect(mutableDoc.getParagraphTextById(newAnchorId)).toBe('Inserted AFTER one');
    });

    it('C18: Insert paragraph BEFORE', async () => {
      const paras = mutableDoc.getParagraphs();
      const target = paras.find(p => p.text === 'Paragraph TWO EXTENDED');
      expect(target).toBeDefined();

      const { newAnchorId } = await mutableDoc.insertParagraph(
        target!.anchorId, 'BEFORE', 'Inserted BEFORE two',
      );
      expect(newAnchorId).toBeTruthy();
      expect(mutableDoc.getParagraphTextById(newAnchorId)).toBe('Inserted BEFORE two');
    });

    it('C19: Anchor survives paragraph insertion before it', () => {
      const paras = mutableDoc.getParagraphs();
      const original = paras.find(p => p.text === 'Paragraph TWO EXTENDED');
      expect(original).toBeDefined();
      expect(original!.anchorId).toBeTruthy();
      expect(mutableDoc.getParagraphTextById(original!.anchorId)).toBe('Paragraph TWO EXTENDED');
    });
  });

  // ── Phase D: Text operations — table cells ──────────────────────────

  describe('Phase D: Text operations — table cells', () => {
    it('D20: Replace text in table cell', async () => {
      const paras = mutableDoc.getParagraphs();
      const target = paras.find(p => p.inTable && p.text === 'Alpha');
      expect(target).toBeDefined();

      await mutableDoc.replaceText(target!.anchorId, 'Alpha', 'ALPHA');
      // When replacing the entire cell content, the named range anchor at
      // startIndex may be destroyed (falls within the deleted range).
      // Verify replacement via text search.
      const updated = mutableDoc.getParagraphs();
      expect(updated.find(p => p.inTable && p.text === 'ALPHA')).toBeDefined();
    });

    it('D21: Insert paragraph in table cell', async () => {
      const paras = mutableDoc.getParagraphs();
      const target = paras.find(p => p.inTable && p.text === 'First entry');
      expect(target).toBeDefined();

      const { newAnchorId } = await mutableDoc.insertParagraph(
        target!.anchorId, 'AFTER', 'Extra cell line',
      );
      expect(newAnchorId).toBeTruthy();
      expect(mutableDoc.getParagraphTextById(newAnchorId)).toBe('Extra cell line');
    });

    it('D22: Table cell anchor stable after insert', () => {
      // "First entry" cell had a paragraph inserted AFTER it in D21.
      // Its own anchor should survive since the insert didn't overlap the anchor range.
      const paras = mutableDoc.getParagraphs();
      const target = paras.find(p => p.inTable && p.text === 'First entry');
      expect(target).toBeDefined();
      expect(target!.anchorId).toBeTruthy();
      expect(mutableDoc.getParagraphTextById(target!.anchorId)).toBe('First entry');
    });
  });

  // ── Phase E: Paragraph styling ──────────────────────────────────────

  describe('Phase E: Paragraph styling', () => {
    it('E23: Apply CENTER alignment — verify via raw API', async () => {
      const paras = mutableDoc.getParagraphs();
      const target = paras.find(p => p.text === 'Paragraph ONE');
      expect(target).toBeDefined();

      const request = buildParagraphStyleRequest(
        target!.startIndex, target!.endIndex,
        { alignment: 'CENTER' },
        target!.tabId,
      );
      await mutableDoc.executeBatchUpdate([request]);
      mutableDoc.markEdited();
      await mutableDoc.fetchDocument();

      const style = await getRawParagraphStyle(mutableDoc, mutableCtx.docId, 'Paragraph ONE');
      expect(style).not.toBeNull();
      expect(style!.alignment).toBe('CENTER');
    });

    it('E24: Apply first-line indent — verify via raw API', async () => {
      const paras = mutableDoc.getParagraphs();
      const target = paras.find(p => p.text === 'Paragraph ONE');
      expect(target).toBeDefined();

      const request = buildParagraphStyleRequest(
        target!.startIndex, target!.endIndex,
        { indentFirstLine: 36 },
        target!.tabId,
      );
      await mutableDoc.executeBatchUpdate([request]);
      mutableDoc.markEdited();
      await mutableDoc.fetchDocument();

      const style = await getRawParagraphStyle(mutableDoc, mutableCtx.docId, 'Paragraph ONE');
      expect(style).not.toBeNull();
      expect((style as any).indentFirstLine?.magnitude).toBe(36);
    });
  });

  // ── Phase F: UTF-16 & index math ────────────────────────────────────

  describe('Phase F: UTF-16 & index math', () => {
    it('F25: Emoji surrogate pair accounting', () => {
      const paras = baselineDoc.getParagraphs();
      const emojiPara = paras.find(p => p.text.includes('🎉'));
      expect(emojiPara).toBeDefined();

      const text = emojiPara!.text;
      const surrogates = IndexTracker.countSurrogatePairs(text);
      // 🎉 (U+1F389) is a surrogate pair; ✨ (U+2728) is BMP — only 1 surrogate pair
      expect(surrogates).toBe(1);

      // endIndex - startIndex = text.length + 1 (the stripped trailing \n)
      // Both JS and Google Docs count UTF-16 code units, so they agree
      expect(emojiPara!.endIndex - emojiPara!.startIndex).toBe(text.length + 1);
    });

    it('F26: CJK BMP character indices', () => {
      const paras = baselineDoc.getParagraphs();
      const cjkPara = paras.find(p => p.text.includes('日本語'));
      expect(cjkPara).toBeDefined();

      const text = cjkPara!.text;
      // CJK characters are in the BMP — 1 UTF-16 code unit each
      expect(IndexTracker.countSurrogatePairs(text)).toBe(0);

      // endIndex - startIndex = text.length + 1 (trailing \n)
      expect(cjkPara!.endIndex - cjkPara!.startIndex).toBe(text.length + 1);
    });

    it('F27: buildBatchUpdateRequests reverse order', () => {
      const edits: EditOperation[] = [
        { type: 'insert', startIndex: 10, text: 'first' },
        { type: 'insert', startIndex: 50, text: 'second' },
        { type: 'insert', startIndex: 30, text: 'third' },
      ];
      const requests = buildBatchUpdateRequests(edits);
      // Should be sorted descending by startIndex: 50, 30, 10
      const indices = requests.map(r => (r.insertText?.location as any)?.index);
      expect(indices).toEqual([50, 30, 10]);
    });
  });

  // ── Phase G: Error handling ─────────────────────────────────────────

  describe('Phase G: Error handling', () => {
    it('G28: replaceText — TEXT_NOT_FOUND', async () => {
      const paras = mutableDoc.getParagraphs();
      const target = paras.find(p => p.anchorId);
      expect(target).toBeDefined();

      await expect(
        mutableDoc.replaceText(target!.anchorId, 'NONEXISTENT_TEXT_xyz123', 'whatever'),
      ).rejects.toThrow('TEXT_NOT_FOUND');
    });

    it('G29: replaceText — ANCHOR_NOT_FOUND', async () => {
      await expect(
        mutableDoc.replaceText('fake_anchor_id_xyz123', 'text', 'replacement'),
      ).rejects.toThrow('ANCHOR_NOT_FOUND');
    });

    it('G30: Load invalid docId → NOT_FOUND', async () => {
      try {
        await GoogleDocsDocument.load('nonexistent_doc_id_12345', baselineCtx.credentials);
        expect.unreachable('Should have thrown');
      } catch (err) {
        const mapped = mapGoogleError(err);
        expect(mapped.code).toBe('NOT_FOUND');
      }
    });
  });

  // ── Phase H: Concurrency, metadata & cleanup ───────────────────────

  describe('Phase H: Concurrency, metadata & cleanup', () => {
    it('H31: Revision is fresh after load', () => {
      expect(mutableDoc.isRevisionFresh()).toBe(true);
    });

    it('H32: Revision changes after edit', async () => {
      const rev1 = mutableDoc.getRevisionId();
      expect(rev1).toBeTruthy();

      // Make a tiny edit
      const paras = mutableDoc.getParagraphs();
      const target = paras.find(p => !p.inTable && p.anchorId);
      expect(target).toBeDefined();

      await mutableDoc.executeBatchUpdate([{
        insertText: {
          location: {
            index: target!.endIndex - 1,
            ...(target!.tabId ? { tabId: target!.tabId } : {}),
          } as any,
          text: '.',
        },
      }]);
      await mutableDoc.fetchDocument();

      const rev2 = mutableDoc.getRevisionId();
      expect(rev2).not.toBe(rev1);
    });

    it('H33: Edit count increments', () => {
      const before = mutableDoc.getEditCount();
      mutableDoc.markEdited();
      expect(mutableDoc.getEditCount()).toBe(before + 1);
    });

    it('H34: Cleanup all _bk_ anchors', async () => {
      const client = mutableDoc.getClient();
      const response = await client.getDocument(mutableCtx.docId);

      const existing = extractExistingAnchors(response);
      expect(existing.size).toBeGreaterThan(0);

      const requests = buildAnchorCleanupRequests([...existing.keys()]);
      await mutableDoc.executeBatchUpdate(requests);
      await mutableDoc.fetchDocument();

      // Verify all gone
      const response2 = await client.getDocument(mutableCtx.docId);
      const remaining = extractExistingAnchors(response2);
      expect(remaining.size).toBe(0);
    });

    it('H35: Re-inject after cleanup', async () => {
      const result = await mutableDoc.injectAnchors();
      expect(result.injectedCount).toBeGreaterThan(0);

      const paras = mutableDoc.getParagraphs();
      const anchored = paras.filter(p => p.anchorName);
      expect(anchored.length).toBe(paras.length);
    });
  });
});
