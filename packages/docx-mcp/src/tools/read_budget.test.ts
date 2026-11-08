import { describe, expect, vi } from 'vitest';
import { buildDocumentViewNodes, type CachedParagraph } from '@usejunior/google-docs-core';
import { renderToon, type DocumentViewNode } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { createTestSessionManager, openSession, registerCleanup, assertSuccess } from '../testing/session-test-utils.js';
import { ReadBudget, renderTextWithBudget, renderJsonWithBudget } from './read_budget.js';
import { buildPaginationMeta, estimateTokens } from './pagination.js';
import { readFile } from './read_file.js';
import { gdocsReadFile } from './gdocs/read_file.js';
import { type GDocsSession } from '../session/manager.js';

const TEST_FEATURE = 'refactor-read-pagination-budget';
const test = testAllure.epic('Document Reading').withLabels({ feature: TEST_FEATURE });
const formats = ['toon', 'simple', 'json'] as const;
type Format = typeof formats[number];

function paragraphs(texts: string[]): CachedParagraph[] {
  return texts.map((text, i) => ({ paragraphId: 'NORMAL_TEXT', anchorName: `_bk_${i}`,
    anchorId: `_bk_${i}`, startIndex: i * 10 + 1, endIndex: i * 10 + 9,
    tabId: 't.0', text, inTable: false }));
}
function nodes(texts: string[]): DocumentViewNode[] {
  return buildDocumentViewNodes(paragraphs(texts)) as DocumentViewNode[];
}
function cell(node: DocumentViewNode, row = 0): DocumentViewNode {
  return { ...node, table_context: { table_id: '_tbl_0', table_index: 0, row_index: row,
    col_index: 0, col_header: '', total_rows: 3, total_cols: 1,
    is_header_row: row === 0, para_in_cell: 0, cell_para_count: 1 } };
}
function render(input: DocumentViewNode[], format: Format, budget: number) {
  return format === 'json' ? renderJsonWithBudget(input, budget) : renderTextWithBudget(input, format, budget);
}
function ids(content: string, format: Format): string[] {
  return format === 'json' ? JSON.parse(content).map((node: DocumentViewNode) => node.id)
    : content.split('\n').filter((line) => line.startsWith('_bk_')).map((line) => line.split(' | ')[0]!);
}
function balanced(content: string) {
  expect(content.split('\n').filter((line) => line.startsWith('#TABLE ')).length)
    .toBe(content.split('\n').filter((line) => line === '#END_TABLE').length);
}

