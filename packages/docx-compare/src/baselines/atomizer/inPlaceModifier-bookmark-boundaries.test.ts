import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { compareDocuments } from '../../index.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Inplace Deleted Paragraph Bookmark Boundaries' });

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

/**
 * Characterization of KNOWN-DEFECTIVE behavior — see issue #641.
 *
 * When a deleted paragraph's text was enclosed by bookmark boundary markers, the markers are
 * hoisted out of the paragraph to body level and collapse into a zero-length range that no
 * longer covers the text it named. The markers survive by name only; a cross-reference to the
 * bookmark resolves to an empty span.
 *
 * These tests pin what the engine does today so the behavior cannot change unnoticed. They do
 * NOT endorse it. When #641 is fixed, they must be rewritten to assert that the bookmark range
 * still encloses the recreated `<w:del>` content — the way the move-source path already does
 * (see inPlaceModifier-moved-bookmark-paragraph.test.ts).
 *
 * Body-level bookmarkStart/bookmarkEnd is schema-legal (CT_Body -> EG_BlockLevelElts ->
 * EG_ContentBlockContent -> EG_RunLevelElts), so no validator flags this; the loss is semantic.
 */
describe('inplace deleted paragraph bookmark boundaries', () => {
  test('DEFECT #641: hoists both boundary markers to body level, detaching the bookmark from the deleted text', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let xml: string;
    let deletions: number;

    await given('a removed paragraph whose text is enclosed by direct bookmark boundary markers', () => {});

    await when('the documents are compared using inplace reconstruction', async () => {
      const comparison = await compareInplace(
        '<w:p><w:r><w:t>Leading survivor</w:t></w:r></w:p>'
          + '<w:p><w:pPr><w:keepNext/></w:pPr>'
          + '<w:bookmarkStart w:id="41" w:name="DeletedBoundary"/>'
          + '<w:r><w:t>Bookmarked deleted text</w:t></w:r>'
          + '<w:bookmarkEnd w:id="41"/></w:p>'
          + '<w:p><w:r><w:t>Trailing survivor</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>Leading survivor</w:t></w:r></w:p>'
          + '<w:p><w:r><w:t>Trailing survivor</w:t></w:r></w:p>',
      );
      xml = comparison.xml;
      deletions = comparison.result.stats.deletions;
    });

    await then('the deletion is recorded and retains the original paragraph property', () => {
      expect(deletions).toBeGreaterThan(0);
      expect(xml).toContain('<w:keepNext/>');
      expect(xml).toContain('<w:delText>Bookmarked</w:delText>');
    });

    await and('DEFECT #641: the markers collapse to an empty range outside the deleted paragraph', () => {
      const start = xml.indexOf('<w:bookmarkStart w:id="41"');
      const end = xml.indexOf('<w:bookmarkEnd w:id="41"');
      const deletedText = xml.indexOf('<w:delText>Bookmarked</w:delText>');
      expect(xml.match(/<w:bookmarkStart w:id="41"/g)).toHaveLength(1);
      expect(xml.match(/<w:bookmarkEnd w:id="41"/g)).toHaveLength(1);

      // Both markers land before the recreated paragraph, so the range spans no content at all.
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThan(deletedText);
      expect(xml.slice(start, end)).not.toContain('<w:delText>');

      // ...and they sit at body level rather than inside the paragraph holding the deletion.
      const enclosingParagraphStart = xml.lastIndexOf('<w:p>', deletedText);
      expect(enclosingParagraphStart).toBeGreaterThan(end);
    });
  });

  test('DEFECT #641: hoists nested trailing bookmark ends ahead of the deleted fragments, preserving only their relative order', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml: string;

    await given('a removed multi-run paragraph ending two nested bookmarks', () => {});

    await when('the documents are compared using inplace reconstruction', async () => {
      ({ xml } = await compareInplace(
        '<w:p><w:bookmarkStart w:id="51" w:name="Outer"/>'
          + '<w:bookmarkStart w:id="52" w:name="Inner"/>'
          + '<w:r><w:t>first deleted fragment</w:t></w:r>'
          + '<w:r><w:t>second deleted fragment</w:t></w:r>'
          + '<w:bookmarkEnd w:id="52"/><w:bookmarkEnd w:id="51"/></w:p>'
          + '<w:p><w:r><w:t>survivor</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>survivor</w:t></w:r></w:p>',
      ));
    });

    await then('both ends precede the fragments they should follow, but stay in nesting order', () => {
      const finalText = xml.indexOf('<w:delText>fragment</w:delText>', xml.indexOf('second'));
      const innerEnd = xml.indexOf('<w:bookmarkEnd w:id="52"');
      const outerEnd = xml.indexOf('<w:bookmarkEnd w:id="51"');
      expect(finalText).toBeGreaterThan(-1);
      expect(innerEnd).toBeGreaterThan(-1);

      // Correct output would place both ends AFTER the final fragment. They precede it instead.
      expect(innerEnd).toBeLessThan(finalText);
      expect(outerEnd).toBeLessThan(finalText);

      // The one property the hoisting does keep: inner closes before outer.
      expect(outerEnd).toBeGreaterThan(innerEnd);
    });
  });
});
