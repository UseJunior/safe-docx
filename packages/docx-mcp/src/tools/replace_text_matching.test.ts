import { describe, expect } from 'vitest';
import { findUniqueSubstringMatch, applyDocumentQuoteStyle } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { replaceText } from './replace_text.js';
import { readFile } from './read_file.js';
import {
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Replace Text Matching' });

describe('replace_text matching fallbacks (Allure)', () => {
  test('uses exact mode when strings match exactly', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const haystack = 'The Purchase Price shall be paid at Closing.';
    const needle = 'Purchase Price';
    let result: ReturnType<typeof findUniqueSubstringMatch>;

    await given('paragraph text and old_string with exact substring equality', async () => {
      await attachPrettyJson('Inputs', { haystack, needle });
    });

    await when('unique matching runs', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await attachPrettyJson('Match result', result);
    });

    await then('exact mode is selected', async () => {
      expect(result!.status).toBe('unique');
      if (result!.status !== 'unique') return;
      expect(result!.mode).toBe('exact');
      expect(result!.matchedText).toBe('Purchase Price');
    });
  });

  test('falls back to quote_normalized mode for curly-vs-straight quotes', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const haystack = '\u201CCompany\u201D means ABC Corp.';
    const needle = '"Company" means ABC Corp.';
    let result: ReturnType<typeof findUniqueSubstringMatch>;

    await given('curly quotes in the paragraph and straight quotes in old_string', async () => {
      await attachPrettyJson('Inputs', { haystack, needle });
    });

    await when('unique matching runs', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await attachPrettyJson('Match result', result);
    });

    await then('quote_normalized mode is selected with exact source span', async () => {
      expect(result!.status).toBe('unique');
      if (result!.status !== 'unique') return;
      expect(result!.mode).toBe('quote_normalized');
      expect(result!.matchedText).toBe('\u201CCompany\u201D means ABC Corp.');
    });
  });

  test('falls back to flexible_whitespace mode when spacing differs', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const haystack = 'The   Purchase   Price';
    const needle = 'The Purchase Price';
    let result: ReturnType<typeof findUniqueSubstringMatch>;

    await given('paragraph text with repeated spaces', async () => {
      await attachPrettyJson('Inputs', { haystack, needle });
    });

    await when('unique matching runs', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await attachPrettyJson('Match result', result);
    });

    await then('flexible_whitespace mode is selected', async () => {
      expect(result!.status).toBe('unique');
      if (result!.status !== 'unique') return;
      expect(result!.mode).toBe('flexible_whitespace');
      expect(result!.matchedText).toBe('The   Purchase   Price');
    });
  });

  test('falls back to quote_optional mode when only quotes differ in presence', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const haystack = 'The defined term is \u201CCompany\u201D.';
    const needle = 'defined term is Company.';
    let result: ReturnType<typeof findUniqueSubstringMatch>;

    await given('paragraph text where term is quoted but old_string is not', async () => {
      await attachPrettyJson('Inputs', { haystack, needle });
    });

    await when('unique matching runs', async () => {
      result = findUniqueSubstringMatch(haystack, needle);
      await attachPrettyJson('Match result', result);
    });

    await then('quote_optional mode is selected', async () => {
      expect(result!.status).toBe('unique');
      if (result!.status !== 'unique') return;
      expect(result!.mode).toBe('quote_optional');
      expect(result!.matchedText).toBe('defined term is \u201CCompany\u201D.');
    });
  });
});

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function makeDocXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

describe('applyDocumentQuoteStyle (Fix 2)', () => {
  registerCleanup();

  test('transfers smart double quotes from document to target text', async () => {
    const source = '\u201CCompany\u201D';
    const target = '"Company" shall';
    const result = applyDocumentQuoteStyle(source, target);
    expect(result).toBe('\u201CCompany\u201D shall');
  });

  test('transfers smart single quotes (apostrophes) from document to target text', async () => {
    const source = 'Company\u2019s';
    const target = "Company's assets";
    const result = applyDocumentQuoteStyle(source, target);
    expect(result).toBe('Company\u2019s assets');
  });

  test('returns unchanged when no smart quotes in source', async () => {
    const source = '"plain"';
    const target = '"plain" text';
    const result = applyDocumentQuoteStyle(source, target);
    expect(result).toBe('"plain" text');
  });

  test('does not convert angle quotes (v1 non-goal)', async () => {
    const source = '\u00ABCompany\u00BB';
    const target = '"Company"';
    const result = applyDocumentQuoteStyle(source, target);
    // Angle quotes should not trigger smart-quote transfer
    expect(result).toBe('"Company"');
  });

  test('integration: replace_text with quote-normalized match transfers smart quotes', async () => {
    // Document has smart quotes, AI provides straight quotes in new_string
    const xml = makeDocXml(
      `<w:p><w:r><w:t>\u201CCompany\u201D means ABC Corp.</w:t></w:r></w:p>`,
    );
    const opened = await openSession([], { xml });
    const paraId = opened.firstParaId;

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: '"Company" means ABC Corp.',
      new_string: '"Company" means XYZ Inc.',
      instruction: 'quote transfer integration test',
    });
    assertSuccess(edited, 'replace with quote transfer');

    // Verify output has smart quotes, not straight
    const session = opened.mgr.getSession(opened.sessionId);
    const afterText = session.doc.getParagraphTextById(paraId);
    expect(afterText).toContain('\u201CCompany\u201D');
    expect(afterText).toContain('XYZ Inc.');
    expect(afterText).not.toContain('"Company"');
  });

  test('markup branch skips quote normalization (preserves tag syntax)', async () => {
    const xml = makeDocXml(
      `<w:p><w:r><w:t>\u201CCompany\u201D means ABC Corp.</w:t></w:r></w:p>`,
    );
    const opened = await openSession([], { xml });
    const paraId = opened.firstParaId;

    // Use markup tags with straight quotes in attribute values — these must NOT be smartened
    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: '\u201CCompany\u201D means ABC Corp.',
      new_string: '<b>"Company"</b> means ABC Corp.',
      instruction: 'markup branch skips quote normalization',
    });
    assertSuccess(edited, 'replace with markup tags');

    const session = opened.mgr.getSession(opened.sessionId);
    const afterText = session.doc.getParagraphTextById(paraId);
    // The text content should contain "Company" (straight quotes from the markup)
    // because quote normalization is skipped for the markup branch
    expect(afterText).toContain('"Company"');
  });
});
