import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { compareDocuments } from '../../index.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Inplace Original Insertion Provenance Restoration' });

async function compareInplace(originalBody: string, revisedBody: string) {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  const result = await compareDocuments(original, revised);
  expect(result.reconstructionModeUsed).toBe('inplace');

  const documentPart = (await JSZip.loadAsync(result.document)).file('word/document.xml');
  if (!documentPart) throw new Error('comparison result omitted word/document.xml');
  return { result, xml: await documentPart.async('string') };
}

describe('inplace original insertion provenance restoration', () => {
  test('restores an original insertion wrapper around matched plain revised text', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let xml: string;
    let insertions: number;

    await given('matched text that is pre-tracked as inserted only in the original input', () => {});

    await when('the documents are compared through tagged publication', async () => {
      const comparison = await compareInplace(
        '<w:p><w:r><w:t>settled prefix </w:t></w:r>'
          + '<w:ins w:id="17" w:author="Original Reviewer" w:date="2024-03-04T05:06:07Z">'
          + '<w:r><w:t>lineage text</w:t></w:r></w:ins>'
          + '<w:r><w:t> settled suffix</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>settled prefix </w:t></w:r>'
          + '<w:r><w:t>lineage text</w:t></w:r>'
          + '<w:r><w:t> settled suffix</w:t></w:r></w:p>',
      );
      xml = comparison.xml;
      insertions = comparison.result.stats.insertions;
    });

    await then('the matched text is wrapped with its original revision metadata', () => {
      expect(xml).toMatch(
        /<w:ins\b[^>]*w:author="Original Reviewer"[^>]*w:date="2024-03-04T05:06:07Z"[^>]*>[\s\S]*?lineage text[\s\S]*?<\/w:ins>/,
      );
    });

    await and('the range statistics report the comparison wrapper actually emitted', () => {
      expect(insertions).toBe(1);
      expect(xml).toContain('settled prefix ');
      expect(xml).toContain(' settled suffix');
    });
  });
});
