import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { compareDocuments } from '../../index.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Inplace Empty And Table Cell Paragraph Placement' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.37' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.48' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.65' },
  );

async function compareInMode(
  originalBody: string,
  revisedBody: string,
  mode: 'inplace' | 'rebuild',
) {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  const result = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode: mode,
  });
  expect(result.reconstructionModeUsed).toBe(mode);

  const documentPart = (await JSZip.loadAsync(result.document)).file('word/document.xml');
  if (!documentPart) throw new Error('comparison result omitted word/document.xml');
  return { result, xml: await documentPart.async('string') };
}

async function compareInplace(originalBody: string, revisedBody: string) {
  return compareInMode(originalBody, revisedBody, 'inplace');
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

/**
 * Empty-paragraph identity must be positional only: a `w:pPr` carries no
 * visible content (OOXML `CT_PPrBase` permits no attributes, so the only
 * attributes it carries in practice are namespace declarations), and folding
 * its serialization shape into identity produced phantom paragraph-mark
 * delete+insert pairs. Paragraph-property change detection is deferred to a
 * dedicated concern so empty and non-empty paragraphs behave consistently.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/678
 * @see https://github.com/UseJunior/safe-docx/issues/679
 */
describe('empty-paragraph w:pPr serialization phantoms', () => {
  const anchor = paragraph('Anchor paragraph text.');
  const W_NS_DECL =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

  const phantomPairs = [
    {
      name: 'bare w:pPr versus absent w:pPr',
      original: `${anchor}<w:p/>`,
      revised: `${anchor}<w:p><w:pPr/></w:p>`,
      // Neither side carries revision markup, so none may be invented.
      expectNoParagraphMarkRevision: true,
    },
    {
      name: 'inherited versus locally redeclared w namespace binding',
      original: `${anchor}<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>`,
      revised: `${anchor}<w:p><w:pPr ${W_NS_DECL}><w:jc w:val="center"/></w:pPr></w:p>`,
      expectNoParagraphMarkRevision: true,
    },
    {
      // Pre-existing paragraph-mark revision markup must be preserved
      // untouched, so here we assert only that no comparison-authored
      // changes appear — not that the markup is absent.
      name: 'paragraph-mark revision metadata differing only in provenance',
      original: `${anchor}<w:p><w:pPr><w:rPr><w:ins w:id="1" w:author="A" w:date="2024-01-01T00:00:00Z"/></w:rPr></w:pPr></w:p>`,
      revised: `${anchor}<w:p><w:pPr><w:rPr><w:ins w:id="99" w:author="B" w:date="2026-06-30T00:00:00Z"/></w:rPr></w:pPr></w:p>`,
      expectNoParagraphMarkRevision: false,
    },
  ];

  for (const pair of phantomPairs) {
    for (const mode of ['inplace', 'rebuild'] as const) {
      test(`treats ${pair.name} as equal in ${mode} mode`, async ({
        given,
        when,
        then,
        and,
      }: AllureBddContext) => {
        let xml: string;
        let stats: { insertions: number; deletions: number };

        await given('two formatting-equivalent documents differing only in w:pPr serialization', () => {});

        await when(`the documents are compared using ${mode} reconstruction`, async () => {
          const comparison = await compareInMode(pair.original, pair.revised, mode);
          xml = comparison.xml;
          stats = comparison.result.stats;
        });

        await then('the comparison reports zero changes', () => {
          expect(stats.insertions).toBe(0);
          expect(stats.deletions).toBe(0);
        });

        await and('the emitted document carries no comparison-authored paragraph revision markup', () => {
          expect(xml).not.toContain('<w:pPrChange');
          if (pair.expectNoParagraphMarkRevision) {
            expect(xml).not.toMatch(/<w:rPr><w:(ins|del)\b[^>]*\/><\/w:rPr>/);
          }
        });
      });
    }
  }
});

/**
 * A deleted body-level paragraph whose insertion anchor is an Equal empty
 * paragraph inside a preceding table cell must be re-anchored after the
 * table, not dropped into the cell as the anchor's sibling. Regression for
 * the anchor-hoisting fix in findTargetContainerForAtom.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/678
 */
describe('deleted body paragraph after equal table-cell empties', () => {
  test('keeps the deleted paragraph at body level after the table', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let xml: string;
    let stats: { insertions: number; deletions: number };

    const emptyCellRows = `<w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p/></w:tc></w:tr>`.repeat(2);
    const table =
      `<w:tbl>${TABLE_PREAMBLE}` +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${paragraph('Header cell')}</w:tc></w:tr>` +
      emptyCellRows +
      `</w:tbl>`;

    await given('a table with equal empty cells followed by a body paragraph deleted in the revision', () => {});

    await when('the documents are compared using inplace reconstruction', async () => {
      const comparison = await compareInMode(
        `${table}${paragraph('Removed body paragraph')}${paragraph('END')}`,
        `${table}${paragraph('END')}`,
        'inplace',
      );
      xml = comparison.xml;
      stats = comparison.result.stats;
    });

    await then('the removed paragraph is emitted as a deletion', () => {
      expect(stats.deletions).toBeGreaterThan(0);
      expect(xml).toContain('<w:delText>Removed</w:delText>');
    });

    await and('the deleted paragraph sits at body level between the table and the following text', () => {
      const deletedAt = xml.indexOf('<w:delText>Removed</w:delText>');
      const tableClose = xml.indexOf('</w:tbl>');
      const endText = xml.indexOf('END');
      expect(tableClose).toBeGreaterThan(-1);
      expect(deletedAt).toBeGreaterThan(tableClose);
      expect(deletedAt).toBeLessThan(endText);
      // Not inside any table cell: every <w:tc> opened before it is closed.
      const before = xml.slice(0, deletedAt);
      const opened = (before.match(/<w:tc[ >]/g) ?? []).length;
      const closed = (before.match(/<\/w:tc>/g) ?? []).length;
      expect(opened).toBe(closed);
    });
  });
});
