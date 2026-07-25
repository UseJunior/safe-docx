import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { compareDocuments } from '../../index.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Inplace Moved Paragraph Bookmark Reconstruction' });

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/**
 * Returns the single `<w:p>` element enclosing `index`.
 *
 * Formatting assertions must be scoped this way: the move destination carries the same
 * `w:pPr` as the recreated source, so a `toContain` check against the whole document body
 * passes off the destination even when the source loses its properties entirely.
 */
function enclosingParagraph(xml: string, index: number): string {
  const start = xml.lastIndexOf('<w:p>', index);
  const end = xml.indexOf('</w:p>', index);
  if (start === -1 || end === -1) throw new Error(`no enclosing w:p for index ${index}`);
  return xml.slice(start, end + '</w:p>'.length);
}

async function compareInplace(originalBody: string, revisedBody: string) {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  const result = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode: 'inplace',
    detectMoves: true,
  });
  expect(result.reconstructionModeUsed).toBe('inplace');

  const documentPart = (await JSZip.loadAsync(result.document)).file('word/document.xml');
  if (!documentPart) throw new Error('comparison result omitted word/document.xml');
  return { result, xml: await documentPart.async('string') };
}

describe('inplace moved paragraph bookmark reconstruction', () => {
  test('recreates a styled bookmarked move source after its preceding paragraph', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let xml: string;

    const movedText = 'Distinctive relocated paragraph contains enough words for reliable move detection';
    const originalMovedParagraph =
      '<w:p><w:pPr><w:keepNext/><w:jc w:val="right"/></w:pPr>'
      + '<w:bookmarkStart w:id="71" w:name="MovedBoundary"/>'
      + `<w:r><w:t>${movedText}</w:t></w:r>`
      + '<w:bookmarkEnd w:id="71"/></w:p>';
    const revisedMovedParagraph =
      '<w:p><w:pPr><w:keepNext/><w:jc w:val="right"/></w:pPr>'
      + `<w:r><w:t>${movedText}</w:t></w:r></w:p>`;

    await given('a styled bookmarked paragraph that moves from the middle to the end', () => {});

    await when('the documents are compared with move detection and inplace reconstruction', async () => {
      ({ xml } = await compareInplace(
        `${paragraph('stable leading paragraph')}${originalMovedParagraph}${paragraph('stable trailing paragraph')}`,
        `${paragraph('stable leading paragraph')}${paragraph('stable trailing paragraph')}${revisedMovedParagraph}`,
      ));
    });

    await then('the comparison emits both source and destination move revisions', () => {
      expect(xml).toContain('<w:moveFromRangeStart');
      expect(xml).toContain('<w:moveFrom ');
      expect(xml).toContain('<w:moveToRangeStart');
      expect(xml).toContain('<w:moveTo ');
    });

    await and('the recreated source paragraph itself retains its formatting', () => {
      const sourceParagraph = enclosingParagraph(xml, xml.indexOf('<w:moveFrom '));
      expect(sourceParagraph).toContain('<w:keepNext/>');
      expect(sourceParagraph).toContain('<w:jc w:val="right"/>');
    });

    await and('the bookmark range stays inside the recreated source, enclosing the moved-out text', () => {
      const sourceParagraph = enclosingParagraph(xml, xml.indexOf('<w:moveFrom '));
      expect(sourceParagraph.match(/<w:bookmarkStart w:id="71"/g)).toHaveLength(1);
      expect(sourceParagraph.match(/<w:bookmarkEnd w:id="71"/g)).toHaveLength(1);
      expect(sourceParagraph.indexOf('<w:bookmarkStart w:id="71"')).toBeLessThan(
        sourceParagraph.indexOf('<w:moveFrom '),
      );
      expect(sourceParagraph.indexOf('<w:bookmarkEnd w:id="71"')).toBeGreaterThan(
        sourceParagraph.lastIndexOf('<w:moveFrom '),
      );
      // The whole document carries exactly one pair — the move destination gets none.
      expect(xml.match(/<w:bookmarkStart w:id="71"/g)).toHaveLength(1);
      expect(xml.match(/<w:bookmarkEnd w:id="71"/g)).toHaveLength(1);
    });

    await and('the source is recreated in its original position, ahead of the destination', () => {
      const source = xml.indexOf('<w:moveFrom ');
      const destination = xml.indexOf('<w:moveTo ');
      expect(source).toBeGreaterThan(xml.indexOf('stable leading paragraph'));
      expect(source).toBeLessThan(xml.indexOf('stable trailing paragraph'));
      expect(xml.indexOf('stable trailing paragraph')).toBeLessThan(destination);
    });
  });

});
