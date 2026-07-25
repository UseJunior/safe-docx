/**
 * Bookmark ranges stay attached to the content they name.
 *
 * The consumer-compatibility pass repositions `w:bookmarkStart` /
 * `w:bookmarkEnd` so a range survives both the Accept All and the Reject All
 * projection. It used to lift both boundaries of a wholly deleted or inserted
 * paragraph out to body level, which is schema-legal but collapses the range to
 * a zero-length span: the bookmark keeps its name and stops covering any text,
 * so a `REF` / `PAGEREF` field aimed at it resolves to nothing.
 *
 * A range whose two boundaries both sit inside the revised paragraph now stays
 * inside it, wrapped around the revision marker. A range with one boundary in
 * surviving content still gets that boundary anchored outside, because the
 * paragraph disappears in one of the two projections.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @see https://github.com/UseJunior/safe-docx/issues/641
 */

import { describe, expect } from 'vitest';
import { DocxArchive, childElements, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import type { ReconstructionMode } from '../../compare-types.js';

const TEST_FEATURE = 'Consumer Compatibility Bookmark Ranges';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: TEST_FEATURE,
    story: 'Bookmark Range Stays Around Revised Content',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' },
  );

const AUTHOR = 'Bookmark Range Test';
const DATE = new Date('2026-07-25T00:00:00Z');

function textParagraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

/** Paragraph whose whole text is enclosed by one bookmark range. */
function bookmarkedParagraph(id: string, name: string, text: string, pPr = ''): string {
  return (
    `<w:p>${pPr}` +
    `<w:bookmarkStart w:id="${id}" w:name="${name}"/>` +
    `<w:r><w:t>${text}</w:t></w:r>` +
    `<w:bookmarkEnd w:id="${id}"/>` +
    `</w:p>`
  );
}

async function compare(
  originalBody: string,
  revisedBody: string,
  reconstructionMode: ReconstructionMode
): Promise<string> {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  const result = await compareDocumentsAtomizer(original, revised, {
    author: AUTHOR,
    date: DATE,
    reconstructionMode,
  });
  expect(result.reconstructionModeUsed).toBe(reconstructionMode);
  return (await DocxArchive.load(result.document)).getDocumentXml();
}

function bodyOf(documentXml: string): Element {
  const doc = parseXml(documentXml);
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) throw new Error('no w:body in document');
  return body as Element;
}

/** Tag names of the direct children of `w:body`, in document order. */
function bodyChildTags(documentXml: string): string[] {
  return childElements(bodyOf(documentXml)).map((child) => child.tagName);
}

/**
 * Tag names of the direct children of the paragraph carrying `text`, in
 * document order, with runs of the same tag collapsed to one entry. Word-level
 * atomization splits a sentence across several sibling `w:r`, and how many it
 * produces is beside the point here.
 */
function paragraphChildTags(documentXml: string, text: string): string[] {
  const body = bodyOf(documentXml);
  for (const paragraph of Array.from(body.getElementsByTagName('w:p')) as Element[]) {
    if (paragraph.textContent?.includes(text)) {
      return childElements(paragraph)
        .map((child) => child.tagName)
        .filter((tag, index, tags) => tag !== tags[index - 1]);
    }
  }
  throw new Error(`no paragraph containing ${JSON.stringify(text)}`);
}

const ORIGINAL_WITH_BOOKMARKED_PARAGRAPH =
  textParagraph('Leading survivor') +
  bookmarkedParagraph('41', 'DeletedBoundary', 'Bookmarked deleted text', '<w:pPr><w:keepNext/></w:pPr>') +
  textParagraph('Trailing survivor');

const REVISED_WITHOUT_BOOKMARKED_PARAGRAPH =
  textParagraph('Leading survivor') + textParagraph('Trailing survivor');

