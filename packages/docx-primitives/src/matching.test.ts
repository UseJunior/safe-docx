import { describe, expect } from 'vitest';
import { itAllure as it } from '../test/helpers/allure-test.js';
import { findUniqueSubstringMatch } from './matching.js';

describe('findUniqueSubstringMatch', () => {
  // ── Exact mode ───────────────────────────────────────────────────────
  describe('exact mode', () => {
    it('finds exact substring match', () => {
      const result = findUniqueSubstringMatch('The Purchase Price shall be paid.', 'Purchase Price');
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('exact');
      expect(result.matchedText).toBe('Purchase Price');
      expect(result.start).toBe(4);
      expect(result.end).toBe(18);
    });

    it('returns not_found for absent substring', () => {
      const result = findUniqueSubstringMatch('Hello world', 'missing');
      expect(result.status).toBe('not_found');
    });

    it('returns multiple when substring appears more than once', () => {
      const result = findUniqueSubstringMatch('the the the', 'the');
      expect(result.status).toBe('multiple');
      if (result.status !== 'multiple') return;
      expect(result.matchCount).toBe(3);
      expect(result.mode).toBe('exact');
    });

    it('returns not_found for empty needle', () => {
      const result = findUniqueSubstringMatch('anything', '');
      expect(result.status).toBe('not_found');
    });

    it('matches full haystack as exact', () => {
      const result = findUniqueSubstringMatch('exact match', 'exact match');
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('exact');
      expect(result.start).toBe(0);
      expect(result.end).toBe(11);
    });
  });

  // ── Quote normalized mode ────────────────────────────────────────────
  describe('quote_normalized mode', () => {
    it('matches curly double quotes against straight quotes', () => {
      const result = findUniqueSubstringMatch(
        '\u201CCompany\u201D means ABC Corp.',
        '"Company" means ABC Corp.',
      );
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('quote_normalized');
      expect(result.matchedText).toBe('\u201CCompany\u201D means ABC Corp.');
    });

    it('matches single curly quotes against straight single quotes', () => {
      const result = findUniqueSubstringMatch(
        "the \u2018term\u2019 means",
        "the 'term' means",
      );
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('quote_normalized');
    });

    it('prefers exact over quote_normalized when both match', () => {
      const result = findUniqueSubstringMatch('"hello"', '"hello"');
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('exact');
    });
  });

  // ── Flexible whitespace mode ─────────────────────────────────────────
  describe('flexible_whitespace mode', () => {
    it('matches when haystack has extra spaces', () => {
      const result = findUniqueSubstringMatch('the   quick   brown   fox', 'quick brown fox');
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('flexible_whitespace');
      expect(result.matchedText).toBe('quick   brown   fox');
    });

    it('matches when needle has extra spaces', () => {
      const result = findUniqueSubstringMatch('the quick brown fox', 'quick  brown  fox');
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('flexible_whitespace');
    });

    it('matches tabs and newlines as whitespace', () => {
      const result = findUniqueSubstringMatch('hello\tworld\nfoo', 'hello world foo');
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('flexible_whitespace');
    });
  });

  // ── Quote optional mode ──────────────────────────────────────────────
  describe('quote_optional mode', () => {
    it('matches when haystack has quotes but needle does not', () => {
      const result = findUniqueSubstringMatch(
        'the "Company" means an entity',
        'the Company means an entity',
      );
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('quote_optional');
      expect(result.matchedText).toBe('the "Company" means an entity');
    });

    it('matches when needle has quotes but haystack does not', () => {
      const result = findUniqueSubstringMatch(
        'the Company means an entity',
        'the "Company" means an entity',
      );
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('quote_optional');
      expect(result.matchedText).toBe('the Company means an entity');
    });

    it('matches curly quotes in haystack against no quotes in needle', () => {
      const result = findUniqueSubstringMatch(
        'the \u201CCompany\u201D means an entity',
        'the Company means an entity',
      );
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('quote_optional');
    });
  });
});
