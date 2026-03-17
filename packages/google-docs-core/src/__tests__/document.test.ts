import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth.js', () => ({
  resolveCredentials: vi.fn(),
}));

import { resolveCredentials } from '../auth.js';
import { GoogleDocsDocument } from '../document.js';
import type { GoogleApiClient } from '../api-client.js';

const mockResolveCredentials = vi.mocked(resolveCredentials);

/** Build a minimal mock Google Docs API document response */
function buildMockDocument(
  bodyContent: unknown[],
  namedRanges: Record<string, unknown> = {},
) {
  return {
    revisionId: 'test-rev-1',
    tabs: [{
      tabProperties: { tabId: 't.0', title: 'Tab 1' },
      documentTab: {
        body: { content: bodyContent },
        namedRanges,
      },
    }],
  };
}

/** Build a mock GoogleApiClient from a canned document response */
function buildMockClient(docResponse: unknown) {
  const batchUpdateFn = vi.fn().mockResolvedValue({
    replies: [], writeControl: { requiredRevisionId: 'test-rev-2' },
  });
  const getDocumentFn = vi.fn().mockResolvedValue(docResponse);
  const client = {
    getDocument: getDocumentFn,
    batchUpdate: batchUpdateFn,
    createFile: vi.fn(),
    deleteFile: vi.fn(),
    shareFile: vi.fn(),
    exportAsDocx: vi.fn(),
  } as unknown as GoogleApiClient;
  return { client, getDocumentFn, batchUpdateFn };
}

