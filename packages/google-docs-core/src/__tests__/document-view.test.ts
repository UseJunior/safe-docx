import { describe, it, expect } from 'vitest';
import { buildDocumentViewNodes } from '../document-view.js';
import type { CachedParagraph } from '../types.js';

describe('Document View Builder', () => {
  it('builds nodes from simple paragraphs', () => {
    const paragraphs: CachedParagraph[] = [
      {
        paragraphId: 'p1',
        anchorName: '_bk_000000000001',
        anchorId: 'tab1:_bk_000000000001',
        startIndex: 1,
        endIndex: 12,
        tabId: 'tab1',
        text: 'Hello World',
        inTable: false,
      },
    ];

    const nodes = buildDocumentViewNodes(paragraphs);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('tab1:_bk_000000000001');
    expect(nodes[0].text).toBe('Hello World');
    expect(nodes[0].clean_text).toBe('Hello World');
    expect(nodes[0].style).toBe('body');
    expect(nodes[0].table_context).toBeUndefined();
  });

  it('builds nodes with table context', () => {
    const paragraphs: CachedParagraph[] = [
      {
        paragraphId: 'p2',
        anchorName: '_bk_000000000002',
        anchorId: 'tab1:_bk_000000000002',
        startIndex: 20,
        endIndex: 30,
        tabId: 'tab1',
        text: 'Cell A1',
        inTable: true,
        tableMetadata: {
          tableStartIndex: 15,
          tableIndex: 0,
          tableId: '_tbl_0',
          rowIndex: 0,
          colIndex: 0,
          totalRows: 3,
          totalCols: 2,
          isHeaderRow: true,
          paraInCell: 0,
          cellParaCount: 1,
          colHeader: 'Name',
        },
      },
    ];

    const nodes = buildDocumentViewNodes(paragraphs);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].style).toBe('th(0,0)');
    expect(nodes[0].table_context).toBeDefined();
    expect(nodes[0].table_context!.table_id).toBe('_tbl_0');
    expect(nodes[0].table_context!.is_header_row).toBe(true);
    expect(nodes[0].table_context!.col_header).toBe('Name');
  });

  it('uses td style for non-header table rows', () => {
    const paragraphs: CachedParagraph[] = [
      {
        paragraphId: 'p3',
        anchorName: '_bk_000000000003',
        anchorId: '_bk_000000000003',
        startIndex: 40,
        endIndex: 50,
        tabId: 'tab1',
        text: 'Data value',
        inTable: true,
        tableMetadata: {
          tableStartIndex: 15,
          tableIndex: 0,
          tableId: '_tbl_0',
          rowIndex: 1,
          colIndex: 0,
          totalRows: 3,
          totalCols: 2,
          isHeaderRow: false,
          paraInCell: 0,
          cellParaCount: 1,
          colHeader: 'Name',
        },
      },
    ];

    const nodes = buildDocumentViewNodes(paragraphs);
    expect(nodes[0].style).toBe('td(1,0)');
  });

  it('sets default metadata for non-table paragraphs', () => {
    const paragraphs: CachedParagraph[] = [
      {
        paragraphId: 'p4',
        anchorName: '_bk_000000000004',
        anchorId: '_bk_000000000004',
        startIndex: 1,
        endIndex: 5,
        tabId: 'tab1',
        text: 'Test',
        inTable: false,
      },
    ];

    const nodes = buildDocumentViewNodes(paragraphs);
    expect(nodes[0].list_metadata.list_level).toBe(-1);
    expect(nodes[0].paragraph_alignment).toBe('LEFT');
    expect(nodes[0].numbering.num_id).toBeNull();
  });

  it('handles paragraphs without bookmark IDs', () => {
    const paragraphs: CachedParagraph[] = [
      {
        paragraphId: 'p5',
        anchorName: null,
        anchorId: '',
        startIndex: 100,
        endIndex: 110,
        tabId: 'tab1',
        text: 'Unanchored',
        inTable: false,
      },
    ];

    const nodes = buildDocumentViewNodes(paragraphs);
    expect(nodes[0].id).toBe('para_100'); // Fallback ID
  });
});
