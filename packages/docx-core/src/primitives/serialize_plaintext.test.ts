import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { serializeToPlainText } from './serialize_plaintext.js';
import type { DocumentViewNode, TableContext } from './document_view.js';
import { LabelType } from './list_labels.js';
import type { Footnote } from './footnotes.js';

const TEST_FEATURE = 'add-text-export';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

// ── Minimal DocumentViewNode factory ────────────────────────────────────────
// The serializer only reads `tagged_text`, `heading`, `list_metadata`, and `table_context`;
// the rest are filled with inert defaults so tests stay focused on serialization behavior.
type NodeOverrides = Omit<Partial<DocumentViewNode>, 'list_metadata'> & {
  list_metadata?: Partial<DocumentViewNode['list_metadata']>;
};

let nodeSeq = 0;
function node(overrides: NodeOverrides = {}): DocumentViewNode {
  const { list_metadata: lmOverride, ...rest } = overrides;
  return {
    id: `_bk_${nodeSeq++}`,
    list_label: '',
    header: '',
    style: 'body',
    text: overrides.tagged_text ?? '',
    clean_text: overrides.tagged_text ?? '',
    tagged_text: overrides.tagged_text ?? '',
    list_metadata: {
      list_level: -1,
      label_type: null,
      label_string: '',
      header_text: null,
      header_style: null,
      header_formatting: null,
      is_auto_numbered: false,
      ...(lmOverride ?? {}),
    },
    style_fingerprint: {
      list_level: -1,
      left_indent_pt: 0,
      first_line_indent_pt: 0,
      style_name: '',
      alignment: 'LEFT',
    },
    paragraph_style_id: null,
    paragraph_style_name: '',
    paragraph_alignment: 'LEFT',
    paragraph_indents_pt: { left: 0, first_line: 0 },
    numbering: { num_id: null, ilvl: null, is_auto_numbered: false },
    header_formatting: null,
    body_run_formatting: null,
    ...rest,
  };
}

function tableCell(
  rowIndex: number,
  colIndex: number,
  text: string,
  opts: { totalCols?: number; tableId?: string } = {},
): DocumentViewNode {
  const tc: TableContext = {
    table_id: opts.tableId ?? '_tbl_0',
    table_index: 0,
    row_index: rowIndex,
    col_index: colIndex,
    col_header: '',
    total_rows: 0,
    total_cols: opts.totalCols ?? 2,
    is_header_row: false,
    para_in_cell: 0,
    cell_para_count: 1,
  };
  return node({ tagged_text: text, table_context: tc });
}

function footnote(displayNumber: number, text: string): Footnote {
  return {
    id: displayNumber,
    displayNumber,
    text,
    anchoredParagraphId: null,
    refParagraphIds: [],
    paragraphs: [{ text, tagged_text: text, style: 'FootnoteText' }],
  };
}

