import { describe, expect } from 'vitest';
import { findUniqueSubstringMatch } from '../src/primitives/matching.js';
import { itAllure, allureStep, allureJsonAttachment } from './helpers/allure-test.js';

const TEST_FEATURE = 'docx-primitives';

const it = itAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });

const humanReadableIt = it.allure({
  
  tags: ['human-readable'],
  
  parameters: { audience: 'non-technical' },
  
});

describe('Traceability: docx-primitives — Unique Substring Matching', () => {
  humanReadableIt.openspec('exact match found for literal substring')('Scenario: exact match found for literal substring', async () => {
    const haystack = 'The Purchase Price shall be paid at Closing.';
    const needle = 'Purchase Price';

    await allureStep('Given paragraph text containing the needle as a literal substring exactly once', async () => {
      await allureJsonAttachment('Inputs', { haystack, needle });
    });

    const result = await allureStep('When findUniqueSubstringMatch is called', async () => {
      const r = findUniqueSubstringMatch(haystack, needle);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL have status unique and mode exact', () => {
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('exact');
      expect(result.matchedText).toBe('Purchase Price');
    });
  });

  humanReadableIt.openspec('not_found when needle is absent')('Scenario: not_found when needle is absent', async () => {
    const haystack = 'Hello world';
    const needle = 'missing';

    const result = await allureStep('When findUniqueSubstringMatch is called with a needle not present', async () => {
      const r = findUniqueSubstringMatch(haystack, needle);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL have status not_found', () => {
      expect(result.status).toBe('not_found');
    });
  });

  humanReadableIt.openspec('multiple when needle appears more than once')('Scenario: multiple when needle appears more than once', async () => {
    const haystack = 'The Company and the Company agree.';
    const needle = 'Company';

    const result = await allureStep('When findUniqueSubstringMatch is called', async () => {
      const r = findUniqueSubstringMatch(haystack, needle);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL have status multiple', () => {
      expect(result.status).toBe('multiple');
      if (result.status !== 'multiple') return;
      expect(result.matchCount).toBeGreaterThan(1);
    });
  });

  humanReadableIt.openspec('not_found for empty needle')('Scenario: not_found for empty needle', async () => {
    const result = await allureStep('When findUniqueSubstringMatch is called with an empty string needle', async () => {
      const r = findUniqueSubstringMatch('Some text', '');
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL have status not_found', () => {
      expect(result.status).toBe('not_found');
    });
  });

  humanReadableIt.openspec('quote_normalized matches curly quotes against straight quotes')('Scenario: quote_normalized matches curly quotes against straight quotes', async () => {
    const haystack = '\u201CCompany\u201D means ABC Corp.';
    const needle = '"Company" means ABC Corp.';

    const result = await allureStep('When findUniqueSubstringMatch is called', async () => {
      const r = findUniqueSubstringMatch(haystack, needle);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL have status unique and mode quote_normalized', () => {
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('quote_normalized');
    });
  });

  humanReadableIt.openspec('exact mode preferred over quote_normalized when both match')('Scenario: exact mode preferred over quote_normalized when both match', async () => {
    const haystack = '"Company" means ABC Corp.';
    const needle = '"Company" means ABC Corp.';

    const result = await allureStep('When findUniqueSubstringMatch is called', async () => {
      const r = findUniqueSubstringMatch(haystack, needle);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL have mode exact', () => {
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('exact');
    });
  });

  humanReadableIt.openspec('flexible_whitespace matches across spacing variance')('Scenario: flexible_whitespace matches across spacing variance', async () => {
    const haystack = 'The   Purchase   Price';
    const needle = 'The Purchase Price';

    const result = await allureStep('When findUniqueSubstringMatch is called', async () => {
      const r = findUniqueSubstringMatch(haystack, needle);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL have status unique and mode flexible_whitespace', () => {
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('flexible_whitespace');
    });
  });

  humanReadableIt.openspec('quote_optional matches quoted and unquoted term references')('Scenario: quote_optional matches quoted and unquoted term references', async () => {
    const haystack = 'The defined term is \u201CCompany\u201D.';
    const needle = 'defined term is Company.';

    const result = await allureStep('When findUniqueSubstringMatch is called', async () => {
      const r = findUniqueSubstringMatch(haystack, needle);
      await allureJsonAttachment('Result', r);
      return r;
    });

    await allureStep('Then the result SHALL have status unique and mode quote_optional', () => {
      expect(result.status).toBe('unique');
      if (result.status !== 'unique') return;
      expect(result.mode).toBe('quote_optional');
    });
  });
});
