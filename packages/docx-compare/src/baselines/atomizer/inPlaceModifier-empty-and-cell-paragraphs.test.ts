import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { compareDocuments } from '../../index.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Inplace Empty And Table Cell Paragraph Placement' });

async function compareInplace(originalBody: string, revisedBody: string) {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  const result = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode: 'inplace',
  });
  expect(result.reconstructionModeUsed).toBe('inplace');

  const documentPart = (await JSZip.loadAsync(result.document)).file('word/document.xml');
  if (!documentPart) throw new Error('comparison result omitted word/document.xml');
  return { result, xml: await documentPart.async('string') };
}

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/**
 * `CT_Tbl` requires `tblPr` and `tblGrid` before any `w:tr`. Omitting them makes the emitted
 * document.xml fail the ECMA-376 corpus gate (`check_emitted_document_schema.mjs`), because the
 * comparison faithfully reproduces whatever table shape it was given.
 */
const TABLE_PREAMBLE = '<w:tblPr><w:tblW w:w="2400" w:type="dxa"/></w:tblPr>'
  + '<w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>';

describe('inplace empty and table-cell paragraph placement', () => {
  test('tracks an inserted and a deleted empty paragraph by paragraph marks', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let insertedXml: string;
    let deletedXml: string;

    await given('documents that respectively add and remove an empty paragraph between stable text', () => {});

    await when('both pairs are compared using inplace reconstruction', async () => {
      insertedXml = (await compareInplace(
        `${paragraph('before')}<w:p/><w:p/>${paragraph('after')}`,
        `${paragraph('before')}<w:p/><w:p/><w:p/>${paragraph('after')}`,
      )).xml;
      deletedXml = (await compareInplace(
        `${paragraph('before')}<w:p/><w:p/><w:p/>${paragraph('after')}`,
        `${paragraph('before')}<w:p/><w:p/>${paragraph('after')}`,
      )).xml;
    });

    await then('the added empty paragraph receives a paragraph-mark insertion', () => {
      expect(insertedXml).toMatch(/<w:p><w:pPr><w:rPr><w:ins\b[^>]*\/><\/w:rPr><\/w:pPr><\/w:p>/);
    });

    await and('the removed empty paragraph is recreated with a paragraph-mark deletion', () => {
      expect(deletedXml).toMatch(/<w:p><w:pPr><w:rPr><w:del\b[^>]*\/><\/w:rPr><\/w:pPr><\/w:p>/);
      expect(deletedXml).toContain('before');
      expect(deletedXml).toContain('after');
    });
  });

  test('recreates a removed first table-cell paragraph after cell properties', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let xml: string;
    let deletions: number;

    await given('a table cell whose first styled paragraph is removed while its second paragraph survives', () => {});

    await when('the documents are compared using inplace reconstruction', async () => {
      const comparison = await compareInplace(
        `<w:tbl>${TABLE_PREAMBLE}<w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>`
          + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>removed cell heading</w:t></w:r></w:p>'
          + '<w:p><w:r><w:t>cell survivor</w:t></w:r></w:p>'
          + '</w:tc></w:tr></w:tbl>',
        `<w:tbl>${TABLE_PREAMBLE}<w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>`
          + '<w:p><w:r><w:t>cell survivor</w:t></w:r></w:p>'
          + '</w:tc></w:tr></w:tbl>',
      );
      xml = comparison.xml;
      deletions = comparison.result.stats.deletions;
    });

    await then('the deleted heading remains in the same table cell with its alignment', () => {
      expect(deletions).toBeGreaterThan(0);
      expect(xml).toContain('<w:jc w:val="center"/>');
      expect(xml).toContain('<w:delText>removed</w:delText>');
    });

    await and('cell properties remain first and precede the recreated paragraph', () => {
      const cellProperties = xml.indexOf('<w:tcPr>');
      const deletedHeading = xml.indexOf('<w:delText>removed</w:delText>');
      const survivingText = xml.indexOf('<w:t>cell survivor</w:t>');
      expect(cellProperties).toBeGreaterThan(-1);
      expect(cellProperties).toBeLessThan(deletedHeading);
      expect(deletedHeading).toBeLessThan(survivingText);
    });
  });
});