describe('OpenSpec traceability: add-text-export (plain text serializer)', () => {
  test.openspec('all inline and semantic tags are stripped')(
    'all inline and semantic tags are stripped',
    async ({ then }: AllureBddContext) => {
      const out = serializeToPlainText([
        node({
          tagged_text:
            '<b>Bold</b> <i>it</i> <u>under</u> <a href="https://x.com">link</a> <font color="FF0000">red</font> <highlight>hl</highlight>',
        }),
      ]);
      await then('every tag is removed and inner text is kept', async () => {
        expect(out.trim()).toBe('Bold it under link red hl');
        expect(out).not.toMatch(/<[^>]+>/);
      });
    },
  );

  test.openspec('paragraphs are separated by a blank line')(
    'paragraphs are separated by a blank line',
    async ({ then }: AllureBddContext) => {
      const out = serializeToPlainText([node({ tagged_text: 'First.' }), node({ tagged_text: 'Second.' })]);
      await then('a blank line separates the two paragraphs', async () => {
        expect(out).toBe('First.\n\nSecond.\n');
      });
    },
  );

  test.openspec('headings render as plain paragraphs')(
    'headings render as plain paragraphs',
    async ({ then }: AllureBddContext) => {
      const out = serializeToPlainText([
        node({ tagged_text: 'Section Title', heading: { text: 'Section Title', source: 'word_style', level: 2 } }),
      ]);
      await then('the heading is plain text with no markup', async () => {
        expect(out.trim()).toBe('Section Title');
        expect(out).not.toContain('#');
      });
    },
  );

  test.openspec('list items render as simple bullets indented by level')(
    'list items render as simple bullets indented by level',
    async ({ then }: AllureBddContext) => {
      const out = serializeToPlainText([
        node({
          tagged_text: 'First item',
          list_metadata: { list_level: 0, label_type: LabelType.NUMBER, is_auto_numbered: true },
        }),
        node({ tagged_text: 'Nested bullet', list_metadata: { list_level: 1 } }),
      ]);
      await then('both render as - bullets and the nested one is indented', async () => {
        expect(out).toContain('- First item');
        expect(out).toContain('  - Nested bullet');
        expect(out).not.toContain('1.');
      });
    },
  );

  test.openspec('literal list labels are preserved')(
    'literal list labels are preserved',
    async ({ then }: AllureBddContext) => {
      const out = serializeToPlainText([
        node({ tagged_text: 'Definitions.', list_metadata: { list_level: 0, label_string: 'Section 2.1' } }),
      ]);
      await then('the literal label appears in the bullet', async () => {
        expect(out).toContain('- Section 2.1 Definitions.');
      });
    },
  );

  test.openspec('a table renders as tab-separated rows')(
    'a table renders as tab-separated rows',
    async ({ then }: AllureBddContext) => {
      const out = serializeToPlainText([
        tableCell(0, 0, 'A'),
        tableCell(0, 1, 'B'),
        tableCell(1, 0, 'C'),
        tableCell(1, 1, 'D'),
      ]);
      await then('cells are tab-separated, one row per line', async () => {
        expect(out).toContain('A\tB');
        expect(out).toContain('C\tD');
      });
    },
  );

  test.openspec('merged cell gaps are filled to keep the column count')(
    'merged cell gaps are filled to keep the column count',
    async ({ then }: AllureBddContext) => {
      // A row with cols 0 and 2 populated (col 1 skipped by a horizontal merge).
      const out = serializeToPlainText([
        tableCell(0, 0, 'X', { totalCols: 3 }),
        tableCell(0, 2, 'Z', { totalCols: 3 }),
      ]);
      await then('the skipped column renders as an empty tab field (X\\t\\tZ)', async () => {
        expect(out).toContain('X\t\tZ');
      });
    },
  );

  test.openspec('intra-cell newlines collapse to a space')(
    'intra-cell newlines collapse to a space',
    async ({ then }: AllureBddContext) => {
      const out = serializeToPlainText([tableCell(0, 0, 'line one\nline two'), tableCell(0, 1, 'B')]);
      await then('the cell newline becomes a space, not a row break', async () => {
        expect(out).toContain('line one line two\tB');
      });
    },
  );

  test.openspec('empty cells at table boundaries are preserved')(
    'empty cells at table boundaries are preserved',
    async ({ then }: AllureBddContext) => {
      // A document that *starts* with a row whose first cell is empty, and *ends* with a row
      // whose last cell is empty. The boundary tabs must survive document-level trimming so
      // the column count stays consistent (regression: a whole-string `.trim()` ate them).
      const leading = serializeToPlainText([tableCell(0, 0, ''), tableCell(0, 1, 'Z')]);
      const trailing = serializeToPlainText([tableCell(0, 0, 'X'), tableCell(0, 1, '')]);
      await then('the leading and trailing empty tab fields are kept', async () => {
        expect(leading).toBe('\tZ\n');
        expect(trailing).toBe('X\t\n');
      });
    },
  );

  test.openspec('footnote markers are preserved and definitions appended')(
    'footnote markers are preserved and definitions appended',
    async ({ then }: AllureBddContext) => {
      const out = serializeToPlainText(
        [node({ tagged_text: 'See the note.[^1]' })],
        [footnote(1, 'The footnote body.')],
      );
      await then('the inline marker survives and the definition is appended', async () => {
        expect(out).toContain('See the note.[^1]');
        expect(out).toContain('[^1] The footnote body.');
        // The marker precedes its definition.
        expect(out.indexOf('See the note.[^1]')).toBeLessThan(out.indexOf('[^1] The footnote body.'));
      });
    },
  );
});