describe('GoogleDocsDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Bug fix: paraInCell always 0 ────────────────────────────────────

  describe('paraInCell counter', () => {
    it('increments paraInCell for multi-paragraph table cells', async () => {
      const docResponse = buildMockDocument([
        {
          paragraph: {
            elements: [{ textRun: { content: 'Body\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
          startIndex: 0,
          endIndex: 5,
        },
        {
          table: {
            rows: 1,
            columns: 1,
            tableRows: [{
              tableCells: [{
                content: [
                  {
                    paragraph: {
                      elements: [{ textRun: { content: 'Line 1\n' } }],
                      paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
                    },
                    startIndex: 7,
                    endIndex: 14,
                  },
                  {
                    paragraph: {
                      elements: [{ textRun: { content: 'Line 2\n' } }],
                      paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
                    },
                    startIndex: 14,
                    endIndex: 21,
                  },
                  {
                    paragraph: {
                      elements: [{ textRun: { content: 'Line 3\n' } }],
                      paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
                    },
                    startIndex: 21,
                    endIndex: 28,
                  },
                ],
              }],
            }],
          },
          startIndex: 5,
          endIndex: 30,
        },
      ]);

      const { client } = buildMockClient(docResponse);
      mockResolveCredentials.mockResolvedValue(client);

      const doc = await GoogleDocsDocument.load('test-doc-id');
      const tableParas = doc.getParagraphs().filter(p => p.inTable);

      expect(tableParas).toHaveLength(3);
      expect(tableParas[0].text).toBe('Line 1');
      expect(tableParas[0].tableMetadata!.paraInCell).toBe(0);
      expect(tableParas[1].text).toBe('Line 2');
      expect(tableParas[1].tableMetadata!.paraInCell).toBe(1);
      expect(tableParas[2].text).toBe('Line 3');
      expect(tableParas[2].tableMetadata!.paraInCell).toBe(2);
    });

    it('resets paraInCell counter between cells', async () => {
      const docResponse = buildMockDocument([
        {
          table: {
            rows: 1,
            columns: 2,
            tableRows: [{
              tableCells: [
                {
                  content: [
                    {
                      paragraph: {
                        elements: [{ textRun: { content: 'C0P0\n' } }],
                        paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
                      },
                      startIndex: 3,
                      endIndex: 8,
                    },
                    {
                      paragraph: {
                        elements: [{ textRun: { content: 'C0P1\n' } }],
                        paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
                      },
                      startIndex: 8,
                      endIndex: 13,
                    },
                  ],
                },
                {
                  content: [
                    {
                      paragraph: {
                        elements: [{ textRun: { content: 'C1P0\n' } }],
                        paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
                      },
                      startIndex: 15,
                      endIndex: 20,
                    },
                  ],
                },
              ],
            }],
          },
          startIndex: 1,
          endIndex: 22,
        },
      ]);

      const { client } = buildMockClient(docResponse);
      mockResolveCredentials.mockResolvedValue(client);

      const doc = await GoogleDocsDocument.load('test-doc-id');
      const tableParas = doc.getParagraphs().filter(p => p.inTable);

      expect(tableParas).toHaveLength(3);
      // Cell 0: paraInCell 0, 1
      expect(tableParas[0].tableMetadata!.colIndex).toBe(0);
      expect(tableParas[0].tableMetadata!.paraInCell).toBe(0);
      expect(tableParas[1].tableMetadata!.colIndex).toBe(0);
      expect(tableParas[1].tableMetadata!.paraInCell).toBe(1);
      // Cell 1: paraInCell resets to 0
      expect(tableParas[2].tableMetadata!.colIndex).toBe(1);
      expect(tableParas[2].tableMetadata!.paraInCell).toBe(0);
    });

    it('tracks cellParaCount correctly', async () => {
      const docResponse = buildMockDocument([
        {
          table: {
            rows: 1,
            columns: 1,
            tableRows: [{
              tableCells: [{
                content: [
                  {
                    paragraph: {
                      elements: [{ textRun: { content: 'A\n' } }],
                      paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
                    },
                    startIndex: 3,
                    endIndex: 5,
                  },
                  {
                    paragraph: {
                      elements: [{ textRun: { content: 'B\n' } }],
                      paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
                    },
                    startIndex: 5,
                    endIndex: 7,
                  },
                ],
              }],
            }],
          },
          startIndex: 1,
          endIndex: 9,
        },
      ]);

      const { client } = buildMockClient(docResponse);
      mockResolveCredentials.mockResolvedValue(client);

      const doc = await GoogleDocsDocument.load('test-doc-id');
      const tableParas = doc.getParagraphs().filter(p => p.inTable);

      expect(tableParas).toHaveLength(2);
      expect(tableParas[0].tableMetadata!.cellParaCount).toBe(2);
      expect(tableParas[1].tableMetadata!.cellParaCount).toBe(2);
    });
  });

  // ── Bug fix: insertParagraph AFTER used endIndex (out of bounds) ────

  describe('insertParagraph AFTER index', () => {
    it('uses endIndex - 1 for AFTER position', async () => {
      const anchorName = '_bk_000000000000';
      const namedRanges = {
        [anchorName]: {
          namedRanges: [{
            namedRangeId: 'nr1',
            name: anchorName,
            ranges: [{ startIndex: 1, endIndex: 2, tabId: 't.0' }],
          }],
        },
      };

      // Initial doc: one paragraph "Hello world" at indices 1-13
      const initialDoc = buildMockDocument([
        {
          paragraph: {
            elements: [{ textRun: { content: 'Hello world\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
          startIndex: 1,
          endIndex: 13,
        },
      ], namedRanges);

      // Post-insert doc: both paragraphs with anchors
      const postInsertAnchor = '_bk_000000000001';
      const postInsertNamedRanges = {
        ...namedRanges,
        [postInsertAnchor]: {
          namedRanges: [{
            namedRangeId: 'nr2',
            name: postInsertAnchor,
            ranges: [{ startIndex: 13, endIndex: 14, tabId: 't.0' }],
          }],
        },
      };
      const postInsertDoc = buildMockDocument([
        {
          paragraph: {
            elements: [{ textRun: { content: 'Hello world\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
          startIndex: 1,
          endIndex: 13,
        },
        {
          paragraph: {
            elements: [{ textRun: { content: 'New para\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
          startIndex: 13,
          endIndex: 22,
        },
      ], postInsertNamedRanges);

      const batchUpdateFn = vi.fn().mockResolvedValue({
        replies: [], writeControl: { requiredRevisionId: 'test-rev-2' },
      });
      const getDocumentFn = vi.fn()
        .mockResolvedValueOnce(initialDoc)
        .mockResolvedValue(postInsertDoc);

      const client = {
        getDocument: getDocumentFn,
        batchUpdate: batchUpdateFn,
        createFile: vi.fn(),
        deleteFile: vi.fn(),
        shareFile: vi.fn(),
        exportAsDocx: vi.fn(),
      } as unknown as GoogleApiClient;
      mockResolveCredentials.mockResolvedValue(client);

      const doc = await GoogleDocsDocument.load('test-doc-id');
      const paras = doc.getParagraphs();
      expect(paras[0].endIndex).toBe(13);

      await doc.insertParagraph(paras[0].anchorId, 'AFTER', 'New para');

      // The first batchUpdate should insert at endIndex - 1 = 12
      const firstCall = batchUpdateFn.mock.calls[0];
      const insertReq = firstCall[1].requests[0];
      expect(insertReq.insertText.location.index).toBe(12);
      expect(insertReq.insertText.text).toBe('\nNew para');
    });

    it('uses startIndex for BEFORE position', async () => {
      const anchorName = '_bk_000000000000';
      const namedRanges = {
        [anchorName]: {
          namedRanges: [{
            namedRangeId: 'nr1',
            name: anchorName,
            ranges: [{ startIndex: 1, endIndex: 2, tabId: 't.0' }],
          }],
        },
      };

      const initialDoc = buildMockDocument([
        {
          paragraph: {
            elements: [{ textRun: { content: 'Hello world\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
          startIndex: 1,
          endIndex: 13,
        },
      ], namedRanges);

      const postInsertAnchor = '_bk_000000000001';
      const postInsertNamedRanges = {
        [postInsertAnchor]: {
          namedRanges: [{
            namedRangeId: 'nr2',
            name: postInsertAnchor,
            ranges: [{ startIndex: 1, endIndex: 2, tabId: 't.0' }],
          }],
        },
        ...namedRanges,
      };
      const postInsertDoc = buildMockDocument([
        {
          paragraph: {
            elements: [{ textRun: { content: 'New para\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
          startIndex: 1,
          endIndex: 10,
        },
        {
          paragraph: {
            elements: [{ textRun: { content: 'Hello world\n' } }],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
          startIndex: 10,
          endIndex: 22,
        },
      ], postInsertNamedRanges);

      const batchUpdateFn = vi.fn().mockResolvedValue({
        replies: [], writeControl: { requiredRevisionId: 'test-rev-2' },
      });
      const getDocumentFn = vi.fn()
        .mockResolvedValueOnce(initialDoc)
        .mockResolvedValue(postInsertDoc);

      const client = {
        getDocument: getDocumentFn,
        batchUpdate: batchUpdateFn,
        createFile: vi.fn(),
        deleteFile: vi.fn(),
        shareFile: vi.fn(),
        exportAsDocx: vi.fn(),
      } as unknown as GoogleApiClient;
      mockResolveCredentials.mockResolvedValue(client);

      const doc = await GoogleDocsDocument.load('test-doc-id');
      const paras = doc.getParagraphs();

      await doc.insertParagraph(paras[0].anchorId, 'BEFORE', 'New para');

      // BEFORE should insert at startIndex = 1
      const firstCall = batchUpdateFn.mock.calls[0];
      const insertReq = firstCall[1].requests[0];
      expect(insertReq.insertText.location.index).toBe(1);
      expect(insertReq.insertText.text).toBe('New para\n');
    });
  });
});
