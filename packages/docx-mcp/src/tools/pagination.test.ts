import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { estimateTokens, buildPaginationMeta } from './pagination.js';

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
});