describe('shared budget admission', () => {
  registerCleanup();

  test('empty output consumes input, exact boundaries admit, and blocked/exhausted states stay terminal', () => {
    const page = new ReadBudget(1);
    expect(page.admit(0)).toBe(true);
    expect(page.admit(4)).toBe(true);
    expect(page.consumedInput).toBe(2);
    expect(page.renderedCharacters).toBe(4);
    expect(page.admit(5)).toBe(false);
    expect(page.state).toBe('blocked');
    expect(page.admit(0)).toBe(false);
    expect(page.result('abcd')).toEqual({ content: 'abcd', count: 2 });
    expect(page.state).toBe('blocked');
    const empty = new ReadBudget(0);
    expect(empty.result('')).toEqual({ content: '', count: 0 });
    expect(empty.state).toBe('exhausted');
    expect(empty.admit(0)).toBe(false);
  });

  test('render failures leave the source reusable and do not create a partially consumed cursor', () => {
    const input = nodes(['good', 'later']);
    const before = structuredClone(input);
    const failing = { get payload(): string { throw new Error('injected render failure'); } };
    expect(() => renderJsonWithBudget([input[0]!, failing], 10_000)).toThrow('injected render failure');
    expect(input).toEqual(before);
    expect(renderJsonWithBudget(input, 10_000).count).toBe(2);
  });

  for (const format of formats) {
    test(`${format}: empty page, empty text and first oversized node preserve input counts`, () => {
      const empty = render([], format, 1);
      expect(empty.count).toBe(0);
      expect(empty.warnings).toBeUndefined();
      const input = nodes(['', '', 'X'.repeat(1000), 'tail']);
      let start = 0;
      const actual: string[] = [];
      while (start < input.length) {
        const page = render(input.slice(start), format, 1);
        expect(page.count).toBe(1);
        actual.push(...ids(page.content, format));
        start += page.count;
      }
      expect(actual).toEqual(input.map((n) => n.id));
      expect(render(input.slice(2), format, 1).warnings).toEqual(['budget_exceeded_by_first_node']);
    });

    test(`${format}: walk split oversized tables, repeated table IDs, body/list interruptions and empty text`, () => {
      const input = nodes(['before', 'cell-a', 'cell-b', 'X'.repeat(2000), '', 'item', 'cell-c', 'after']);
      input[1] = cell(input[1]!);
      input[2] = cell(input[2]!, 1);
      input[3] = cell(input[3]!, 2);
      input[5]!.list_metadata.list_level = 0;
      input[6] = cell(input[6]!);
      const before = structuredClone(input);
      const reference = input.map((node) => node.id);
      const seen: string[] = [];
      let start = 0;
      let iterations = 0;
      do {
        expect(++iterations).toBeLessThanOrEqual(input.length);
        const page = render(input.slice(start), format, 110);
        expect(page.count).toBeGreaterThan(0);
        const pageIds = ids(page.content, format);
        expect(pageIds.length).toBe(page.count);
        if (format !== 'json') balanced(page.content);
        seen.push(...pageIds);
        const meta = buildPaginationMeta(input.length, page.count, start);
        if (!meta.has_more) break;
        expect(meta.next_offset!).toBeGreaterThan(start + 1);
        expect(meta.next_offset).toBe(start + page.count + 1);
        start = meta.next_offset! - 1;
      } while (true);
      expect(seen).toEqual(reference);
      expect(new Set(seen).size).toBe(input.length);
      expect(input).toEqual(before);
    });

    test(`${format}: first oversized table and exact admission estimates keep format-specific framing`, () => {
      const input = nodes(['X'.repeat(1000), 'tail']);
      input[0] = cell(input[0]!);
      input[1] = cell(input[1]!, 1);
      const page = render(input, format, 1);
      expect(page.count).toBe(1);
      expect(page.warnings).toEqual(['budget_exceeded_by_first_node']);
      if (format !== 'json') balanced(page.content);
      const small = nodes(['a', 'b']);
      // Build the oracle independently of the renderer under test. JSON's
      // per-object indentation and both text schemas are public read contracts.
      const expectedContent = format === 'json'
        ? '[\n' + small.map((node) => JSON.stringify(node, null, 2)).join(',\n') + '\n]'
        : format === 'simple'
          ? '#TOON id | text\n_bk_0 | a\n_bk_1 | b'
          : '#SCHEMA id | list_label | header | style | text\n_bk_0 |  |  | body | a\n_bk_1 |  |  | body | b';
      expect(render(small, format, Infinity).content).toBe(expectedContent);
      // JSON historically omits two closing framing characters for admission.
      const threshold = Math.ceil((expectedContent.length - (format === 'json' ? 2 : 0)) / 4);
      expect(render(small, format, threshold).count).toBe(2);
      expect(render(small, format, threshold - 1).count).toBe(1);
    });

    test(
      `${format}: local cursor walks match the unpaginated order and explicit selectors bypass budgets`, async () => {
        const { mgr, filePath } = await openSession(Array.from({ length: 150 }, (_, i) => `${i}: ${'text '.repeat(120)}`));
        const reference = await readFile(mgr, { file_path: filePath, format, offset: 1 });
        assertSuccess(reference);
        const expected = ids(String(reference.content), format);
        const seen: string[] = [];
        let offset: number | undefined;
        for (let i = 0; i < 151; i++) {
          const page = await readFile(mgr, { file_path: filePath, format, ...(offset ? { offset, limit: 13 } : {}) });
          assertSuccess(page);
          seen.push(...ids(String(page.content), format));
          if (!page.has_more) break;
          expect(Number(page.next_offset)).toBeGreaterThan(offset ?? 1);
          offset = Number(page.next_offset);
        }
        expect(seen).toEqual(expected);
        const selected = await readFile(mgr, { file_path: filePath, format, node_ids: expected });
        assertSuccess(selected);
        expect(Number(selected.paragraphs_returned)).toBe(150);
        const all = await readFile(mgr, { file_path: filePath, format, limit: 150 });
        assertSuccess(all);
        expect(Number(all.paragraphs_returned)).toBe(150);
        expect(estimateTokens(String(reference.content))).toBeGreaterThan(14_000);
        const last = await readFile(mgr, { file_path: filePath, format, offset: -1 });
        assertSuccess(last);
        expect(ids(String(last.content), format)).toEqual(expected.slice(-1));
      },
    );

    test.openspec('Google formats and explicit selectors')(`${format}: Google fakes render the selected format and walk exact cursors with no remote writes`, async () => {
      const input = paragraphs(Array.from({ length: 150 }, (_, i) => `${i}: ${'text '.repeat(120)}`));
      const write = vi.fn(() => { throw new Error('remote write forbidden'); });
      const doc = { getParagraphs: () => input, executeBatchUpdate: write, replaceText: write };
      const session = { doc, docId: 'fake-read-only' } as unknown as GDocsSession;
      const mgr = createTestSessionManager();
      const seen: string[] = [];
      let offset: number | undefined;
      for (let i = 0; i < 151; i++) {
        const page = await gdocsReadFile(mgr, session, { format, ...(offset ? { offset, limit: 11 } : {}) }, {});
        assertSuccess(page);
        const pageIds = ids(String(page.content), format);
        expect(pageIds).toHaveLength(Number(page.paragraphs_returned));
        seen.push(...pageIds);
        if (!page.has_more) break;
        expect(Number(page.next_offset)).toBeGreaterThan(offset ?? 1);
        offset = Number(page.next_offset);
      }
      expect(seen).toEqual(input.map((p) => p.anchorId));
      for (const params of [{ offset: 0 }, { offset: 1 }, { limit: 150 }, { node_ids: seen }]) {
        const all = await gdocsReadFile(mgr, session, { format, ...params }, {});
        assertSuccess(all);
        expect(all.paragraphs_returned).toBe(150);
      }
      input[0]!.text = 'X'.repeat(100_000);
      const oversized = await gdocsReadFile(mgr, session, { format }, {});
      assertSuccess(oversized);
      expect(oversized.paragraphs_returned).toBeGreaterThanOrEqual(1);
      // Simple previews cap the first 100k-character paragraph at 5,000 chars
      // plus an ellipsis; that preview and the next 83 fixture lines fit.
      expect(oversized.paragraphs_returned).toBe(format === 'simple' ? 84 : 1);
      expect(oversized.next_offset).toBe(format === 'simple' ? 85 : 2);
      input.splice(0);
      const empty = await gdocsReadFile(mgr, session, { format }, {});
      assertSuccess(empty);
      expect(empty.paragraphs_returned).toBe(0);
      expect(empty.has_more).toBe(false);
      expect(write).not.toHaveBeenCalled();
    });
  }

  test('Google table fakes preserve continuation markers and propagate read failures without writes', async () => {
    const input = paragraphs(['before', 'X'.repeat(55_850), 'Y'.repeat(55_850), 'after']);
    for (const i of [1, 2]) {
      input[i]!.inTable = true;
      input[i]!.tableMetadata = { tableStartIndex: 10, tableIndex: 0, tableId: '_tbl_0',
        rowIndex: i - 1, colIndex: 0, totalRows: 2, totalCols: 1, isHeaderRow: i === 1,
        paraInCell: 0, cellParaCount: 1, colHeader: '' };
    }
    const doc = { getParagraphs: vi.fn(() => input) };
    const session = { doc, docId: 'fake-tables' } as unknown as GDocsSession;
    const mgr = createTestSessionManager();
    const first = await gdocsReadFile(mgr, session, {}, {});
    assertSuccess(first);
    expect(first.has_more).toBe(true);
    balanced(String(first.content));
    const next = await gdocsReadFile(mgr, session, { offset: Number(first.next_offset) }, {});
    assertSuccess(next);
    balanced(String(next.content));
    expect([...ids(String(first.content), 'toon'), ...ids(String(next.content), 'toon')])
      .toEqual(input.map((p) => p.anchorId));
    doc.getParagraphs.mockImplementationOnce(() => { throw new Error('injected read failure'); });
    const failed = await gdocsReadFile(mgr, session, {}, {});
    expect(failed).toMatchObject({ success: false, error: { code: 'READ_ERROR', message: 'injected read failure' } });
    expect((await gdocsReadFile(mgr, session, { offset: 1 }, {})).success).toBe(true);
  });

  test.openspec('A table spans pages')(
    'text tables close once at a rejected cell and never emit an unadmitted table marker', () => {
      const input = nodes(['small', 'X'.repeat(1000), 'tail']);
      input[0] = cell(input[0]!);
      input[1] = cell(input[1]!, 1);
      for (const format of ['toon', 'simple'] as const) {
        const page = renderTextWithBudget(input, format, 30);
        expect(page.count).toBe(1);
        expect(page.warnings).toBeUndefined();
        expect(page.content.match(/#END_TABLE/g)).toHaveLength(1);
        const afterBody = [nodes(['before'])[0]!, cell(nodes(['X'.repeat(1000)])[0]!)];
        const rejected = renderTextWithBudget(afterBody, format, 30);
        expect(rejected.count).toBe(1);
        expect(rejected.content).not.toContain('#TABLE');
      }
    },
  );

  test.openspec('First node exceeds the budget')(
    'comment endnotes count toward first-node overflow and repeated tables remain separate', () => {
      const input = nodes(['first', 'list', 'last']);
      input[0] = cell(input[0]!);
      input[1]!.list_metadata.list_level = 0;
      input[2] = cell(input[2]!);
      expect(renderTextWithBudget(input, 'toon', Infinity).content).toBe(renderToon(input));
      input[0]!.comments = [{ id: 1, author: 'Test', date: null, initials: 'T', text: 'X'.repeat(1000), replies: [] }];
      const page = renderTextWithBudget(input, 'toon', 100, 'endnotes');
      expect(page.count).toBe(1);
      expect(page.warnings).toEqual(['budget_exceeded_by_first_node']);
      expect(page.content).toContain('#COMMENTS');
      balanced(page.content);
    },
  );
});
