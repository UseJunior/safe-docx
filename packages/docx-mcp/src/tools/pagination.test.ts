import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  estimateTokens,
  buildPaginationMeta,
  renderWithBudget,
  renderSimpleWithTableMarkers,
  firstNodeOverflowWarnings,
  BUDGET_EXCEEDED_BY_FIRST_NODE_WARNING,
  DEFAULT_CONTENT_TOKEN_BUDGET,
} from './pagination.js';
import type { DocumentViewNode } from '@usejunior/docx-core';

const FEATURE = 'read-file-pagination';

describe('pagination utilities', () => {
  const test = testAllure.epic('Document Reading').withLabels({ feature: FEATURE });

  describe('estimateTokens', () => {
    test('empty string returns 0', async ({ given, when, then }: AllureBddContext) => {
      await given('an empty string', () => {});
      await when('estimateTokens is called', () => {});
      await then('the result is 0', () => { expect(estimateTokens('')).toBe(0); });
    });

    test('4 characters returns 1 token', async ({ given, when, then }: AllureBddContext) => {
      await given('a 4-character string', () => {});
      await when('estimateTokens is called', () => {});
      await then('the result is 1', () => { expect(estimateTokens('abcd')).toBe(1); });
    });

    test('5 characters returns 2 tokens (ceiling)', async ({ given, when, then }: AllureBddContext) => {
      await given('a 5-character string', () => {});
      await when('estimateTokens is called', () => {});
      await then('the ceiling result is 2', () => { expect(estimateTokens('abcde')).toBe(2); });
    });

    test('8 characters returns 2 tokens', async ({ given, when, then }: AllureBddContext) => {
      await given('an 8-character string', () => {});
      await when('estimateTokens is called', () => {});
      await then('the result is 2', () => { expect(estimateTokens('abcdefgh')).toBe(2); });
    });

    test('1 character returns 1 token (ceiling)', async ({ given, when, then }: AllureBddContext) => {
      await given('a 1-character string', () => {});
      await when('estimateTokens is called', () => {});
      await then('the ceiling result is 1', () => { expect(estimateTokens('a')).toBe(1); });
    });
  });

  describe('buildPaginationMeta', () => {
    test('returns has_more: false when all items returned', async ({ given, when, then }: AllureBddContext) => {
      let meta: ReturnType<typeof buildPaginationMeta>;
      await given('total=10, returned=10, startOffset=0', () => {});
      await when('buildPaginationMeta is called', () => { meta = buildPaginationMeta(10, 10, 0); });
      await then('has_more is false with no next_offset or hint', () => {
        expect(meta).toEqual({ has_more: false });
        expect(meta.next_offset).toBeUndefined();
        expect(meta.pagination_hint).toBeUndefined();
      });
    });

    test('returns has_more: true with correct next_offset', async ({ given, when, then }: AllureBddContext) => {
      let meta: ReturnType<typeof buildPaginationMeta>;
      await given('total=100, returned=50, startOffset=0', () => {});
      await when('buildPaginationMeta is called', () => { meta = buildPaginationMeta(100, 50, 0); });
      await then('has_more is true with next_offset=51 and a pagination hint', () => {
        expect(meta.has_more).toBe(true);
        expect(meta.next_offset).toBe(51); // 0 + 50 + 1 = 51 (1-based)
        expect(meta.pagination_hint).toContain('50 of 100');
        expect(meta.pagination_hint).toContain('offset=51');
      });
    });

    test('handles non-zero startOffset correctly', async ({ given, when, then }: AllureBddContext) => {
      let meta: ReturnType<typeof buildPaginationMeta>;
      await given('total=100, returned=30, startOffset=50 (0-based)', () => {});
      await when('buildPaginationMeta is called', () => { meta = buildPaginationMeta(100, 30, 50); });
      await then('has_more is true and next_offset is 81', () => {
        expect(meta.has_more).toBe(true);
        expect(meta.next_offset).toBe(81); // 50 + 30 + 1 = 81 (1-based)
      });
    });

    test('returns has_more: false when last page', async ({ given, when, then }: AllureBddContext) => {
      let meta: ReturnType<typeof buildPaginationMeta>;
      await given('total=100, returned=20, startOffset=80 (last page)', () => {});
      await when('buildPaginationMeta is called', () => { meta = buildPaginationMeta(100, 20, 80); });
      await then('has_more is false', () => { expect(meta).toEqual({ has_more: false }); });
    });
  });

  describe('renderWithBudget and table splitting', () => {
    function makeNode(id: string, text: string, tableContext?: DocumentViewNode['table_context']): DocumentViewNode {
      return {
        id,
        list_label: '',
        header: '',
        style: tableContext ? 'td(0,0)' : 'body',
        text,
        clean_text: text,
        tagged_text: text,
        list_metadata: { list_level: -1, label_type: null, label_string: '', header_text: null, header_style: null, header_formatting: null, is_auto_numbered: false },
        style_fingerprint: { list_level: -1, left_indent_pt: 0, first_line_indent_pt: 0, style_name: 'body', alignment: 'LEFT' },
        paragraph_style_id: null,
        paragraph_style_name: 'body',
        paragraph_alignment: 'LEFT',
        paragraph_indents_pt: { left: 0, first_line: 0 },
        numbering: { num_id: null, ilvl: null, is_auto_numbered: false },
        header_formatting: null,
        body_run_formatting: null,
        table_context: tableContext,
      };
    }

    test('renderWithBudget honors budget for toon format', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof renderWithBudget>;
      const nodes = Array.from({ length: 50 }, (_, i) => makeNode(`p${i}`, `Short paragraph ${i} with text.`));
      await given('50 nodes with short text', () => {});
      await when('renderWithBudget is called with a moderate budget', () => {
        result = renderWithBudget(nodes, { format: 'toon', budget: 100 });
      });
      await then('content is truncated and under budget', () => {
        expect(result.count).toBeLessThan(50);
        expect(result.count).toBeGreaterThan(1);
        expect(result.content).toContain('#SCHEMA');
        expect(estimateTokens(result.content)).toBeLessThanOrEqual(100);
      });
    });

    test('renderWithBudget honors budget for simple format', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof renderWithBudget>;
      const nodes = Array.from({ length: 50 }, (_, i) => makeNode(`p${i}`, `Short simple paragraph ${i}.`));
      await given('50 nodes', () => {});
      await when('renderWithBudget is called with format=simple', () => {
        result = renderWithBudget(nodes, { format: 'simple', budget: 100 });
      });
      await then('content is formatted with #TOON header and truncated under budget', () => {
        expect(result.count).toBeLessThan(50);
        expect(result.count).toBeGreaterThan(1);
        expect(result.content).toContain('#TOON id | text');
        expect(result.content).toContain('p0 |');
        expect(estimateTokens(result.content)).toBeLessThanOrEqual(100);
      });
    });

    test('renderWithBudget honors budget for json format', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof renderWithBudget>;
      const nodes = Array.from({ length: 50 }, (_, i) => makeNode(`p${i}`, 'JSON paragraph content. '.repeat(10)));
      await given('50 nodes', () => {});
      await when('renderWithBudget is called with format=json', () => {
        result = renderWithBudget(nodes, { format: 'json', budget: 100 });
      });
      await then('content is valid JSON array truncated to budget', () => {
        expect(result.count).toBeLessThan(50);
        expect(result.count).toBeGreaterThan(0);
        const parsed = JSON.parse(result.content);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBe(result.count);
      });
    });

    test('first node overflow emits budget warning', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof renderWithBudget>;
      const giantNode = makeNode('p0', 'Giant single node '.repeat(200));
      await given('a giant node that exceeds budget on its own', () => {});
      await when('renderWithBudget is called with tiny budget', () => {
        result = renderWithBudget([giantNode], { budget: 10 });
      });
      await then('returns count 1 and first node overflow warning', () => {
        expect(result.count).toBe(1);
        expect(result.warnings).toEqual([BUDGET_EXCEEDED_BY_FIRST_NODE_WARNING]);
      });
    });

    test('table markers are properly closed when truncated mid-table', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof renderWithBudget>;
      const tableContext: DocumentViewNode['table_context'] = {
        table_index: 0,
        table_id: '_tbl_0',
        row_index: 0,
        col_index: 0,
        col_header: 'Col',
        total_rows: 50,
        total_cols: 2,
        is_header_row: false,
        para_in_cell: 0,
        cell_para_count: 1,
      };
      const nodes = Array.from({ length: 50 }, (_, i) => makeNode(`p${i}`, 'Table cell '.repeat(20), { ...tableContext, row_index: i }));
      await given('table nodes spanning multiple rows', () => {});
      await when('renderWithBudget truncates mid-table', () => {
        result = renderWithBudget(nodes, { format: 'toon', budget: 150 });
      });
      await then('#END_TABLE closes the table properly', () => {
        expect(result.count).toBeLessThan(50);
        expect(result.content).toContain('#TABLE _tbl_0');
        expect(result.content).toContain('#END_TABLE');
      });
    });

    test('nonterminal pages advance with no duplicates and no skips', async ({ given, when, then }: AllureBddContext) => {
      const totalNodes = 30;
      const nodes = Array.from({ length: totalNodes }, (_, i) => makeNode(`p${i}`, `Paragraph ${i} text filler words to take some space.`));
      const collectedIds: string[] = [];
      const budget = 50; // forces multiple pages

      await given('a document of 30 paragraphs and a small page budget', () => {});
      await when('paginating through all pages using next_offset', () => {
        let currentOffset = 1; // 1-based start
        let safetyLoop = 0;
        while (currentOffset <= totalNodes && safetyLoop++ < 100) {
          const startIdx = currentOffset - 1;
          const slice = nodes.slice(startIdx);
          const pageResult = renderWithBudget(slice, { format: 'toon', budget });
          expect(pageResult.count).toBeGreaterThan(0);
          for (let i = 0; i < pageResult.count; i++) {
            collectedIds.push(slice[i]!.id);
          }
          const meta = buildPaginationMeta(totalNodes, pageResult.count, startIdx);
          if (!meta.has_more) break;
          expect(meta.next_offset).toBeDefined();
          expect(meta.next_offset!).toBeGreaterThan(currentOffset);
          currentOffset = meta.next_offset!;
        }
      });
      await then('all 30 paragraphs are collected exactly once in order', () => {
        expect(collectedIds).toHaveLength(totalNodes);
        expect(collectedIds).toEqual(nodes.map((n) => n.id));
      });
    });
  });
});
