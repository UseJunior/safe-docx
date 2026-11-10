import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  collectSerializerBlocks,
  iterateSerializerBlocks,
  type SerializerBlock,
} from './serialize_blocks.js';
import type { DocumentViewNode, TableContext } from './document_view.js';
import { LabelType } from './list_labels.js';
import {
  serializeToHtml, serializeToMarkdown, iterateSerializerBlocks as publicIterator,
  collectSerializerBlocks as publicCollector, type SerializerBlockOptions,
} from '../index.js';

const TEST_FEATURE = 'refactor-serializer-block-boundaries';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

test.openspec('public iterator preserves input identity and empty paragraphs')(
  'package-root iterator preserves frozen input and node identity',
  async () => {
    const nodes = Object.freeze([
      createListItem('first'), createNode(), createListItem('last'),
    ].map((node) => Object.freeze(node)));
    const options: SerializerBlockOptions = {};
    const blocks: SerializerBlock[] = [...publicIterator(nodes, options)];
    expect(publicIterator).toBe(iterateSerializerBlocks);
    expect(publicCollector(nodes)).toEqual(blocks);
    expect(blocks.map((block) => block.kind)).toEqual(['list', 'paragraph', 'list']);
    const flattened = blocks.flatMap((block) => 'nodes' in block ? block.nodes : [block.node]);
    flattened.forEach((node, index) => expect(node).toBe(nodes[index]));
  },
);

test.openspec('format-specific list interruptions preserve spacing and labels')(
  'HTML and Markdown close nested lists around blanks, headings and repeated table runs',
  async () => {
    const nodes = [
      createListItem('one', 0, { isAutoNumbered: true }),
      createListItem('deep', 2), createListItem('sibling', 2), createNode(),
      createHeading('Title', 9),
      createTableCell(0, 0, 'first paragraph', { totalCols: 1 }),
      createTableCell(0, 0, 'second paragraph', { totalCols: 1 }),
      createListItem('after', 0, { isAutoNumbered: true }),
      createTableCell(0, 0, 'later table run', { totalCols: 1 }),
      createNode({ tagged_text: 'tail' }),
    ];
    const html = serializeToHtml(nodes, [], { fragment: true });
    expect(html).toBe([
      '<ol>', '<li>one', '<ul>', '<li>deep', '</li>', '<li>sibling', '</li>',
      '</ul>', '</li>', '</ol>', '<h6>Title</h6>',
      '<table>', '<thead>', '<tr><th>first paragraph<br/>second paragraph</th></tr>',
      '</thead>', '<tbody>', '</tbody>', '</table>',
      '<ol>', '<li>after', '</li>', '</ol>',
      '<table>', '<thead>', '<tr><th>later table run</th></tr>',
      '</thead>', '<tbody>', '</tbody>', '</table>', '<p>tail</p>', '',
    ].join('\n'));
    expect(serializeToMarkdown(nodes)).toBe([
      '1. one', '    - deep', '    - sibling', '', '###### Title', '',
      '| first paragraph<br>second paragraph |', '| --- |', '', '1. after', '',
      '| later table run |', '| --- |', '', 'tail', '',
    ].join('\n'));
  },
);

test('table metadata wins over headings and lists; predicate failures leave the input reusable', async () => {
  const cell = createTableCell(0, 0, 'cell');
  cell.heading = { source: 'word_style', level: 2, text: 'cell' };
  cell.list_metadata.list_level = 0;
  const heading = createHeading('both heading and list', 2);
  heading.list_metadata.list_level = 0;
  const nodes = [cell, heading, createListItem('item')];
  const before = structuredClone(nodes);
  expect(collectSerializerBlocks(nodes).map((block) => block.kind)).toEqual(['table', 'heading', 'list']);
  const iterator = iterateSerializerBlocks(nodes, { isHeading: () => { throw new Error('predicate failed'); } });
  expect(iterator.next().value).toMatchObject({ kind: 'table', nodes: [cell] });
  expect(() => iterator.next()).toThrow('predicate failed');
  expect(nodes).toEqual(before);
  expect(collectSerializerBlocks(nodes)).toHaveLength(3);
  expect(collectSerializerBlocks([heading], { headingLevel: () => 4 })[0]).toMatchObject({ level: 4 });
});

// ── Minimal DocumentViewNode factory ────────────────────────────────────────
type NodeOverrides = Omit<Partial<DocumentViewNode>, 'list_metadata'> & {
  list_metadata?: Partial<DocumentViewNode['list_metadata']>;
};

