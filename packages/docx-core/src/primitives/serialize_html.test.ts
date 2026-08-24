import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { inlineTagsToHtml, serializeToHtml } from './serialize_html.js';
import type { DocumentViewNode, TableContext } from './document_view.js';
import { LabelType } from './list_labels.js';
import type { Footnote } from './footnotes.js';

const TEST_FEATURE = 'add-html-export';
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
  return {
    id: displayNumber,
    displayNumber,
    text,
    anchoredParagraphId: null,
    refParagraphIds: [],
    referencePoints: [],
    paragraphs: [{ text, tagged_text: text, style: 'FootnoteText' }],
  };
}

/** Render the body only (no doc wrapper) to keep assertions focused on block structure. */
function body(nodes: DocumentViewNode[], footnotes: Footnote[] = []): string {
  return serializeToHtml(nodes, footnotes, { fragment: true });
}

describe('OpenSpec traceability: add-html-export (HTML serializer)', () => {
  test.openspec('word-style headings become heading elements')(
    'word-style headings become heading elements',
    async ({ then }: AllureBddContext) => {
      const html = body([
        node({ tagged_text: 'Section Title', heading: { text: 'Section Title', source: 'word_style', level: 2 } }),
      ]);
      await then('the heading renders as <h2>', async () => {
        expect(html).toContain('<h2>Section Title</h2>');
      });
    },
  );

  test.openspec('heuristic headings remain paragraphs')(
    'heuristic headings remain paragraphs',
    async ({ then }: AllureBddContext) => {
      const html = body([
        node({
          tagged_text: '<b>Indemnification.</b> The Company shall indemnify.',
          heading: { text: 'Indemnification', source: 'run_in_header', level: null },
        }),
      ]);
      await then('it is a <p> with the run-in bold, not a heading element', async () => {
        expect(html).not.toMatch(/<h[1-6]>/);
        expect(html).toContain('<p><b>Indemnification.</b> The Company shall indemnify.</p>');
      });
    },
  );

  test.openspec('inline bold italic underline and link tags map to HTML')(
    'inline bold italic underline and link tags map to HTML',
    async ({ then }: AllureBddContext) => {
      const out = inlineTagsToHtml('<b>Bold</b> <i>it</i> <u>u</u> <a href="https://x.com">link</a>');
      await then('b/i/u pass through and the anchor keeps its href', async () => {
        expect(out).toBe('<b>Bold</b> <i>it</i> <u>u</u> <a href="https://x.com">link</a>');
      });
    },
  );

  test.openspec('highlight maps to mark and font maps to a styled span')(
    'highlight maps to mark and font maps to a styled span',
    async ({ then }: AllureBddContext) => {
      const out = inlineTagsToHtml('<highlight>hl</highlight> <font color="FF0000" size="14" face="Arial">red</font>');
      await then('highlight becomes <mark> and font becomes a styled <span>', async () => {
        expect(out).toContain('<mark>hl</mark>');
        expect(out).toContain(`<span style="color:#FF0000;font-size:14pt;font-family:'Arial'">red</span>`);
        expect(out).toContain('</span>');
      });
    },
  );

  test.openspec('consecutive list nodes group into nested lists')(
    'consecutive list nodes group into nested lists',
    async ({ then }: AllureBddContext) => {
      const html = body([
        node({ tagged_text: 'First item', list_metadata: { list_level: 0, is_auto_numbered: true, label_type: LabelType.NUMBER, label_string: '1.' } }),
        node({ tagged_text: 'Nested item', list_metadata: { list_level: 1, is_auto_numbered: true, label_type: LabelType.NUMBER, label_string: 'a.' } }),
        node({ tagged_text: 'Back to top', list_metadata: { list_level: 0, is_auto_numbered: true, label_type: LabelType.NUMBER, label_string: '2.' } }),
      ]);
      await then('a nested <ol> opens and every opened list is closed', async () => {
        expect(html).toContain('<li>First item');
        expect(html).toContain('<li>Nested item');
        // Well-formed: equal counts of <ol> and </ol>, <li> and </li>.
        expect((html.match(/<ol>/g) ?? []).length).toBe((html.match(/<\/ol>/g) ?? []).length);
        expect((html.match(/<li>/g) ?? []).length).toBe((html.match(/<\/li>/g) ?? []).length);
        // Nesting actually happened (more than one <ol> opened).
        expect((html.match(/<ol>/g) ?? []).length).toBeGreaterThan(1);
      });
    },
  );

  test.openspec('auto-numbered lists render as ordered lists')(
    'auto-numbered lists render as ordered lists',
    async ({ then }: AllureBddContext) => {
      // Auto `1.` can classify as NUMBERED_HEADING, not NUMBER — `is_auto_numbered` is the signal.
      const html = body([
        node({ tagged_text: 'Numbered clause', list_metadata: { list_level: 0, is_auto_numbered: true, label_type: LabelType.NUMBERED_HEADING, label_string: '1.' } }),
      ]);
      await then('it renders inside an <ol> regardless of label_type', async () => {
        expect(html).toContain('<ol>');
        expect(html).toContain('<li>Numbered clause');
        expect(html).not.toContain('<ul>');
      });
    },
  );

  test.openspec('legal list labels are preserved')(
    'legal list labels are preserved',
    async ({ then }: AllureBddContext) => {
      const html = body([
        node({ tagged_text: 'The parties agree as follows.', list_metadata: { list_level: 0, label_type: LabelType.SECTION, label_string: 'Section 2.1' } }),
      ]);
      await then('the literal legal label survives inside a <ul> item', async () => {
        expect(html).toContain('<ul>');
        expect(html).toContain('<li>Section 2.1 The parties agree as follows.');
      });
    },
  );

  test.openspec('a table renders as an HTML table')(
    'a table renders as an HTML table',
    async ({ then }: AllureBddContext) => {
      const html = body([
        tableCell(0, 0, 'Name', { isHeader: true }),
        tableCell(0, 1, 'Age', { isHeader: true }),
        tableCell(1, 0, 'Alice'),
        tableCell(1, 1, '30'),
      ]);
      await then('a <thead> header row and a <tbody> data row are emitted', async () => {
        expect(html).toContain('<table>');
        expect(html).toContain('<thead>');
        expect(html).toContain('<th>Name</th><th>Age</th>');
        expect(html).toContain('<tbody>');
        expect(html).toContain('<td>Alice</td><td>30</td>');
      });
    },
  );

  test.openspec('merged cell gaps are filled to preserve the grid')(
    'merged cell gaps are filled to preserve the grid',
    async ({ then }: AllureBddContext) => {
      // Row 1 skips col_index 1 (a horizontally merged cell), leaving a grid gap.
      const html = body([
        tableCell(0, 0, 'A', { isHeader: true, totalCols: 3 }),
        tableCell(0, 1, 'B', { isHeader: true, totalCols: 3 }),
        tableCell(0, 2, 'C', { isHeader: true, totalCols: 3 }),
        tableCell(1, 0, 'X', { totalCols: 3 }),
        tableCell(1, 2, 'Z', { totalCols: 3 }),
      ]);
      await then('the skipped column is filled with an empty cell', async () => {
        expect(html).toContain('<td>X</td><td></td><td>Z</td>');
      });
    },
  );

  test.openspec('footnotes render as anchors and a definitions section')(
    'footnotes render as anchors and a definitions section',
    async ({ then }: AllureBddContext) => {
      const html = body(
        [node({ tagged_text: 'A clause with a note[^1] here.' })],
        [footnote(1, 'The footnote body.')],
      );
      await then('the marker is a superscript anchor and a definitions section is appended', async () => {
        expect(html).toContain('<sup id="fnref-1"><a href="#fn-1">1</a></sup>');
        expect(html).toContain('<section class="footnotes">');
        expect(html).toContain('<li id="fn-1">The footnote body. <a href="#fnref-1">↩</a></li>');
      });
    },
  );

  test.openspec('text special characters are HTML-escaped')(
    'text special characters are HTML-escaped',
    async ({ then }: AllureBddContext) => {
      const out = inlineTagsToHtml('a < b && c > d');
      await then('the &, <, and > are entity-escaped', async () => {
        expect(out).toBe('a &lt; b &amp;&amp; c &gt; d');
      });
    },
  );

  test.openspec('a full HTML document is emitted by default')(
    'a full HTML document is emitted by default',
    async ({ then }: AllureBddContext) => {
      const nodes = [node({ tagged_text: 'Hello', heading: { text: 'Hello', source: 'word_style', level: 1 } })];
      const full = serializeToHtml(nodes);
      const fragment = serializeToHtml(nodes, [], { fragment: true });
      await then('the default output is a complete document; fragment omits the wrapper', async () => {
        expect(full).toContain('<!DOCTYPE html>');
        expect(full).toContain('<meta charset="utf-8"/>');
        expect(full).toContain('<title>Hello</title>');
        expect(full).toContain('<body>');
        expect(fragment).not.toContain('<!DOCTYPE html>');
        expect(fragment.trim()).toBe('<h1>Hello</h1>');
      });
    },
  );

  // ── Bonus (no spec scenario): nested-list robustness against the OOXML `ilvl` patterns the
  //    builder must survive — level jumps, interruptions, and same-depth kind changes. ──
  test(
    'a level jump greater than one is clamped to a single nesting step',
    async ({ then }: AllureBddContext) => {
      const html = body([
        node({ tagged_text: 'Top', list_metadata: { list_level: 0, is_auto_numbered: true } }),
        node({ tagged_text: 'Jumped', list_metadata: { list_level: 3, is_auto_numbered: true } }),
      ]);
      await then('only one extra list opens and the markup stays well-formed', async () => {
        expect((html.match(/<ol>/g) ?? []).length).toBe(2);
        expect((html.match(/<ol>/g) ?? []).length).toBe((html.match(/<\/ol>/g) ?? []).length);
        expect((html.match(/<li>/g) ?? []).length).toBe((html.match(/<\/li>/g) ?? []).length);
      });
    },
  );

  test(
    'a paragraph between list items closes the list and a fresh list starts after',
    async ({ then }: AllureBddContext) => {
      const html = body([
        node({ tagged_text: 'Item one', list_metadata: { list_level: 0, is_auto_numbered: true } }),
        node({ tagged_text: 'An interrupting paragraph.' }),
        node({ tagged_text: 'Item two', list_metadata: { list_level: 0, is_auto_numbered: true } }),
      ]);
      await then('the list closes around the paragraph and reopens', async () => {
        expect(html).toContain('<p>An interrupting paragraph.</p>');
        expect((html.match(/<ol>/g) ?? []).length).toBe(2);
        expect((html.match(/<ol>/g) ?? []).length).toBe((html.match(/<\/ol>/g) ?? []).length);
        expect((html.match(/<li>/g) ?? []).length).toBe((html.match(/<\/li>/g) ?? []).length);
      });
    },
  );

  test(
    'a same-depth list-kind change closes the ordered list and opens an unordered one',
    async ({ then }: AllureBddContext) => {
      const html = body([
        node({ tagged_text: 'Numbered', list_metadata: { list_level: 0, is_auto_numbered: true } }),
        node({ tagged_text: 'Bulleted', list_metadata: { list_level: 0, label_type: LabelType.LETTER, label_string: '(a)' } }),
      ]);
      await then('both an <ol> and a <ul> appear and all lists balance', async () => {
        expect(html).toContain('<ol>');
        expect(html).toContain('<ul>');
        expect((html.match(/<ol>/g) ?? []).length).toBe((html.match(/<\/ol>/g) ?? []).length);
        expect((html.match(/<ul>/g) ?? []).length).toBe((html.match(/<\/ul>/g) ?? []).length);
      });
    },
  );

  test(
    'a hostile font face cannot inject extra CSS declarations',
    async ({ then }: AllureBddContext) => {
      // A `;` in the font name would split into a second CSS declaration if left unsanitized.
      const out = inlineTagsToHtml('<font face="Trick; position:fixed">x</font>');
      await then('the injected separator is stripped so only one declaration survives', async () => {
        const style = /<span style="([^"]*)">/.exec(out)?.[1] ?? '';
        expect(out).toContain('</span>');
        expect(style).toContain('font-family');
        expect(style).not.toContain(';'); // injected ';' removed → no second declaration
      });
    },
  );

  test(
    'escaped TOON font attributes are decoded once before safe HTML emission',
    async ({ then }: AllureBddContext) => {
      const out = inlineTagsToHtml(
        '<font face="A&amp;B &quot;Display&quot; &lt;Fallback&gt;">x</font>',
      );

      await then('font semantics survive without double encoding or injected markup', () => {
        expect(out).toBe(
          `<span style="font-family:'A&amp;B Display Fallback'">x</span>`,
        );
        expect(out).not.toContain('&amp;amp;');
      });
    },
  );

  test(
    'repeated items at the same level after a jump are siblings, not nested deeper',
    async ({ then }: AllureBddContext) => {
      const html = body([
        node({ tagged_text: 'Top', list_metadata: { list_level: 0, is_auto_numbered: true } }),
        node({ tagged_text: 'B', list_metadata: { list_level: 2, is_auto_numbered: true } }),
        node({ tagged_text: 'C', list_metadata: { list_level: 2, is_auto_numbered: true } }),
      ]);
      await then('the two level-2 items share one nested list (no extra opening between them)', async () => {
        // Exactly two <ol> open (level 0 + the single clamped nested list shared by B and C).
        expect((html.match(/<ol>/g) ?? []).length).toBe(2);
        // B and C are consecutive <li> with no intervening <ol> (they are siblings).
        expect(html).toMatch(/<li>B\s*<\/li>\s*<li>C/);
        expect((html.match(/<li[ >]/g) ?? []).length).toBe((html.match(/<\/li>/g) ?? []).length);
        expect((html.match(/<ol>/g) ?? []).length).toBe((html.match(/<\/ol>/g) ?? []).length);
      });
    },
  );

  test(
    'unsafe or injected hyperlink markup is neutralized while safe hrefs are rebuilt',
    async ({ then }: AllureBddContext) => {
      const evil = inlineTagsToHtml('<a href="javascript:alert(1)">x</a>');
      const numericLetter = inlineTagsToHtml('<a href="jav&#x61;script:alert(1)">x</a>');
      const numericTab = inlineTagsToHtml('<a href="java&#x09;script:alert(1)">x</a>');
      const injectedAttribute = inlineTagsToHtml(
        '<a href="https://safe.example" onclick="alert(1)">x</a>',
      );
      const safe = inlineTagsToHtml('<a href="https://example.com/p?a=1&amp;b=2">x</a>');
      await then('only a validated and freshly escaped href reaches the output', async () => {
        expect(evil).toBe('<a>x</a>');
        expect(evil).not.toContain('javascript:');
        expect(numericLetter).toBe('<a href="jav&amp;#x61;script:alert(1)">x</a>');
        expect(numericTab).toBe('<a href="java&amp;#x09;script:alert(1)">x</a>');
        expect(injectedAttribute).toBe('<a href="https://safe.example">x</a>');
        expect(safe).toBe('<a href="https://example.com/p?a=1&amp;b=2">x</a>');
      });
    },
  );

  test(
    'footnote ids stay unique and orphan definitions get no dangling back-link',
    async ({ then }: AllureBddContext) => {
      const html = body(
        // [^1] appears twice (duplicate marker); footnote 2 has a definition but no marker.
        [node({ tagged_text: 'See[^1] and again[^1].' })],
        [footnote(1, 'First note.'), footnote(2, 'Orphan note.')],
      );
      await then('the second marker gets a distinct id and the orphan omits its back-link', async () => {
        expect(html).toContain('<sup id="fnref-1">');
        expect(html).toContain('<sup id="fnref-1-2">'); // duplicate marker → unique id
        // Footnote 1 was referenced → its definition links back; footnote 2 was not → no back-link.
        expect(html).toContain('<li id="fn-1">First note. <a href="#fnref-1">↩</a></li>');
        expect(html).toContain('<li id="fn-2">Orphan note.</li>');
        expect(html).not.toContain('#fnref-2');
      });
    },
  );
});
