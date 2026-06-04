import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { inlineTagsToMarkdown, serializeToMarkdown } from './serialize_markdown.js';
import type { DocumentViewNode, TableContext } from './document_view.js';
import { LabelType } from './list_labels.js';
import type { Footnote } from './footnotes.js';

const TEST_FEATURE = 'add-markdown-export';
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
  opts: { isHeader?: boolean; totalCols?: number; tableId?: string } = {},
): DocumentViewNode {
  const tc: TableContext = {
    table_id: opts.tableId ?? '_tbl_0',
    table_index: 0,
    row_index: rowIndex,
    col_index: colIndex,
    col_header: '',
    total_rows: 0,
    total_cols: opts.totalCols ?? 2,
    is_header_row: opts.isHeader ?? false,
    para_in_cell: 0,
    cell_para_count: 1,
  };
  return node({ tagged_text: text, table_context: tc });
}

function footnote(displayNumber: number, text: string): Footnote {
  return { id: displayNumber, displayNumber, text, anchoredParagraphId: null };
}

describe('OpenSpec traceability: add-markdown-export (Markdown serializer)', () => {
  test.openspec('word-style headings become ATX headings')(
    'word-style headings become ATX headings',
    async ({ then }: AllureBddContext) => {
      const md = serializeToMarkdown([
        node({ tagged_text: 'Section Title', heading: { text: 'Section Title', source: 'word_style', level: 2 } }),
      ]);
      await then('the heading renders with two leading #', async () => {
        expect(md).toContain('## Section Title');
      });
    },
  );

  test.openspec('heuristic headings remain paragraphs')(
    'heuristic headings remain paragraphs',
    async ({ then }: AllureBddContext) => {
      const md = serializeToMarkdown([
        node({
          tagged_text: '<b>Indemnification.</b> The Company shall indemnify.',
          heading: { text: 'Indemnification', source: 'run_in_header', level: null },
        }),
      ]);
      await then('it is a bold paragraph, not an ATX heading', async () => {
        expect(md).not.toMatch(/^#/m);
        expect(md).toContain('**Indemnification.**');
      });
    },
  );

  test.openspec('inline bold italic and link tags map to Markdown')(
    'inline bold italic and link tags map to Markdown',
    async ({ then }: AllureBddContext) => {
      const out = inlineTagsToMarkdown('<b>Bold</b> and <i>it</i> and <a href="https://x.com">link</a>');
      await then('tags map to **, *, and [text](url)', async () => {
        expect(out).toBe('**Bold** and *it* and [link](https://x.com)');
      });
      // Run-split phrases must not produce stray `******`: adjacent close→open emphasis
      // toggles are coalesced back into a single span.
      const split = inlineTagsToMarkdown('<b><i>2 years</i></b><b><i> total</i></b>');
      await then('run-split emphasis coalesces instead of emitting ******', async () => {
        expect(split).toBe('***2 years total***');
        expect(split).not.toContain('******');
      });
      // A run-split where the second run re-opens emphasis in the *opposite* order
      // (`<i><b>` vs `<b><i>`) leaves no adjacent same-kind toggle to cancel pairwise; the
      // state-machine reconciliation must still collapse it rather than emit `******`.
      const reordered = inlineTagsToMarkdown('<b><i>A</i></b><i><b>B</b></i>');
      await then('opposite-order run-split also coalesces', async () => {
        expect(reordered).toBe('***AB***');
        expect(reordered).not.toContain('******');
      });
    },
  );

  test.openspec('underline passes through as raw HTML and font and highlight tags are stripped')(
    'underline passes through as raw HTML and font and highlight tags are stripped',
    async ({ then }: AllureBddContext) => {
      const out = inlineTagsToMarkdown('<u>under</u> <font color="FF0000">red</font> <highlight>hl</highlight>');
      await then('underline is raw HTML; font/highlight drop their tags', async () => {
        expect(out).toBe('<u>under</u> red hl');
      });
    },
  );

  test.openspec('nested ordered and bullet lists are indented by level')(
    'nested ordered and bullet lists are indented by level',
    async ({ then }: AllureBddContext) => {
      const md = serializeToMarkdown([
        node({
          tagged_text: 'First item',
          list_metadata: { list_level: 0, label_type: LabelType.NUMBER, label_string: '1.', is_auto_numbered: true },
        }),
        node({
          tagged_text: 'Nested bullet',
          list_metadata: { list_level: 1 },
        }),
      ]);
      await then('ordered item uses 1. and the nested bullet is indented', async () => {
        expect(md).toContain('1. First item');
        expect(md).toContain('  - Nested bullet');
      });
    },
  );

  test.openspec('legal list labels are preserved')(
    'legal list labels are preserved',
    async ({ then }: AllureBddContext) => {
      const md = serializeToMarkdown([
        node({
          tagged_text: 'The parties agree as follows.',
          list_metadata: { list_level: 0, label_type: LabelType.SECTION, label_string: 'Section 2.1' },
        }),
      ]);
      await then('the literal legal label survives', async () => {
        expect(md).toContain('Section 2.1 The parties agree as follows.');
        expect(md).not.toContain('1. The parties agree');
      });
    },
  );

  test.openspec('a table renders as a GFM table')(
    'a table renders as a GFM table',
    async ({ then }: AllureBddContext) => {
      const md = serializeToMarkdown([
        tableCell(0, 0, 'Name', { isHeader: true }),
        tableCell(0, 1, 'Age', { isHeader: true }),
        tableCell(1, 0, 'Alice'),
        tableCell(1, 1, '30'),
      ]);
      await then('a header row, separator, and body row are emitted', async () => {
        expect(md).toContain('| Name | Age |');
        expect(md).toContain('| --- | --- |');
        expect(md).toContain('| Alice | 30 |');
      });
      // A line break inside a cell must not split the GFM row.
      const withBreak = serializeToMarkdown([
        tableCell(0, 0, 'H', { isHeader: true, totalCols: 1 }),
        tableCell(1, 0, 'Line1\nLine2', { totalCols: 1 }),
      ]);
      await then('intra-cell newlines become <br> rather than breaking the row', async () => {
        expect(withBreak).toContain('| Line1<br>Line2 |');
        expect(withBreak).not.toContain('Line1\nLine2');
      });
    },
  );

  test.openspec('merged cell gaps are filled to preserve the grid')(
    'merged cell gaps are filled to preserve the grid',
    async ({ then }: AllureBddContext) => {
      // Row 1 skips col_index 1 (a horizontally merged cell), leaving a grid gap.
      const md = serializeToMarkdown([
        tableCell(0, 0, 'A', { isHeader: true, totalCols: 3 }),
        tableCell(0, 1, 'B', { isHeader: true, totalCols: 3 }),
        tableCell(0, 2, 'C', { isHeader: true, totalCols: 3 }),
        tableCell(1, 0, 'X', { totalCols: 3 }),
        tableCell(1, 2, 'Z', { totalCols: 3 }),
      ]);
      await then('the skipped column is filled with an empty cell', async () => {
        expect(md).toContain('| X |  | Z |');
      });
    },
  );

  test.openspec('footnote definitions are appended')(
    'footnote definitions are appended',
    async ({ then }: AllureBddContext) => {
      const md = serializeToMarkdown(
        [node({ tagged_text: 'A clause with a note[^1] here.' })],
        [footnote(1, 'The footnote body.')],
      );
      await then('the [^1] definition is appended', async () => {
        expect(md).toContain('A clause with a note[^1] here.');
        expect(md).toContain('[^1]: The footnote body.');
      });
    },
  );

  test.openspec('footnote markers are preserved when escaping text')(
    'footnote markers are preserved when escaping text',
    async ({ then }: AllureBddContext) => {
      const out = inlineTagsToMarkdown('a*b[^2] tail');
      await then('the marker stays intact while the * is escaped', async () => {
        expect(out).toContain('[^2]');
        expect(out).toContain('a\\*b');
      });
    },
  );

  test.openspec('Markdown-significant characters in text are escaped')(
    'Markdown-significant characters in text are escaped',
    async ({ then }: AllureBddContext) => {
      const inline = inlineTagsToMarkdown('use *stars* and _under_');
      const leading = serializeToMarkdown([node({ tagged_text: '# not a heading' })]);
      await then('inline emphasis chars and a leading # are escaped', async () => {
        expect(inline).toBe('use \\*stars\\* and \\_under\\_');
        expect(leading).toContain('\\# not a heading');
      });
    },
  );
});