let nodeSeq = 0;
function createNode(overrides: NodeOverrides = {}): DocumentViewNode {
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

function createTableCell(
  rowIndex: number,
  colIndex: number,
  text: string,
  opts: { tableId?: string; isHeader?: boolean; totalCols?: number } = {},
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
  return createNode({ tagged_text: text, table_context: tc });
}

function createListItem(
  text: string,
  level = 0,
  opts: { isAutoNumbered?: boolean; labelString?: string } = {},
): DocumentViewNode {
  return createNode({
    tagged_text: text,
    list_metadata: {
      list_level: level,
      label_type: opts.isAutoNumbered ? LabelType.NUMBER : null,
      label_string: opts.labelString ?? '',
      is_auto_numbered: opts.isAutoNumbered ?? false,
      header_text: null,
      header_style: null,
      header_formatting: null,
    },
  });
}

function createHeading(
  text: string,
  level: number,
  source: 'word_style' | 'run_in_header' = 'word_style',
): DocumentViewNode {
  return createNode({
    tagged_text: text,
    heading: { text, level, source },
  });
}

describe('Document serializer block boundaries (iterateSerializerBlocks)', () => {
  test.openspec('empty node sequence yields no blocks')(
    'empty node sequence yields no blocks',
    async ({ then }: AllureBddContext) => {
      const blocks = collectSerializerBlocks([]);
      await then('yields empty array', () => {
        expect(blocks).toEqual([]);
      });
    },
  );

  test.openspec('contiguous table cells with identical tableId form a single table block')(
    'contiguous table cells with identical tableId form a single table block',
    async ({ then }: AllureBddContext) => {
      const n1 = createTableCell(0, 0, 'Cell A1', { tableId: 't1' });
      const n2 = createTableCell(0, 1, 'Cell B1', { tableId: 't1' });
      const n3 = createTableCell(1, 0, 'Cell A2', { tableId: 't1' });
      const blocks = collectSerializerBlocks([n1, n2, n3]);

      await then('emits exactly one table block containing all contiguous cells', () => {
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toEqual({
          kind: 'table',
          tableId: 't1',
          nodes: [n1, n2, n3],
        });
      });
    },
  );

  test.openspec('repeated noncontiguous table IDs remain separate groups')(
    'repeated noncontiguous table IDs remain separate groups',
    async ({ then }: AllureBddContext) => {
      const t1Cell1 = createTableCell(0, 0, 'Table 1 Run 1', { tableId: 'tbl_alpha' });
      const interveningPara = createNode({ tagged_text: 'Intervening Paragraph' });
      const t1Cell2 = createTableCell(0, 0, 'Table 1 Run 2', { tableId: 'tbl_alpha' });

      const blocks = collectSerializerBlocks([t1Cell1, interveningPara, t1Cell2]);

      await then('emits separate table groups for the noncontiguous table runs', () => {
        expect(blocks).toHaveLength(3);
        expect(blocks[0]).toMatchObject({
          kind: 'table',
          tableId: 'tbl_alpha',
          nodes: [t1Cell1],
        });
        expect(blocks[1]).toMatchObject({
          kind: 'paragraph',
          node: interveningPara,
        });
        expect(blocks[2]).toMatchObject({
          kind: 'table',
          tableId: 'tbl_alpha',
          nodes: [t1Cell2],
        });
      });
    },
  );

  test.openspec('contiguous table cells with different table IDs form separate groups')(
    'contiguous table cells with different table IDs form separate groups',
    async ({ then }: AllureBddContext) => {
      const t1 = createTableCell(0, 0, 'Table 1', { tableId: 't1' });
      const t2 = createTableCell(0, 0, 'Table 2', { tableId: 't2' });

      const blocks = collectSerializerBlocks([t1, t2]);

      await then('emits two adjacent table blocks', () => {
        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toMatchObject({ kind: 'table', tableId: 't1', nodes: [t1] });
        expect(blocks[1]).toMatchObject({ kind: 'table', tableId: 't2', nodes: [t2] });
      });
    },
  );

  test.openspec('word-style headings become heading blocks and heuristic headings stay paragraphs')(
    'word-style headings become heading blocks and heuristic headings stay paragraphs',
    async ({ then }: AllureBddContext) => {
      const structural = createHeading('Chapter 1', 1, 'word_style');
      const heuristic = createHeading('Important note:', 3, 'run_in_header');

      const blocks = collectSerializerBlocks([structural, heuristic]);

      await then('classifies word_style as heading and heuristic as paragraph', () => {
        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toEqual({
          kind: 'heading',
          node: structural,
          level: 1,
        });
        expect(blocks[1]).toEqual({
          kind: 'paragraph',
          node: heuristic,
        });
      });
    },
  );

  test.openspec('custom isHeading predicate preserves format-specific heading rules')(
    'custom isHeading predicate preserves format-specific heading rules',
    async ({ then }: AllureBddContext) => {
      // ODF style: manual label takes precedence over word_style heading
      const manualLabelHeading = createHeading('Section 1.1 Scope', 2, 'word_style');
      manualLabelHeading.list_metadata = {
        list_level: 0,
        label_type: LabelType.SECTION,
        label_string: 'Section 1.1',
        header_text: null,
        header_style: null,
        header_formatting: null,
        is_auto_numbered: false,
      };

      const odfHeadingPredicate = (n: DocumentViewNode): boolean => {
        const hasManualLabel =
          n.list_metadata.list_level >= 0 &&
          !n.list_metadata.is_auto_numbered &&
          n.list_metadata.label_string.trim() !== '';
        return (
          n.heading?.source === 'word_style' &&
          typeof n.heading.level === 'number' &&
          n.heading.level >= 1 &&
          n.heading.level <= 6 &&
          !hasManualLabel
        );
      };

      const blocks = collectSerializerBlocks([manualLabelHeading], {
        isHeading: odfHeadingPredicate,
      });

      await then('treats manual label item as list item rather than heading in ODF mode', () => {
        expect(blocks).toHaveLength(1);
        expect(blocks[0]!.kind).toBe('list');
      });
    },
  );

  test.openspec('contiguous list items are grouped into a single list block defining list boundaries')(
    'contiguous list items are grouped into a single list block defining list boundaries',
    async ({ then }: AllureBddContext) => {
      const item1 = createListItem('First item', 0);
      const item2 = createListItem('Nested item', 1);
      const item3 = createListItem('Second item', 0);

      const blocks = collectSerializerBlocks([item1, item2, item3]);

      await then('groups contiguous items across different levels in a single list block', () => {
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toEqual({
          kind: 'list',
          nodes: [item1, item2, item3],
        });
      });
    },
  );

  test.openspec('lists are split cleanly by intervening paragraphs, headings, and tables')(
    'lists are split cleanly by intervening paragraphs, headings, and tables',
    async ({ then }: AllureBddContext) => {
      const listA1 = createListItem('Item A1');
      const para = createNode({ tagged_text: 'Interruption' });
      const listB1 = createListItem('Item B1');
      const heading = createHeading('Intervening Heading', 2);
      const listC1 = createListItem('Item C1');
      const table = createTableCell(0, 0, 'Cell');
      const listD1 = createListItem('Item D1');

      const blocks = collectSerializerBlocks([
        listA1,
        para,
        listB1,
        heading,
        listC1,
        table,
        listD1,
      ]);

      await then('produces 7 discrete blocks with distinct list runs', () => {
        expect(blocks.map((b) => b.kind)).toEqual([
          'list',
          'paragraph',
          'list',
          'heading',
          'list',
          'table',
          'list',
        ]);
        expect(blocks[0]).toMatchObject({ nodes: [listA1] });
        expect(blocks[2]).toMatchObject({ nodes: [listB1] });
        expect(blocks[4]).toMatchObject({ nodes: [listC1] });
        expect(blocks[6]).toMatchObject({ nodes: [listD1] });
      });
    },
  );

  test.openspec('shouldBreakList hook allows format-specific list boundary splitting')(
    'shouldBreakList hook allows format-specific list boundary splitting',
    async ({ then }: AllureBddContext) => {
      const item1 = createListItem('Item 1');
      const item2 = createListItem('Item 2');
      const item3 = createListItem('Item 3');

      // Break list between item 1 and item 2
      const blocks = collectSerializerBlocks([item1, item2, item3], {
        shouldBreakList: (current) => current.clean_text === 'Item 2',
      });

      await then('splits into two list blocks', () => {
        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toMatchObject({ kind: 'list', nodes: [item1] });
        expect(blocks[1]).toMatchObject({ kind: 'list', nodes: [item2, item3] });
      });
    },
  );

  test.openspec('empty paragraphs are preserved as paragraph blocks')(
    'empty paragraphs are preserved as paragraph blocks',
    async ({ then }: AllureBddContext) => {
      const p1 = createNode({ tagged_text: '' });
      const p2 = createNode({ tagged_text: 'Non-empty' });
      const p3 = createNode({ tagged_text: '   ' });

      const blocks = collectSerializerBlocks([p1, p2, p3]);

      await then('yields each empty and non-empty paragraph as a paragraph block', () => {
        expect(blocks).toHaveLength(3);
        expect(blocks.every((b) => b.kind === 'paragraph')).toBe(true);
      });
    },
  );

  test.openspec('generator and helper produce identical results')(
    'generator and helper produce identical results',
    async ({ then }: AllureBddContext) => {
      const nodes = [
        createHeading('Title', 1),
        createListItem('Bullet A'),
        createListItem('Bullet B'),
        createNode({ tagged_text: 'Paragraph' }),
        createTableCell(0, 0, 'Cell 1', { tableId: 't' }),
        createTableCell(0, 1, 'Cell 2', { tableId: 't' }),
      ];

      const fromCollector = collectSerializerBlocks(nodes);
      const fromIterator = Array.from(iterateSerializerBlocks(nodes));

      await then('both collections match exactly', () => {
        expect(fromCollector).toEqual(fromIterator);
        expect(fromCollector).toHaveLength(4);
      });
    },
  );
});
