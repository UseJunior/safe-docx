import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { findUniqueSubstringMatch } from '../src/primitives/matching.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Text Matching' });

describe('findUniqueSubstringMatch', () => {
  // ── Exact mode ───────────────────────────────────────────────────────
  describe('exact mode', () => {
    test('finds exact substring match', async ({ given, when, then, and }: AllureBddContext) => {
      let result: ReturnType<typeof findUniqueSubstringMatch>;
      await given('haystack "The Purchase Price shall be paid." and needle "Purchase Price"', async () => {});
      await when('findUniqueSubstringMatch is called', async () => {
        result = findUniqueSubstringMatch('The Purchase Price shall be paid.', 'Purchase Price');
      });
      await then('status is unique with exact mode at offset 4–18', () => {
        expect(result.status).toBe('unique');
        if (result.status !== 'unique') return;
        expect(result.mode).toBe('exact');
        expect(result.matchedText).toBe('Purchase Price');
        expect(result.start).toBe(4);
        expect(result.end).toBe(18);
      });
    });

    test('returns not_found for absent substring', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof findUniqueSubstringMatch>;
      await given('haystack "Hello world" and needle "missing"', async () => {});
      await when('findUniqueSubstringMatch is called', async () => {
        result = findUniqueSubstringMatch('Hello world', 'missing');
      });
      await then('status is not_found', () => {
        expect(result.status).toBe('not_found');
      });
    });

    test('returns multiple when substring appears more than once', async ({ given, when, then, and }: AllureBddContext) => {
      let result: ReturnType<typeof findUniqueSubstringMatch>;
      await given('haystack "the the the" and needle "the"', async () => {});
      await when('findUniqueSubstringMatch is called', async () => {
        result = findUniqueSubstringMatch('the the the', 'the');
      });
      await then('status is multiple with matchCount 3', () => {
        expect(result.status).toBe('multiple');
        if (result.status !== 'multiple') return;
        expect(result.matchCount).toBe(3);
      });
      await and('mode is exact', () => {
        if (result.status !== 'multiple') return;
        expect(result.mode).toBe('exact');
      });
    });

    test('returns not_found for empty needle', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof findUniqueSubstringMatch>;
      await given('haystack "anything" and an empty needle', async () => {});
      await when('findUniqueSubstringMatch is called', async () => {
        result = findUniqueSubstringMatch('anything', '');
      });
      await then('status is not_found', () => {
        expect(result.status).toBe('not_found');
      });
    });

    test('matches full haystack as exact', async ({ given, when, then, and }: AllureBddContext) => {
      let result: ReturnType<typeof findUniqueSubstringMatch>;
      await given('haystack and needle are both "exact match"', async () => {});
      await when('findUniqueSubstringMatch is called', async () => {
        result = findUniqueSubstringMatch('exact match', 'exact match');
      });
      await then('status is unique with exact mode spanning the full string', () => {
        expect(result.status).toBe('unique');
        if (result.status !== 'unique') return;
        expect(result.mode).toBe('exact');
        expect(result.start).toBe(0);
        expect(result.end).toBe(11);
      });
    });
  });

  // ── Quote normalized mode ────────────────────────────────────────────
  describe('quote_normalized mode', () => {
    test('matches curly double quotes against straight quotes', async ({ given, when, then, and }: AllureBddContext) => {
      let result: ReturnType<typeof findUniqueSubstringMatch>;
      await given('haystack with curly double quotes and needle with straight double quotes', async () => {});
      await when('findUniqueSubstringMatch is called', async () => {
        result = findUniqueSubstringMatch(
          '\u201CCompany\u201D means ABC Corp.',
          '"Company" means ABC Corp.',
        );
      });
      await then('status is unique with quote_normalized mode', () => {
        expect(result.status).toBe('unique');
        if (result.status !== 'unique') return;
        expect(result.mode).toBe('quote_normalized');
      });
      await and('matchedText preserves the original curly quotes from the haystack', () => {
        if (result.status !== 'unique') return;
        expect(result.matchedText).toBe('\u201CCompany\u201D means ABC Corp.');
      });
    });

    test('matches single curly quotes against straight single quotes', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof findUniqueSubstringMatch>;
      await given('haystack with curly single quotes and needle with straight single quotes', async () => {});
      await when('findUniqueSubstringMatch is called', async () => {
        result = findUniqueSubstringMatch(
          "the \u2018term\u2019 means",
          "the 'term' means",
        );
      });
      await then('status is unique with quote_normalized mode', () => {
        expect(result.status).toBe('unique');
        if (result.status !== 'unique') return;
        expect(result.mode).toBe('quote_normalized');
      });
    });

    test('prefers exact over quote_normalized when both match', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof findUniqueSubstringMatch>;
      await given('haystack and needle both contain the same straight double quotes', async () => {});
      await when('findUniqueSubstringMatch is called', async () => {
        result = findUniqueSubstringMatch('"hello"', '"hello"');
      });
      await then('status is unique with exact mode preferred over quote_normalized', () => {
        expect(result.status).toBe('unique');
        if (result.status !== 'unique') return;
        expect(result.mode).toBe('exact');
      });
    });
  });

  // ── Flexible whitespace mode ─────────────────────────────────────────
  describe('flexible_whitespace mode', () => {
    test('matches when haystack has extra spaces', async ({ given, when, then, and }: AllureBddContext) => {
      let result: ReturnType<typeof findUniqueSubstringMatch>;
      await given('haystack "the   quick   brown   fox" and needle "quick brown fox"', async () => {});
      await when('findUniqueSubstringMatch is called', async () => {
        result = findUniqueSubstringMatch('the   quick   brown   fox', 'quick brown fox');
      });
      await then('status is unique with flexible_whitespace mode', () => {
        expect(result.status).toBe('unique');
        if (result.status !== 'unique') return;
        expect(result.mode).toBe('flexible_whitespace');
      });
      await and('matchedText reflects the original spacing from the haystack', () => {
        if (result.status !== 'unique') return;
        expect(result.matchedText).toBe('quick   brown   fox');
      });
    });

    test('matches when needle has extra spaces', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof findUniqueSubstringMatch>;
      await given('haystack "the quick brown fox" and needle "quick  brown  fox" with extra spaces', async () => {});
      await when('findUniqueSubstringMatch is called', async () => {
        result = findUniqueSubstringMatch('the quick brown fox', 'quick  brown  fox');
      });
      await then('status is unique with flexible_whitespace mode', () => {
        expect(result.status).toBe('unique');
        if (result.status !== 'unique') return;
        expect(result.mode).toBe('flexible_whitespace');
      });
    });

    test('matches tabs and newlines as whitespace', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof findUniqueSubstringMatch>;
      await given('haystack with tabs and newlines and needle with spaces', async () => {});
      await when('findUniqueSubstringMatch is called', async () => {
        result = findUniqueSubstringMatch('hello\tworld\nfoo', 'hello world foo');
      });
      await then('status is unique with flexible_whitespace mode', () => {
        expect(result.status).toBe('unique');
        if (result.status !== 'unique') return;
        expect(result.mode).toBe('flexible_whitespace');
      });
    });
  });

  // ── Quote optional mode ──────────────────────────────────────────────
  describe('quote_optional mode', () => {
    test('matches when haystack has quotes but needle does not', async ({ given, when, then, and }: AllureBddContext) => {
      let result: ReturnType<typeof findUniqueSubstringMatch>;
      await given('haystack has "Company" in straight quotes and needle has Company unquoted', async () => {});
      await when('findUniqueSubstringMatch is called', async () => {
        result = findUniqueSubstringMatch(
          'the "Company" means an entity',
          'the Company means an entity',
        );
      });
      await then('status is unique with quote_optional mode', () => {
        expect(result.status).toBe('unique');
        if (result.status !== 'unique') return;
        expect(result.mode).toBe('quote_optional');
      });
      await and('matchedText preserves the quoted form from the haystack', () => {
        if (result.status !== 'unique') return;
        expect(result.matchedText).toBe('the "Company" means an entity');
      });
    });

    test('matches when needle has quotes but haystack does not', async ({ given, when, then, and }: AllureBddContext) => {
      let result: ReturnType<typeof findUniqueSubstringMatch>;
      await given('haystack has Company unquoted and needle has "Company" in straight quotes', async () => {});
      await when('findUniqueSubstringMatch is called', async () => {
        result = findUniqueSubstringMatch(
          'the Company means an entity',
          'the "Company" means an entity',
        );
      });
      await then('status is unique with quote_optional mode', () => {
        expect(result.status).toBe('unique');
        if (result.status !== 'unique') return;
        expect(result.mode).toBe('quote_optional');
      });
      await and('matchedText reflects the unquoted form from the haystack', () => {
        if (result.status !== 'unique') return;
        expect(result.matchedText).toBe('the Company means an entity');
      });
    });

    test('matches curly quotes in haystack against no quotes in needle', async ({ given, when, then }: AllureBddContext) => {
      let result: ReturnType<typeof findUniqueSubstringMatch>;
      await given('haystack has \u201CCompany\u201D in curly quotes and needle has Company unquoted', async () => {});
      await when('findUniqueSubstringMatch is called', async () => {
        result = findUniqueSubstringMatch(
          'the \u201CCompany\u201D means an entity',
          'the Company means an entity',
        );
      });
      await then('status is unique with quote_optional mode', () => {
        expect(result.status).toBe('unique');
        if (result.status !== 'unique') return;
        expect(result.mode).toBe('quote_optional');
      });
    });
  });
});
