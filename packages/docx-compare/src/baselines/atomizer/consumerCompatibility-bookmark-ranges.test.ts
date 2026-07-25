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
 * The second describe block drives the pass directly, because the boundary cases
 * it covers are hard to reach through a whole comparison: the atomizer is free
 * to align a fixture into a different revision shape than the one under test.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @see https://github.com/UseJunior/safe-docx/issues/641
 * @see https://github.com/UseJunior/safe-docx/issues/643
 */

import { describe, expect } from 'vitest';
import { DocxArchive, childElements, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { enforceConsumerCompatibility } from './consumerCompatibility.js';
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

      await and('Accept All leaves the emptied bookmark in the paragraph flow, not at body level', () => {
        // Keeping the name once its text is gone is safe-docx policy, unchanged
        // by this fix: the pass has always preserved bookmark names so a REF or
        // PAGEREF still resolves. What changes is placement — the emptied range
        // lands at the paragraph merge point instead of detached at body level.
        // Word's own output for this scenario has not been captured, and the
        // repo's LibreOffice oracle drops the bookmark outright on accept, so
        // this asserts our policy rather than a consumer's behavior (issue #641).
        const accepted = acceptAllChanges(documentXml);
        expect(accepted).toContain('w:name="DeletedBoundary"');
        expect(bodyChildTags(accepted)).not.toContain('w:bookmarkStart');
        expect(bodyChildTags(accepted)).not.toContain('w:bookmarkEnd');
      });
    });

    test(`a deleted bookmarked paragraph in a table cell keeps its range in the cell [${mode}]`, async (
      { given, when, then, and }: AllureBddContext
    ) => {
      let documentXml: string;
      const cell = (content: string) =>
        `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr/>${content}</w:tc></w:tr></w:tbl>`;

      await given('a bookmarked paragraph inside a single-cell table', () => {});

      await when(`the cell paragraph is dropped and compared in ${mode} mode`, async () => {
        documentXml = await compare(
          textParagraph('Leading survivor') +
            cell(
              bookmarkedParagraph('44', 'CellBoundary', 'Bookmarked cell text') +
                textParagraph('Cell survivor')
            ),
          textParagraph('Leading survivor') + cell(textParagraph('Cell survivor')),
          mode
        );
      });

      await then('the range wraps the deletion inside the cell paragraph', () => {
        expect(paragraphChildTags(documentXml, 'Bookmarked cell text')).toEqual([
          'w:pPr',
          'w:bookmarkStart',
          'w:del',
          'w:bookmarkEnd',
        ]);
      });

      await and('no marker escapes to body level or to the row/cell level', () => {
        expect(bodyChildTags(documentXml)).not.toContain('w:bookmarkStart');
        const body = bodyOf(documentXml);
        const cellEl = body.getElementsByTagName('w:tc')[0] as Element;
        expect(childElements(cellEl).map((child) => child.tagName)).toEqual([
          'w:tcPr',
          'w:p',
          'w:p',
        ]);
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

      await and('Reject All takes the inserted text away with its paragraph', () => {
        const rejected = rejectAllChanges(documentXml);
        expect(rejected).not.toContain('Bookmarked inserted text');
        // The name outlives the rejected text, per the same policy the deletion
        // case documents; what matters is that it stays in the paragraph flow.
        expect(bodyChildTags(rejected)).not.toContain('w:bookmarkStart');
        expect(bodyChildTags(rejected)).not.toContain('w:bookmarkEnd');
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

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Run the pass over one hand-written paragraph and report where markers landed. */
function markerLayout(paragraphXml: string): { paragraph: string[]; body: string[] } {
  const doc = parseXml(`<w:document xmlns:w="${W_NS}"><w:body>${paragraphXml}</w:body></w:document>`);
  const body = doc.getElementsByTagName('w:body')[0] as Element;
  let nextRevisionId = 900;
  enforceConsumerCompatibility(body, () => nextRevisionId++);
  const paragraph = body.getElementsByTagName('w:p')[0] as Element;
  const label = (child: Element) =>
    child.tagName.startsWith('w:bookmark')
      ? `${child.tagName}#${child.getAttribute('w:id')}`
      : child.tagName;
  return {
    paragraph: childElements(paragraph).map(label),
    body: childElements(body).map(label),
  };
}

describe('Bookmark boundaries relative to an inline revision wrapper', () => {
  test('a range the wrapper encloses is placed around the wrapper', async (
    { given, when, then, and }: AllureBddContext
  ) => {
    let deletion: ReturnType<typeof markerLayout>;
    let move: ReturnType<typeof markerLayout>;

    await given('a w:del and a w:moveFrom that each contain a whole bookmark range', () => {});

    await when('the consumer-compatibility pass runs', () => {
      deletion = markerLayout(
        '<w:p><w:del w:id="1">' +
          '<w:bookmarkStart w:id="52" w:name="Whole"/>' +
          '<w:r><w:delText>all-deleted</w:delText></w:r>' +
          '<w:bookmarkEnd w:id="52"/></w:del></w:p>'
      );
      move = markerLayout(
        '<w:p><w:moveFrom w:id="1" w:name="move1">' +
          '<w:bookmarkStart w:id="53" w:name="Moved"/>' +
          '<w:r><w:t>moved-away</w:t></w:r>' +
          '<w:bookmarkEnd w:id="53"/></w:moveFrom></w:p>'
      );
    });

    await then('the deletion keeps the range spanning the wrapper, not collapsed ahead of it', () => {
      expect(deletion.paragraph).toEqual(['w:bookmarkStart#52', 'w:del', 'w:bookmarkEnd#52']);
      expect(deletion.body).toEqual(['w:p']);
    });

    await and('a move source behaves the same way', () => {
      expect(move.paragraph).toEqual(['w:bookmarkStart#53', 'w:moveFrom', 'w:bookmarkEnd#53']);
    });
  });

  test('a boundary partway inside a wrapper keeps the long-standing placement ahead of it', async (
    { given, when, then, and }: AllureBddContext
  ) => {
    let endInside: ReturnType<typeof markerLayout>;
    let startInside: ReturnType<typeof markerLayout>;

    await given('ranges with exactly one boundary inside a w:del', () => {});

    await when('the consumer-compatibility pass runs', () => {
      endInside = markerLayout(
        '<w:p><w:bookmarkStart w:id="50" w:name="Partial"/>' +
          '<w:r><w:t>kept</w:t></w:r>' +
          '<w:del w:id="1"><w:r><w:delText>inside-range</w:delText></w:r>' +
          '<w:bookmarkEnd w:id="50"/>' +
          '<w:r><w:delText>outside-range</w:delText></w:r></w:del></w:p>'
      );
      startInside = markerLayout(
        '<w:p><w:del w:id="1"><w:r><w:delText>before-range</w:delText></w:r>' +
          '<w:bookmarkStart w:id="51" w:name="PartialStart"/>' +
          '<w:r><w:delText>inside-range</w:delText></w:r></w:del>' +
          '<w:r><w:t>kept</w:t></w:r>' +
          '<w:bookmarkEnd w:id="51"/></w:p>'
      );
    });

    await then('the inside end is anchored before the wrapper, shrinking the range', () => {
      // Neither placement outside the wrapper reproduces the original span, so
      // this keeps the placement the pass has always used rather than swapping
      // one inaccuracy for another. Splitting the wrapper at the boundary is the
      // faithful fix, tracked in issue #643 — update this test when it lands.
      expect(endInside.paragraph).toEqual([
        'w:bookmarkStart#50',
        'w:r',
        'w:bookmarkEnd#50',
        'w:del',
      ]);
    });

    await and('the mirrored case leaves the start before the wrapper too', () => {
      expect(startInside.paragraph).toEqual([
        'w:bookmarkStart#51',
        'w:del',
        'w:r',
        'w:bookmarkEnd#51',
      ]);
    });
  });

  test('a bookmark inside nested revision wrappers lands outside the outermost one', async (
    { given, when, then, and }: AllureBddContext
  ) => {
    let layout: ReturnType<typeof markerLayout>;

    await given('a comparison deletion nested in an earlier author\'s insertion', () => {});

    await when('the consumer-compatibility pass runs', () => {
      layout = markerLayout(
        '<w:p><w:ins w:id="2" w:author="Earlier" w:date="2026-01-01T00:00:00Z">' +
          '<w:del w:id="1">' +
          '<w:bookmarkStart w:id="56" w:name="Nested"/>' +
          '<w:r><w:delText>pre-inserted then deleted</w:delText></w:r>' +
          '<w:bookmarkEnd w:id="56"/>' +
          '</w:del></w:ins></w:p>'
      );
    });

    await then('the range spans the outer wrapper, since either projection removes the content', () => {
      expect(layout.paragraph).toEqual(['w:bookmarkStart#56', 'w:ins', 'w:bookmarkEnd#56']);
    });

    await and('nothing escapes to body level', () => {
      expect(layout.body).toEqual(['w:p']);
    });
  });
});
