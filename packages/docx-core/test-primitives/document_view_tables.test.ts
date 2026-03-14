import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML, W } from '../src/primitives/namespaces.js';
import { insertParagraphBookmarks, getParagraphBookmarkId } from '../src/primitives/bookmarks.js';
import {
  buildNodesForDocumentView,
  renderToon,
  formatToonDataLine,
  collectTableMarkerInfo,
  formatTableMarker,
  type DocumentViewNode,
  type TableContext,
} from '../src/primitives/document_view.js';
import { isW, getDirectChildrenByName } from '../src/primitives/dom-helpers.js';
import { DocxDocument } from '../src/primitives/document.js';
import { createZipBuffer } from '../src/primitives/zip.js';

const TEST_FEATURE = 'add-table-context-to-document-view';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Document View Tables' });

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${OOXML.W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

function simpleTable(headers: string[], rows: string[][]): string {
  const headerRow = `<w:tr>${headers.map((h) => `<w:tc><w:p><w:r><w:t>${h}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`;
  const dataRows = rows
    .map(
      (row) =>
        `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t>${cell}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`,
    )
    .join('');
  return `<w:tbl>${headerRow}${dataRows}</w:tbl>`;
}

async function makeDocxDocument(bodyXml: string): Promise<DocxDocument> {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${OOXML.W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  const buf = await createZipBuffer({
    '[Content_Types].xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
    '_rels/.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
    'word/document.xml': xml,
  });
  const doc = await DocxDocument.load(buf);
  doc.insertParagraphBookmarks('test');
  return doc;
}

function buildViewNodes(bodyXml: string): DocumentViewNode[] {
  const doc = makeDoc(bodyXml);
  insertParagraphBookmarks(doc, 'test');
  const body = doc.getElementsByTagNameNS(OOXML.W_NS, W.body).item(0) as Element;
  const paragraphs = Array.from(body.getElementsByTagNameNS(OOXML.W_NS, W.p));

  // Use DocxDocument.buildDocumentView indirectly via buildNodesForDocumentView
  // But we need table context. Let's use the full DocxDocument flow instead.
  // For unit tests, we need to replicate the table context derivation.
  // Using buildNodesForDocumentView directly without table context for some tests.
  const mapped = paragraphs
    .map((p) => {
      const bkStarts = p.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkStart);
      for (let i = 0; i < bkStarts.length; i++) {
        const name = bkStarts.item(i)!.getAttribute('w:name') ?? '';
        if (name.startsWith('_bk_')) return { id: name, p };
      }
      return null;
    })
    .filter((x): x is { id: string; p: Element } => x !== null);

  const { nodes } = buildNodesForDocumentView({
    paragraphs: mapped,
    stylesXml: null,
    numberingXml: null,
  });
  return nodes;
}

// ---------------------------------------------------------------------------
// Tests: Table context via DocxDocument.buildDocumentView
// ---------------------------------------------------------------------------

describe('document_view tables', () => {
  test.openspec('SDX-TABLE-01')
    ('simple table paragraphs have correct table_context', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('a document with a 2-row × 3-column table', async () => {
      const tableXml = simpleTable(['ID', 'Title', 'Status'], [['A1', 'First', 'Open']]);
      doc = await makeDocxDocument(tableXml);
    });

    await when('buildDocumentView is called', async () => {
      const result = doc!.buildDocumentView();
      nodes = result.nodes;
    });

    await then('each cell paragraph has correct table_context fields', async () => {
      expect(nodes!).toHaveLength(6);

      // Header row
      const hdr0 = nodes![0]!;
      expect(hdr0.table_context).toBeDefined();
      expect(hdr0.table_context!.table_id).toBe('_tbl_0');
      expect(hdr0.table_context!.table_index).toBe(0);
      expect(hdr0.table_context!.row_index).toBe(0);
      expect(hdr0.table_context!.col_index).toBe(0);
      expect(hdr0.table_context!.col_header).toBe('ID');
      expect(hdr0.table_context!.is_header_row).toBe(true);
      expect(hdr0.table_context!.total_rows).toBe(2);
      expect(hdr0.table_context!.total_cols).toBe(3);

      const hdr1 = nodes![1]!;
      expect(hdr1.table_context!.col_index).toBe(1);
      expect(hdr1.table_context!.col_header).toBe('Title');

      const hdr2 = nodes![2]!;
      expect(hdr2.table_context!.col_index).toBe(2);
      expect(hdr2.table_context!.col_header).toBe('Status');

      // Data row
      const d0 = nodes![3]!;
      expect(d0.table_context!.row_index).toBe(1);
      expect(d0.table_context!.col_index).toBe(0);
      expect(d0.table_context!.is_header_row).toBe(false);
      expect(d0.clean_text).toBe('A1');

      const d1 = nodes![4]!;
      expect(d1.table_context!.row_index).toBe(1);
      expect(d1.table_context!.col_index).toBe(1);
      expect(d1.clean_text).toBe('First');

      const d2 = nodes![5]!;
      expect(d2.table_context!.row_index).toBe(1);
      expect(d2.table_context!.col_index).toBe(2);
      expect(d2.clean_text).toBe('Open');
    });
  });

  test('paragraph parity: table context does not alter paragraph ID order', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let oldIds: string[];
    let newIds: string[];

    await given('a document with paragraphs and a table', async () => {
      const bodyXml =
        `<w:p><w:r><w:t>Before table</w:t></w:r></w:p>` +
        simpleTable(['A', 'B'], [['1', '2'], ['3', '4']]) +
        `<w:p><w:r><w:t>After table</w:t></w:r></w:p>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      const { nodes } = doc!.buildDocumentView();
      newIds = nodes.map((n) => n.id);

      // Compare with raw getParagraphs() order
      const rawParas = doc!.getParagraphs();
      oldIds = rawParas
        .map((p) => getParagraphBookmarkId(p))
        .filter((x): x is string => x !== null);
    });

    await then('paragraph IDs match in order', async () => {
      // New IDs should be a subset of old IDs in the same order.
      // Some paragraphs may be filtered (no text), but order must match.
      let oldIdx = 0;
      for (const newId of newIds!) {
        while (oldIdx < oldIds!.length && oldIds![oldIdx] !== newId) oldIdx++;
        expect(oldIdx).toBeLessThan(oldIds!.length);
        oldIdx++;
      }
    });
  });

  test.openspec('SDX-TABLE-03')
    ('w:ins-wrapped table rows get table context', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('a table with a tracked-change inserted row', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr><w:tc><w:p><w:r><w:t>H1</w:t></w:r></w:p></w:tc></w:tr>` +
        `<w:ins><w:tr><w:tc><w:p><w:r><w:t>Inserted</w:t></w:r></w:p></w:tc></w:tr></w:ins>` +
        `</w:tbl>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      nodes = doc!.buildDocumentView().nodes;
    });

    await then('wrapped paragraph gets table context with correct row index', async () => {
      expect(nodes!).toHaveLength(2);
      expect(nodes![0]!.table_context!.row_index).toBe(0);
      expect(nodes![0]!.table_context!.is_header_row).toBe(true);
      expect(nodes![1]!.table_context!.row_index).toBe(1);
      expect(nodes![1]!.table_context!.is_header_row).toBe(false);
      expect(nodes![1]!.clean_text).toBe('Inserted');
    });
  });

  test.openspec('SDX-TABLE-02')
    ('gridSpan produces grid-aware col_index', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('a table where first data cell has gridSpan=2', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `<w:tr>` +
        `<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Merged</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>Single</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      nodes = doc!.buildDocumentView().nodes;
    });

    await then('col_index accounts for gridSpan', async () => {
      // Header row: A(0), B(1), C(2)
      expect(nodes![0]!.table_context!.col_index).toBe(0);
      expect(nodes![1]!.table_context!.col_index).toBe(1);
      expect(nodes![2]!.table_context!.col_index).toBe(2);
      expect(nodes![2]!.table_context!.total_cols).toBe(3);

      // Data row: Merged spans cols 0-1, Single is at col 2
      const merged = nodes![3]!;
      expect(merged.table_context!.col_index).toBe(0);
      expect(merged.clean_text).toBe('Merged');

      const single = nodes![4]!;
      expect(single.table_context!.col_index).toBe(2);
      expect(single.clean_text).toBe('Single');
    });
  });

  test('vMerge continuation cells get correct coordinates', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('a table with vertically merged cells', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Span</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `<w:tr>` +
        `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      nodes = doc!.buildDocumentView().nodes;
    });

    await then('continuation cell paragraph has correct row/col coordinates', async () => {
      // Row 0: Span(0,0), B1(0,1)
      expect(nodes![0]!.table_context!.row_index).toBe(0);
      expect(nodes![0]!.table_context!.col_index).toBe(0);
      expect(nodes![1]!.table_context!.row_index).toBe(0);
      expect(nodes![1]!.table_context!.col_index).toBe(1);

      // Row 1: continuation(1,0) — empty cell preserved, B2(1,1)
      // Find the vMerge continuation cell node
      const row1Nodes = nodes!.filter((n) => n.table_context!.row_index === 1);
      expect(row1Nodes).toHaveLength(2);
      expect(row1Nodes[0]!.table_context!.col_index).toBe(0);
      expect(row1Nodes[1]!.table_context!.col_index).toBe(1);
      expect(row1Nodes[1]!.clean_text).toBe('B2');
    });
  });

  test('multi-paragraph cells have correct para_in_cell', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('a table cell with 3 paragraphs', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr><w:tc><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:tc></w:tr>` +
        `<w:tr><w:tc>` +
        `<w:p><w:r><w:t>Para 1</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Para 2</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Para 3</w:t></w:r></w:p>` +
        `</w:tc></w:tr>` +
        `</w:tbl>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      nodes = doc!.buildDocumentView().nodes;
    });

    await then('para_in_cell increments correctly', async () => {
      // Header cell (1 para)
      expect(nodes![0]!.table_context!.para_in_cell).toBe(0);
      expect(nodes![0]!.table_context!.cell_para_count).toBe(1);

      // Data cell (3 paras) - all at td(1,0)
      const dataCellNodes = nodes!.filter((n) => n.table_context!.row_index === 1);
      expect(dataCellNodes).toHaveLength(3);
      expect(dataCellNodes[0]!.table_context!.para_in_cell).toBe(0);
      expect(dataCellNodes[0]!.table_context!.cell_para_count).toBe(3);
      expect(dataCellNodes[1]!.table_context!.para_in_cell).toBe(1);
      expect(dataCellNodes[2]!.table_context!.para_in_cell).toBe(2);
    });
  });

  test.openspec('SDX-TABLE-05')
    ('empty table cells are preserved', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('a table with an empty cell', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>Filled</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      nodes = doc!.buildDocumentView().nodes;
    });

    await then('empty cell node is preserved with table_context', async () => {
      expect(nodes!).toHaveLength(2);
      expect(nodes![0]!.clean_text).toBe('Filled');
      expect(nodes![0]!.table_context!.col_index).toBe(0);

      // Empty cell should still be present
      expect(nodes![1]!.table_context!.col_index).toBe(1);
      expect(nodes![1]!.clean_text).toBe('');
    });
  });

  test('multiple tables have correct table_index and table_id', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('a document with 2 tables separated by body text', async () => {
      const bodyXml =
        `<w:p><w:r><w:t>Before</w:t></w:r></w:p>` +
        simpleTable(['X', 'Y'], [['1', '2']]) +
        `<w:p><w:r><w:t>Between</w:t></w:r></w:p>` +
        simpleTable(['P', 'Q'], [['3', '4']]) +
        `<w:p><w:r><w:t>After</w:t></w:r></w:p>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      nodes = doc!.buildDocumentView().nodes;
    });

    await then('table_index and table_id are correct per table', async () => {
      // Body text nodes have no table_context
      expect(nodes![0]!.table_context).toBeUndefined();
      expect(nodes![0]!.clean_text).toBe('Before');

      // First table: _tbl_0
      const t1Nodes = nodes!.filter((n) => n.table_context?.table_index === 0);
      expect(t1Nodes.length).toBe(4); // 2 headers + 2 data
      expect(t1Nodes[0]!.table_context!.table_id).toBe('_tbl_0');
      expect(t1Nodes[0]!.table_context!.col_header).toBe('X');

      // Body text between tables
      const betweenNode = nodes!.find((n) => n.clean_text === 'Between');
      expect(betweenNode!.table_context).toBeUndefined();

      // Second table: _tbl_1
      const t2Nodes = nodes!.filter((n) => n.table_context?.table_index === 1);
      expect(t2Nodes.length).toBe(4);
      expect(t2Nodes[0]!.table_context!.table_id).toBe('_tbl_1');
      expect(t2Nodes[0]!.table_context!.col_header).toBe('P');
    });
  });

  test('mixed body content: only table paragraphs get table_context', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('paragraphs + table + paragraphs', async () => {
      const bodyXml =
        `<w:p><w:r><w:t>Body text 1</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Body text 2</w:t></w:r></w:p>` +
        simpleTable(['Col'], [['Cell']]) +
        `<w:p><w:r><w:t>Body text 3</w:t></w:r></w:p>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      nodes = doc!.buildDocumentView().nodes;
    });

    await then('only table paragraphs have table_context', async () => {
      expect(nodes!).toHaveLength(5);
      expect(nodes![0]!.table_context).toBeUndefined();
      expect(nodes![1]!.table_context).toBeUndefined();
      expect(nodes![2]!.table_context).toBeDefined(); // "Col"
      expect(nodes![3]!.table_context).toBeDefined(); // "Cell"
      expect(nodes![4]!.table_context).toBeUndefined();
    });
  });

  test.openspec('SDX-TABLE-04')
    ('nested table: inner paragraphs get outer cell context', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('a table with a nested table inside a cell', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>Outer Header</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `<w:tr>` +
        `<w:tc>` +
        `<w:p><w:r><w:t>Before nested</w:t></w:r></w:p>` +
        `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Nested cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
        `<w:p><w:r><w:t>After nested</w:t></w:r></w:p>` +
        `</w:tc>` +
        `</w:tr>` +
        `</w:tbl>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      nodes = doc!.buildDocumentView().nodes;
    });

    await then('all paragraphs get outer table context', async () => {
      // All paragraphs should be in _tbl_0
      for (const n of nodes!) {
        expect(n.table_context).toBeDefined();
        expect(n.table_context!.table_id).toBe('_tbl_0');
      }

      // "Nested cell" paragraph should have outer cell coordinates (1,0)
      const nestedNode = nodes!.find((n) => n.clean_text === 'Nested cell');
      expect(nestedNode).toBeDefined();
      expect(nestedNode!.table_context!.row_index).toBe(1);
      expect(nestedNode!.table_context!.col_index).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: renderToon with table markers
// ---------------------------------------------------------------------------

describe('renderToon table markers', () => {
  function makeTableNode(overrides: Partial<DocumentViewNode> & { table_context: TableContext }): DocumentViewNode {
    return {
      id: '_bk_000000000001',
      list_label: '',
      header: '',
      style: 'body',
      text: '',
      clean_text: '',
      tagged_text: '',
      list_metadata: {
        list_level: -1,
        label_type: null,
        label_string: '',
        header_text: null,
        header_style: null,
        header_formatting: null,
        is_auto_numbered: false,
      },
      style_fingerprint: {
        list_level: -1,
        left_indent_pt: 0,
        first_line_indent_pt: 0,
        style_name: 'Body Text',
        alignment: 'LEFT',
      },
      paragraph_style_id: null,
      paragraph_style_name: 'Body Text',
      paragraph_alignment: 'LEFT',
      paragraph_indents_pt: { left: 0, first_line: 0 },
      numbering: { num_id: null, ilvl: null, is_auto_numbered: false },
      header_formatting: null,
      body_run_formatting: null,
      ...overrides,
    };
  }

  function makeBodyNode(overrides: Partial<DocumentViewNode>): DocumentViewNode {
    return makeTableNode({ ...overrides, table_context: undefined as unknown as TableContext });
  }

  const baseTableContext: TableContext = {
    table_id: '_tbl_0',
    table_index: 0,
    row_index: 0,
    col_index: 0,
    col_header: 'ID',
    total_rows: 2,
    total_cols: 3,
    is_header_row: true,
    para_in_cell: 0,
    cell_para_count: 1,
  };

  test.openspec('SDX-TABLE-06')
    ('renderToon emits #TABLE and #END_TABLE markers', async ({ given, when, then }: AllureBddContext) => {
    let nodes: DocumentViewNode[];
    let toon: string;

    await given('nodes with table_context', async () => {
      nodes = [
        makeBodyNode({ id: '_bk_001', tagged_text: 'Before', clean_text: 'Before' }),
        makeTableNode({
          id: '_bk_002', tagged_text: 'ID', clean_text: 'ID',
          table_context: { ...baseTableContext, col_index: 0, col_header: 'ID' },
        }),
        makeTableNode({
          id: '_bk_003', tagged_text: 'Title', clean_text: 'Title',
          table_context: { ...baseTableContext, col_index: 1, col_header: 'Title' },
        }),
        makeTableNode({
          id: '_bk_004', tagged_text: 'Status', clean_text: 'Status',
          table_context: { ...baseTableContext, col_index: 2, col_header: 'Status' },
        }),
        makeTableNode({
          id: '_bk_005', tagged_text: 'A1', clean_text: 'A1',
          table_context: { ...baseTableContext, row_index: 1, col_index: 0, is_header_row: false },
        }),
        makeTableNode({
          id: '_bk_006', tagged_text: 'First', clean_text: 'First',
          table_context: { ...baseTableContext, row_index: 1, col_index: 1, col_header: 'Title', is_header_row: false },
        }),
        makeTableNode({
          id: '_bk_007', tagged_text: 'Open', clean_text: 'Open',
          table_context: { ...baseTableContext, row_index: 1, col_index: 2, col_header: 'Status', is_header_row: false },
        }),
        makeBodyNode({ id: '_bk_008', tagged_text: 'After', clean_text: 'After' }),
      ];
    });

    await when('renderToon is called', async () => {
      toon = renderToon(nodes!);
    });

    await then('#TABLE and #END_TABLE markers are emitted correctly', async () => {
      const lines = toon!.split('\n');
      expect(lines[0]).toBe('#SCHEMA id | list_label | header | style | text');
      expect(lines[1]).toContain('_bk_001');
      expect(lines[2]).toMatch(/^#TABLE _tbl_0 \| 2 rows × 3 cols$/);
      expect(lines[3]).toContain('th(0,0)');
      expect(lines[4]).toContain('th(0,1)');
      expect(lines[5]).toContain('th(0,2)');
      expect(lines[6]).toContain('td(1,0)');
      expect(lines[7]).toContain('td(1,1)');
      expect(lines[8]).toContain('td(1,2)');
      expect(lines[9]).toBe('#END_TABLE');
      expect(lines[10]).toContain('_bk_008');
    });
  });

  test.openspec('SDX-TABLE-07')
    ('renderToon uses th(r,c) for header rows and td(r,c) for data rows', async ({ given, when, then }: AllureBddContext) => {
    let nodes: DocumentViewNode[];
    let toon: string;

    await given('header and data cell nodes', async () => {
      nodes = [
        makeTableNode({
          id: '_bk_010', tagged_text: 'H1', clean_text: 'H1',
          table_context: { ...baseTableContext, row_index: 0, col_index: 0, is_header_row: true },
        }),
        makeTableNode({
          id: '_bk_011', tagged_text: 'D1', clean_text: 'D1',
          table_context: { ...baseTableContext, row_index: 1, col_index: 0, is_header_row: false },
        }),
      ];
    });

    await when('renderToon is called', async () => {
      toon = renderToon(nodes!);
    });

    await then('style shows th(r,c) for header and td(r,c) for data', async () => {
      expect(toon!).toContain('| th(0,0) |');
      expect(toon!).toContain('| td(1,0) |');
    });
  });

  test('formatToonDataLine produces td(r,c) style for table nodes', async ({ given, when, then }: AllureBddContext) => {
    let node: DocumentViewNode;
    let line: string;

    await given('a table data cell node', async () => {
      node = makeTableNode({
        id: '_bk_020', tagged_text: 'CellText', clean_text: 'CellText',
        table_context: { ...baseTableContext, row_index: 2, col_index: 1, is_header_row: false },
      });
    });

    await when('formatToonDataLine is called', async () => {
      line = formatToonDataLine(node!);
    });

    await then('output has td(2,1) style', async () => {
      expect(line!).toBe('_bk_020 |  |  | td(2,1) | CellText');
    });
  });

  test('collectTableMarkerInfo and formatTableMarker produce correct output', async ({ given, when, then }: AllureBddContext) => {
    let nodes: DocumentViewNode[];
    let markerLine: string;

    await given('table nodes from a 5-row × 2-col table', async () => {
      nodes = [
        makeTableNode({
          id: '_bk_030', tagged_text: 'X', clean_text: 'X',
          table_context: {
            ...baseTableContext,
            table_id: '_tbl_2', table_index: 2,
            total_rows: 5, total_cols: 2,
            col_index: 0, col_header: 'Name',
          },
        }),
        makeTableNode({
          id: '_bk_031', tagged_text: 'Y', clean_text: 'Y',
          table_context: {
            ...baseTableContext,
            table_id: '_tbl_2', table_index: 2,
            total_rows: 5, total_cols: 2,
            col_index: 1, col_header: 'Value',
          },
        }),
      ];
    });

    await when('collectTableMarkerInfo and formatTableMarker are called', async () => {
      const info = collectTableMarkerInfo(nodes!);
      const entry = info.get(2)!;
      markerLine = formatTableMarker(entry);
    });

    await then('marker line shows dimensions without repeating headers', async () => {
      expect(markerLine!).toBe('#TABLE _tbl_2 | 5 rows × 2 cols');
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Shared DOM helpers
// ---------------------------------------------------------------------------

describe('shared DOM helpers', () => {
  test.openspec('SDX-TABLE-08')
    ('isW returns true only for matching namespace + localName', async ({ given, when, then }: AllureBddContext) => {
      let doc: Document;
      let tblEl: Element;
      let pEl: Element;

      await given('a document with w:tbl and w:p elements', async () => {
        doc = parseXml(
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<w:document xmlns:w="${OOXML.W_NS}"><w:body><w:tbl/><w:p/></w:body></w:document>`,
        );
        const body = doc.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0) as Element;
        tblEl = body.getElementsByTagNameNS(OOXML.W_NS, 'tbl').item(0) as Element;
        pEl = body.getElementsByTagNameNS(OOXML.W_NS, 'p').item(0) as Element;
      });

      await when('isW is called with various arguments', async () => {
        // checked in then
      });

      await then('it matches namespace and localName correctly', async () => {
        expect(isW(tblEl, 'tbl')).toBe(true);
        expect(isW(tblEl, 'p')).toBe(false);
        expect(isW(pEl, 'p')).toBe(true);
        expect(isW(null, 'tbl')).toBe(false);
        expect(isW(undefined, 'tbl')).toBe(false);
      });
    });

  test('getDirectChildrenByName returns only direct children matching localName', async ({ given, when, then }: AllureBddContext) => {
    let body: Element;
    let directPs: Element[];
    let directTbls: Element[];

    await given('a document with body containing w:p, w:tbl, and nested w:p inside w:tbl', async () => {
      const doc = parseXml(
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<w:document xmlns:w="${OOXML.W_NS}">` +
        `<w:body>` +
        `<w:p><w:r><w:t>Body para</w:t></w:r></w:p>` +
        `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Nested</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
        `<w:p><w:r><w:t>Body para 2</w:t></w:r></w:p>` +
        `</w:body>` +
        `</w:document>`,
      );
      body = doc.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0) as Element;
    });

    await when('getDirectChildrenByName is called for p and tbl', async () => {
      directPs = getDirectChildrenByName(body!, 'p');
      directTbls = getDirectChildrenByName(body!, 'tbl');
    });

    await then('it returns only direct children, not nested descendants', async () => {
      // Only 2 direct w:p children (the nested one in tbl should not be included)
      expect(directPs!).toHaveLength(2);
      expect(directPs![0]!.textContent).toContain('Body para');
      expect(directPs![1]!.textContent).toContain('Body para 2');

      // 1 direct w:tbl child
      expect(directTbls!).toHaveLength(1);
    });
  });

  test('getDirectChildrenByName returns empty array when no children match', async ({ given, when, then }: AllureBddContext) => {
    let parent: Element;
    let result: Element[];

    await given('an element with no w:tc children', async () => {
      const doc = parseXml(
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<w:document xmlns:w="${OOXML.W_NS}">` +
        `<w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body>` +
        `</w:document>`,
      );
      parent = doc.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0) as Element;
    });

    await when('getDirectChildrenByName is called for tc', async () => {
      result = getDirectChildrenByName(parent!, 'tc');
    });

    await then('it returns an empty array', async () => {
      expect(result!).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Table edge cases (coverage for uncovered code paths)
// ---------------------------------------------------------------------------

describe('table context edge cases', () => {
  test('empty table (0 rows) is skipped by buildTableMetaMap', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('a document with an empty w:tbl element (no rows)', async () => {
      const bodyXml =
        `<w:p><w:r><w:t>Before</w:t></w:r></w:p>` +
        `<w:tbl></w:tbl>` +
        `<w:p><w:r><w:t>After</w:t></w:r></w:p>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      nodes = doc!.buildDocumentView().nodes;
    });

    await then('no paragraphs have table_context', async () => {
      expect(nodes!.length).toBeGreaterThanOrEqual(2);
      for (const n of nodes!) {
        expect(n.table_context).toBeUndefined();
      }
    });
  });

  test('cell with no tcPr defaults gridSpan to 1', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('a table where cells have no w:tcPr element', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      nodes = doc!.buildDocumentView().nodes;
    });

    await then('col_index increments by 1 for each cell (default gridSpan)', async () => {
      expect(nodes!).toHaveLength(2);
      expect(nodes![0]!.table_context!.col_index).toBe(0);
      expect(nodes![1]!.table_context!.col_index).toBe(1);
      expect(nodes![0]!.table_context!.total_cols).toBe(2);
    });
  });

  test('cell with gridSpan val=0 defaults to 1', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('a table cell with w:gridSpan w:val="0"', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:tcPr><w:gridSpan w:val="0"/></w:tcPr><w:p><w:r><w:t>X</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>Y</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      nodes = doc!.buildDocumentView().nodes;
    });

    await then('gridSpan of 0 is treated as 1', async () => {
      expect(nodes![0]!.table_context!.col_index).toBe(0);
      expect(nodes![1]!.table_context!.col_index).toBe(1);
      expect(nodes![0]!.table_context!.total_cols).toBe(2);
    });
  });

  test('header cell with multiple paragraphs joins their text', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('a table where header cell has 2 paragraphs', async () => {
      const bodyXml =
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc>` +
        `<w:p><w:r><w:t>Line 1</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Line 2</w:t></w:r></w:p>` +
        `</w:tc>` +
        `<w:tc><w:p><w:r><w:t>Other</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>D1</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>D2</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      nodes = doc!.buildDocumentView().nodes;
    });

    await then('col_header joins multi-paragraph text from header cell', async () => {
      // Data row cells should have col_header derived from header row
      const dataRow = nodes!.filter((n) => n.table_context!.row_index === 1);
      expect(dataRow).toHaveLength(2);
      // First column header should be "Line 1 Line 2" (joined from 2 paragraphs)
      expect(dataRow[0]!.table_context!.col_header).toBe('Line 1 Line 2');
      expect(dataRow[1]!.table_context!.col_header).toBe('Other');
    });
  });

  test('two consecutive tables without body text between them', async ({ given, when, then }: AllureBddContext) => {
    let nodes: DocumentViewNode[];
    let toon: string;

    await given('a document with two adjacent tables', async () => {
      const bodyXml =
        simpleTable(['A'], [['1']]) +
        simpleTable(['B'], [['2']]);
      const doc = await makeDocxDocument(bodyXml);
      nodes = doc.buildDocumentView().nodes;
    });

    await when('renderToon is called', async () => {
      toon = renderToon(nodes!);
    });

    await then('#END_TABLE and new #TABLE appear between consecutive tables', async () => {
      const lines = toon!.split('\n');
      // Should have: #SCHEMA, #TABLE _tbl_0, th, td, #END_TABLE, #TABLE _tbl_1, th, td, #END_TABLE
      const tableMarkers = lines.filter((l) => l.startsWith('#TABLE') || l === '#END_TABLE');
      expect(tableMarkers).toHaveLength(4); // #TABLE, #END_TABLE, #TABLE, #END_TABLE
      expect(tableMarkers[0]).toContain('_tbl_0');
      expect(tableMarkers[1]).toBe('#END_TABLE');
      expect(tableMarkers[2]).toContain('_tbl_1');
      expect(tableMarkers[3]).toBe('#END_TABLE');
    });
  });

  test('gridSpan header padding: headers padded when fewer cells than max grid cols', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('a table where data row has more grid columns than header row cells', async () => {
      // Header row has 2 cells, data row has 3 cells. maxGridCols = 3, headers should be padded.
      const bodyXml =
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>H1</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>H2</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>D1</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>D2</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>D3</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      nodes = doc!.buildDocumentView().nodes;
    });

    await then('col_header for columns beyond header cells is empty string', async () => {
      const d3 = nodes!.find((n) => n.clean_text === 'D3');
      expect(d3).toBeDefined();
      expect(d3!.table_context!.col_index).toBe(2);
      // Third column has no header cell -> col_header should be empty
      expect(d3!.table_context!.col_header).toBe('');
      expect(d3!.table_context!.total_cols).toBe(3);
    });
  });

  test('gridSpan header trimming: headers trimmed when header row spans more than max', async ({ given, when, then }: AllureBddContext) => {
    let doc: DocxDocument;
    let nodes: DocumentViewNode[];

    await given('a table where header row has gridSpan exceeding data row columns', async () => {
      // Header row: cell spanning 3 cols. Data row: 2 cells. maxGridCols = 3 (from header).
      // headers array should be trimmed to maxGridCols.
      const bodyXml =
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:tcPr><w:gridSpan w:val="3"/></w:tcPr><w:p><w:r><w:t>Wide Header</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>D1</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>D2</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`;
      doc = await makeDocxDocument(bodyXml);
    });

    await when('buildDocumentView is called', async () => {
      nodes = doc!.buildDocumentView().nodes;
    });

    await then('total_cols reflects max grid span across all rows', async () => {
      // maxGridCols = 3 (from header row gridSpan), data row has 2 cells
      const headerNode = nodes!.find((n) => n.clean_text === 'Wide Header');
      expect(headerNode).toBeDefined();
      expect(headerNode!.table_context!.total_cols).toBe(3);
      expect(headerNode!.table_context!.col_header).toBe('Wide Header');
    });
  });

  test('formatToonDataLine uses compact fingerprint token for non-table nodes', async ({ given, when, then }: AllureBddContext) => {
    let node: DocumentViewNode;
    let compactLine: string;
    let normalLine: string;

    await given('a body text node (no table_context)', async () => {
      node = {
        id: '_bk_100',
        list_label: '',
        header: '',
        style: 'Normal',
        text: 'Hello world',
        clean_text: 'Hello world',
        tagged_text: 'Hello world',
        list_metadata: {
          list_level: -1,
          label_type: null,
          label_string: '',
          header_text: null,
          header_style: null,
          header_formatting: null,
          is_auto_numbered: false,
        },
        style_fingerprint: {
          list_level: -1,
          left_indent_pt: 0,
          first_line_indent_pt: 0,
          style_name: 'Body Text',
          alignment: 'LEFT',
        },
        paragraph_style_id: null,
        paragraph_style_name: 'Body Text',
        paragraph_alignment: 'LEFT',
        paragraph_indents_pt: { left: 0, first_line: 0 },
        numbering: { num_id: null, ilvl: null, is_auto_numbered: false },
        header_formatting: null,
        body_run_formatting: null,
      };
    });

    await when('formatToonDataLine is called with and without compact option', async () => {
      compactLine = formatToonDataLine(node!, { compact: true });
      normalLine = formatToonDataLine(node!);
    });

    await then('compact mode uses fingerprint token, normal mode uses style', async () => {
      // compact should use computeFingerprintToken format
      expect(compactLine!).toContain('Normal:L-1:LEFT:I0:H0');
      // non-compact should use the style field
      expect(normalLine!).toContain('| Normal |');
    });
  });
});
