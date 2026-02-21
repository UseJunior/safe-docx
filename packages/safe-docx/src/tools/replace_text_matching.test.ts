import { describe, expect } from 'vitest';
import { findUniqueSubstringMatch } from '@usejunior/docx-primitives';
import { itAllure, allureStep, allureJsonAttachment } from '../testing/allure-test.js';

const it = itAllure.epic('Matching Engine').withLabels({ feature: 'Replace Text' });

describe('replace_text matching fallbacks (Allure)', () => {
  it('uses exact mode when strings match exactly', async () => {
    const haystack = 'The Purchase Price shall be paid at Closing.';
    const needle = 'Purchase Price';
    let result: ReturnType<typeof findUniqueSubstringMatch>;

    await allureStep('Given paragraph text and old_string with exact substring equality', async () => {
      await allureJsonAttachment('Inputs', { haystack, needle });
    });

    await allureStep('When unique matching runs', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await allureJsonAttachment('Match result', result);
    });

    await allureStep('Then exact mode is selected', async () => {
      expect(result!.status).toBe('unique');
      if (result!.status !== 'unique') return;
      expect(result!.mode).toBe('exact');
      expect(result!.matchedText).toBe('Purchase Price');
    });
  });

  it('falls back to quote_normalized mode for curly-vs-straight quotes', async () => {
    const haystack = '\u201CCompany\u201D means ABC Corp.';
    const needle = '"Company" means ABC Corp.';
    let result: ReturnType<typeof findUniqueSubstringMatch>;

    await allureStep('Given curly quotes in the paragraph and straight quotes in old_string', async () => {
      await allureJsonAttachment('Inputs', { haystack, needle });
    });

    await allureStep('When unique matching runs', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await allureJsonAttachment('Match result', result);
    });

    await allureStep('Then quote_normalized mode is selected with exact source span', async () => {
      expect(result!.status).toBe('unique');
      if (result!.status !== 'unique') return;
      expect(result!.mode).toBe('quote_normalized');
      expect(result!.matchedText).toBe('\u201CCompany\u201D means ABC Corp.');
    });
  });

  it('falls back to flexible_whitespace mode when spacing differs', async () => {
    const haystack = 'The   Purchase   Price';
    const needle = 'The Purchase Price';
    let result: ReturnType<typeof findUniqueSubstringMatch>;

    await allureStep('Given paragraph text with repeated spaces', async () => {
      await allureJsonAttachment('Inputs', { haystack, needle });
    });

    await allureStep('When unique matching runs', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await allureJsonAttachment('Match result', result);
    });

    await allureStep('Then flexible_whitespace mode is selected', async () => {
      expect(result!.status).toBe('unique');
      if (result!.status !== 'unique') return;
      expect(result!.mode).toBe('flexible_whitespace');
      expect(result!.matchedText).toBe('The   Purchase   Price');
    });
  });

  it('falls back to quote_optional mode when only quotes differ in presence', async () => {
    const haystack = 'The defined term is \u201CCompany\u201D.';
    const needle = 'defined term is Company.';
    let result: ReturnType<typeof findUniqueSubstringMatch>;

    await allureStep('Given paragraph text where term is quoted but old_string is not', async () => {
      await allureJsonAttachment('Inputs', { haystack, needle });
    });

    await allureStep('When unique matching runs', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await allureJsonAttachment('Match result', result);
    });

    await allureStep('Then quote_optional mode is selected', async () => {
      expect(result!.status).toBe('unique');
      if (result!.status !== 'unique') return;
      expect(result!.mode).toBe('quote_optional');
      expect(result!.matchedText).toBe('defined term is \u201CCompany\u201D.');
    });
  });
});
