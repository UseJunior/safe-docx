import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { estimateTokens, buildPaginationMeta } from './pagination.js';

const FEATURE = 'read-file-pagination';

describe('pagination utilities', () => {
  const test = testAllure.epic('Document Reading').withLabels({ feature: FEATURE });

  describe('estimateTokens', () => {
    test('empty string returns 0', () => {
      expect(estimateTokens('')).toBe(0);
    });

    test('4 characters returns 1 token', () => {
      expect(estimateTokens('abcd')).toBe(1);
    });

    test('5 characters returns 2 tokens (ceiling)', () => {
      expect(estimateTokens('abcde')).toBe(2);
    });

    test('8 characters returns 2 tokens', () => {
      expect(estimateTokens('abcdefgh')).toBe(2);
    });

    test('1 character returns 1 token (ceiling)', () => {
      expect(estimateTokens('a')).toBe(1);
    });
  });

  describe('buildPaginationMeta', () => {
    test('returns has_more: false when all items returned', () => {
      const meta = buildPaginationMeta(10, 10, 0);
      expect(meta).toEqual({ has_more: false });
      expect(meta.next_offset).toBeUndefined();
      expect(meta.pagination_hint).toBeUndefined();
    });

    test('returns has_more: true with correct next_offset', () => {
      const meta = buildPaginationMeta(100, 50, 0);
      expect(meta.has_more).toBe(true);
      expect(meta.next_offset).toBe(51); // 0 + 50 + 1 = 51 (1-based)
      expect(meta.pagination_hint).toContain('50 of 100');
      expect(meta.pagination_hint).toContain('offset=51');
    });

    test('handles non-zero startOffset correctly', () => {
      // Starting at 0-based index 50, returning 30 items, total 100
      const meta = buildPaginationMeta(100, 30, 50);
      expect(meta.has_more).toBe(true);
      expect(meta.next_offset).toBe(81); // 50 + 30 + 1 = 81 (1-based)
    });

    test('returns has_more: false when last page', () => {
      // Starting at 0-based index 80, returning 20 items, total 100
      const meta = buildPaginationMeta(100, 20, 80);
      expect(meta).toEqual({ has_more: false });
    });
  });
});
