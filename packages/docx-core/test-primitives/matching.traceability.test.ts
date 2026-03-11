import { describe, expect } from 'vitest';
import { findUniqueSubstringMatch } from '../src/primitives/matching.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Text Matching' });

describe('Traceability: docx-primitives — Unique Substring Matching', () => {
  test.openspec('exact match found for literal substring')('Scenario: exact match found for literal substring', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const haystack = 'The Purchase Price shall be paid at Closing.';
    const needle = 'Purchase Price';
    let result!: ReturnType<typeof findUniqueSubstringMatch>;

    await given('paragraph text containing the needle as a literal substring exactly once', async () => {
      await attachPrettyJson('Inputs', { haystack, needle });
    });

    await when('findUniqueSubstringMatch is called', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL have status unique and mode exact', () => {
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('exact');
      expect(result.matchedText).toBe('Purchase Price');
    });
  });

  test.openspec('not_found when needle is absent')('Scenario: not_found when needle is absent', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const haystack = 'Hello world';
    const needle = 'missing';
    let result!: ReturnType<typeof findUniqueSubstringMatch>;

    await when('findUniqueSubstringMatch is called with a needle not present', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL have status not_found', () => {
      expect(result.status).toBe('not_found');
    });
  });

  test.openspec('multiple when needle appears more than once')('Scenario: multiple when needle appears more than once', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const haystack = 'The Company and the Company agree.';
    const needle = 'Company';
    let result!: ReturnType<typeof findUniqueSubstringMatch>;

    await when('findUniqueSubstringMatch is called', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL have status multiple', () => {
      expect(result.status).toBe('multiple');
      if (result.status !== 'multiple') return;
      expect(result.matchCount).toBeGreaterThan(1);
    });
  });

  test.openspec('not_found for empty needle')('Scenario: not_found for empty needle', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    let result!: ReturnType<typeof findUniqueSubstringMatch>;

    await when('findUniqueSubstringMatch is called with an empty string needle', async () => {
      result = findUniqueSubstringMatch('Some text', '');
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL have status not_found', () => {
      expect(result.status).toBe('not_found');
    });
  });

  test.openspec('quote_normalized matches curly quotes against straight quotes')('Scenario: quote_normalized matches curly quotes against straight quotes', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const haystack = '\u201CCompany\u201D means ABC Corp.';
    const needle = '"Company" means ABC Corp.';
    let result!: ReturnType<typeof findUniqueSubstringMatch>;

    await when('findUniqueSubstringMatch is called', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL have status unique and mode quote_normalized', () => {
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('quote_normalized');
    });
  });

  test.openspec('exact mode preferred over quote_normalized when both match')('Scenario: exact mode preferred over quote_normalized when both match', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const haystack = '"Company" means ABC Corp.';
    const needle = '"Company" means ABC Corp.';
    let result!: ReturnType<typeof findUniqueSubstringMatch>;

    await when('findUniqueSubstringMatch is called', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL have mode exact', () => {
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('exact');
    });
  });

  test.openspec('flexible_whitespace matches across spacing variance')('Scenario: flexible_whitespace matches across spacing variance', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const haystack = 'The   Purchase   Price';
    const needle = 'The Purchase Price';
    let result!: ReturnType<typeof findUniqueSubstringMatch>;

    await when('findUniqueSubstringMatch is called', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL have status unique and mode flexible_whitespace', () => {
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('flexible_whitespace');
    });
  });

  test.openspec('quote_optional matches quoted and unquoted term references')('Scenario: quote_optional matches quoted and unquoted term references', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const haystack = 'The defined term is \u201CCompany\u201D.';
    const needle = 'defined term is Company.';
    let result!: ReturnType<typeof findUniqueSubstringMatch>;

    await when('findUniqueSubstringMatch is called', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await attachPrettyJson('Result', result);
    });

    await then('the result SHALL have status unique and mode quote_optional', () => {
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('quote_optional');
    });
  });
});
