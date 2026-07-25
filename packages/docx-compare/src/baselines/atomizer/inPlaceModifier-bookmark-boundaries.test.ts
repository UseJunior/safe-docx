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
 * A deleted paragraph's bookmark range keeps enclosing the content it named.
 *
 * These tests were written against the defect in issue #641: both boundary markers were hoisted
 * out of the paragraph to body level, where they collapsed into a zero-length range. The markers
 * survived by name only, so a cross-reference to the bookmark resolved to an empty span. Body-level
 * bookmarkStart/bookmarkEnd is schema-legal (CT_Body -> EG_BlockLevelElts ->
 * EG_ContentBlockContent -> EG_RunLevelElts), so no validator flagged it; the loss was semantic.
 *
 * They now assert the fixed shape — markers inside the recreated paragraph, wrapped around the
 * `<w:del>` — which matches what the move-source path already produced (see
 * inPlaceModifier-moved-bookmark-paragraph.test.ts).
 *
 * A boundary sitting only PARTWAY inside a revision wrapper is a separate case that still cannot be
 * repositioned faithfully; it is pinned in consumerCompatibility-bookmark-ranges.test.ts and tracked
 * in issue #643.
 */
describe('inplace deleted paragraph bookmark boundaries', () => {
  test('keeps both boundary markers inside the paragraph, wrapped around the deleted text', async ({
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

    await and('the range still covers the deleted text (issue #641)', () => {
      const start = xml.indexOf('<w:bookmarkStart w:id="41"');
      const end = xml.indexOf('<w:bookmarkEnd w:id="41"');
      const deletedText = xml.indexOf('<w:delText>Bookmarked</w:delText>');
      expect(xml.match(/<w:bookmarkStart w:id="41"/g)).toHaveLength(1);
      expect(xml.match(/<w:bookmarkEnd w:id="41"/g)).toHaveLength(1);

      // The deleted text sits between the two boundaries rather than after both of them.
      expect(start).toBeGreaterThan(-1);
      expect(start).toBeLessThan(deletedText);
      expect(end).toBeGreaterThan(deletedText);
      expect(xml.slice(start, end)).toContain('<w:delText>');
    });

    await and('both markers sit inside the paragraph holding the deletion, not at body level', () => {
      const start = xml.indexOf('<w:bookmarkStart w:id="41"');
      const end = xml.indexOf('<w:bookmarkEnd w:id="41"');
      const deletedText = xml.indexOf('<w:delText>Bookmarked</w:delText>');
      const enclosingParagraphStart = xml.lastIndexOf('<w:p>', deletedText);
      const enclosingParagraphEnd = xml.indexOf('</w:p>', deletedText);

      expect(enclosingParagraphStart).toBeLessThan(start);
      expect(enclosingParagraphEnd).toBeGreaterThan(end);
    });
  });

  test('places nested trailing bookmark ends after the deleted fragments, in nesting order', async ({
    given,
    when,
    then,
    and,
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

    await then('both ends follow the last fragment they cover', () => {
      const finalText = xml.indexOf('<w:delText>fragment</w:delText>', xml.indexOf('second'));
      const innerEnd = xml.indexOf('<w:bookmarkEnd w:id="52"');
      const outerEnd = xml.indexOf('<w:bookmarkEnd w:id="51"');
      expect(finalText).toBeGreaterThan(-1);
      expect(innerEnd).toBeGreaterThan(-1);

      expect(innerEnd).toBeGreaterThan(finalText);
      expect(outerEnd).toBeGreaterThan(finalText);
    });

    await and('nesting order survives — inner closes before outer', () => {
      const innerEnd = xml.indexOf('<w:bookmarkEnd w:id="52"');
      const outerEnd = xml.indexOf('<w:bookmarkEnd w:id="51"');
      expect(outerEnd).toBeGreaterThan(innerEnd);
    });

    await and('both starts still precede the deleted fragments, keeping each range non-empty', () => {
      const outerStart = xml.indexOf('<w:bookmarkStart w:id="51"');
      const innerStart = xml.indexOf('<w:bookmarkStart w:id="52"');
      const firstText = xml.indexOf('<w:delText>first</w:delText>');
      expect(outerStart).toBeGreaterThan(-1);
      expect(outerStart).toBeLessThan(innerStart);
      expect(innerStart).toBeLessThan(firstText);
    });
  });
});