describe('Bookmark ranges survive paragraph-level revisions', () => {
  for (const mode of ['inplace', 'rebuild'] as const) {
    test(`a deleted bookmarked paragraph keeps its range inside the paragraph [${mode}]`, async (
      { given, when, then, and }: AllureBddContext
    ) => {
      let documentXml: string;

      await given('an original paragraph whose whole text is one bookmark range', () => {});

      await when(`the paragraph is dropped and the documents are compared in ${mode} mode`, async () => {
        documentXml = await compare(
          ORIGINAL_WITH_BOOKMARKED_PARAGRAPH,
          REVISED_WITHOUT_BOOKMARKED_PARAGRAPH,
          mode
        );
      });

      await then('no bookmark marker is left stranded at body level', () => {
        expect(bodyChildTags(documentXml)).not.toContain('w:bookmarkStart');
        expect(bodyChildTags(documentXml)).not.toContain('w:bookmarkEnd');
      });

      await and('the range wraps the deletion inside the recreated paragraph', () => {
        expect(paragraphChildTags(documentXml, 'Bookmarked deleted text')).toEqual([
          'w:pPr',
          'w:bookmarkStart',
          'w:del',
          'w:bookmarkEnd',
        ]);
      });

      await and('Reject All restores the range around the restored text', () => {
        const rejected = rejectAllChanges(documentXml);
        expect(paragraphChildTags(rejected, 'Bookmarked deleted text')).toEqual([
          'w:pPr',
          'w:bookmarkStart',
          'w:r',
          'w:bookmarkEnd',
        ]);
      });

      await and('Accept All keeps the emptied bookmark inside a paragraph, not at body level', () => {
        // Word leaves a bookmark in place as a zero-length range when all of the
        // text it covered is deleted; what it never does is detach it from the
        // paragraph flow.
        const accepted = acceptAllChanges(documentXml);
        expect(accepted).toContain('w:name="DeletedBoundary"');
        expect(bodyChildTags(accepted)).not.toContain('w:bookmarkStart');
        expect(bodyChildTags(accepted)).not.toContain('w:bookmarkEnd');
      });
    });

    test(`an inserted bookmarked paragraph keeps its range inside the paragraph [${mode}]`, async (
      { given, when, then, and }: AllureBddContext
    ) => {
      let documentXml: string;

      await given('a revision that adds a paragraph whose whole text is one bookmark range', () => {});

      await when(`the documents are compared in ${mode} mode`, async () => {
        documentXml = await compare(
          textParagraph('Leading survivor') + textParagraph('Trailing survivor'),
          textParagraph('Leading survivor') +
            bookmarkedParagraph('42', 'InsertedBoundary', 'Bookmarked inserted text') +
            textParagraph('Trailing survivor'),
          mode
        );
      });

      await then('no bookmark marker is left stranded at body level', () => {
        expect(bodyChildTags(documentXml)).not.toContain('w:bookmarkStart');
        expect(bodyChildTags(documentXml)).not.toContain('w:bookmarkEnd');
      });

      await and('the range wraps the insertion inside the paragraph', () => {
        const tags = paragraphChildTags(documentXml, 'Bookmarked inserted text');
        expect(tags.filter((tag) => tag !== 'w:pPr' && tag !== 'w:pPrChange')).toEqual([
          'w:bookmarkStart',
          'w:ins',
          'w:bookmarkEnd',
        ]);
      });

      await and('Accept All keeps the range around the accepted text', () => {
        const accepted = acceptAllChanges(documentXml);
        const tags = paragraphChildTags(accepted, 'Bookmarked inserted text');
        expect(tags.filter((tag) => tag !== 'w:pPr')).toEqual([
          'w:bookmarkStart',
          'w:r',
          'w:bookmarkEnd',
        ]);
      });
    });

    test(`a range spanning out of a deleted paragraph keeps its outside anchor [${mode}]`, async (
      { given, when, then, and }: AllureBddContext
    ) => {
      let documentXml: string;

      await given('a bookmark that opens in the deleted paragraph and closes in a survivor', () => {});

      await when(`the paragraph is dropped and the documents are compared in ${mode} mode`, async () => {
        documentXml = await compare(
          textParagraph('Leading survivor') +
            '<w:p><w:bookmarkStart w:id="43" w:name="SpanningBoundary"/>' +
            '<w:r><w:t>Bookmarked deleted text</w:t></w:r></w:p>' +
            '<w:p><w:r><w:t>Trailing survivor</w:t></w:r><w:bookmarkEnd w:id="43"/></w:p>',
          textParagraph('Leading survivor') +
            '<w:p><w:r><w:t>Trailing survivor</w:t></w:r><w:bookmarkEnd w:id="43"/></w:p>',
          mode
        );
      });

      await then('the start is anchored ahead of the deleted paragraph, outside it', () => {
        expect(bodyChildTags(documentXml)).toContain('w:bookmarkStart');
        expect(paragraphChildTags(documentXml, 'Bookmarked deleted text')).not.toContain(
          'w:bookmarkStart'
        );
      });

      await and('the range still covers the surviving text after Accept All', () => {
        const accepted = acceptAllChanges(documentXml);
        expect(accepted).toContain('w:name="SpanningBoundary"');
        expect(paragraphChildTags(accepted, 'Trailing survivor')).toContain('w:bookmarkEnd');
      });
    });
  }
});
