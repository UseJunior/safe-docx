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
 * A boundary partway inside an inline revision wrapper splits the wrapper at
 * the boundary (attributes copied, fresh `w:id` on the second half), so the
 * range keeps its exact original span instead of shrinking or growing to the
 * nearest wrapper edge (issue #643).
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
): Promise<string> {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  const result = await compareDocumentsAtomizer(original, revised, {
    author: AUTHOR,
    date: DATE,
  });
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

/**
 * Concatenated visible text (`w:t` / `w:delText`) lying between the
 * `w:bookmarkStart` and `w:bookmarkEnd` of range `id`, in document order.
 * This is the text a `REF` field aimed at the bookmark would resolve to.
 */
function rangeText(documentXml: string, id: string): string {
  let inside = false;
  let text = '';
  const visit = (node: Element): void => {
    for (const child of childElements(node)) {
      if (child.tagName === 'w:bookmarkStart' && child.getAttribute('w:id') === id) {
        inside = true;
        continue;
      }
      if (child.tagName === 'w:bookmarkEnd' && child.getAttribute('w:id') === id) {
        inside = false;
        continue;
      }
      if (inside && (child.tagName === 'w:t' || child.tagName === 'w:delText')) {
        text += child.textContent ?? '';
      }
      visit(child);
    }
  };
  visit(bodyOf(documentXml));
  return text;
}

const REVISION_WRAPPER_TAGS = ['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo'] as const;

/** Assert every emitted revision wrapper carries a unique `w:id`. */
function expectUniqueWrapperIds(documentXml: string): void {
  const body = bodyOf(documentXml);
  const ids: string[] = [];
  for (const tag of REVISION_WRAPPER_TAGS) {
    for (const wrapper of Array.from(body.getElementsByTagName(tag)) as Element[]) {
      const id = wrapper.getAttribute('w:id');
      if (id !== null) ids.push(`${tag}#${id}`);
    }
  }
  expect(new Set(ids).size).toBe(ids.length);
}

const ORIGINAL_WITH_BOOKMARKED_PARAGRAPH =
  textParagraph('Leading survivor') +
  bookmarkedParagraph('41', 'DeletedBoundary', 'Bookmarked deleted text', '<w:pPr><w:keepNext/></w:pPr>') +
  textParagraph('Trailing survivor');

const REVISED_WITHOUT_BOOKMARKED_PARAGRAPH =
  textParagraph('Leading survivor') + textParagraph('Trailing survivor');

describe('Bookmark ranges survive paragraph-level revisions', () => {
    test('a deleted bookmarked paragraph keeps its range inside the paragraph', async (
      { given, when, then, and }: AllureBddContext
    ) => {
      let documentXml: string;

      await given('an original paragraph whose whole text is one bookmark range', () => {});

      await when('the paragraph is dropped and the documents are compared', async () => {
        documentXml = await compare(
          ORIGINAL_WITH_BOOKMARKED_PARAGRAPH,
          REVISED_WITHOUT_BOOKMARKED_PARAGRAPH,
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

      await and('Accept All matches the revised source by removing the deleted range', () => {
        // Correction (2026-08-16): this formerly asserted a safe-docx-specific
        // policy that retained an empty bookmark after its paragraph was
        // deleted. That contradicted both the revised source projection and the
        // existing LibreOffice oracle, and orphaned cross-paragraph endpoints.
        const accepted = acceptAllChanges(documentXml);
        expect(accepted).not.toContain('w:name="DeletedBoundary"');
        expect(bodyChildTags(accepted)).not.toContain('w:bookmarkStart');
        expect(bodyChildTags(accepted)).not.toContain('w:bookmarkEnd');
      });
    });

    test('a deleted bookmarked paragraph in a table cell keeps its range in the cell', async (
      { given, when, then, and }: AllureBddContext
    ) => {
      let documentXml: string;
      const cell = (content: string) =>
        `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr/>${content}</w:tc></w:tr></w:tbl>`;

      await given('a bookmarked paragraph inside a single-cell table', () => {});

      await when('the cell paragraph is dropped and compared', async () => {
        documentXml = await compare(
          textParagraph('Leading survivor') +
            cell(
              bookmarkedParagraph('44', 'CellBoundary', 'Bookmarked cell text') +
                textParagraph('Cell survivor')
            ),
          textParagraph('Leading survivor') + cell(textParagraph('Cell survivor')),
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

    test('an inserted bookmarked paragraph keeps its range inside the paragraph', async (
      { given, when, then, and }: AllureBddContext
    ) => {
      let documentXml: string;

      await given('a revision that adds a paragraph whose whole text is one bookmark range', () => {});

      await when('the documents are compared', async () => {
        documentXml = await compare(
          textParagraph('Leading survivor') + textParagraph('Trailing survivor'),
          textParagraph('Leading survivor') +
            bookmarkedParagraph('42', 'InsertedBoundary', 'Bookmarked inserted text') +
            textParagraph('Trailing survivor'),
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

    test('a range spanning out of a deleted paragraph keeps its outside anchor', async (
      { given, when, then, and }: AllureBddContext
    ) => {
      let documentXml: string;

      await given('a bookmark that opens in the deleted paragraph and closes in a survivor', () => {});

      await when('the paragraph is dropped and the documents are compared', async () => {
        documentXml = await compare(
          textParagraph('Leading survivor') +
            '<w:p><w:bookmarkStart w:id="43" w:name="SpanningBoundary"/>' +
            '<w:r><w:t>Bookmarked deleted text</w:t></w:r></w:p>' +
            '<w:p><w:r><w:t>Trailing survivor</w:t></w:r><w:bookmarkEnd w:id="43"/></w:p>',
          textParagraph('Leading survivor') +
            '<w:p><w:r><w:t>Trailing survivor</w:t></w:r><w:bookmarkEnd w:id="43"/></w:p>',
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
  test('a deleted bookmark retains its exact source span in the reject projection', async (
    { given, when, then, and }: AllureBddContext
  ) => {
    let documentXml: string;

    await given('an original whose bookmark ends partway through text the revision deletes', () => {});

    await when('the documents are compared', async () => {
      documentXml = await compare(
        '<w:p><w:bookmarkStart w:id="50" w:name="Partial"/>' +
          '<w:r><w:t>kept inside-range</w:t></w:r>' +
          '<w:bookmarkEnd w:id="50"/>' +
          '<w:r><w:t>outside-range</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>kept</w:t></w:r></w:p>',
      );
    });

    await then('both boundaries use one collision-safe emitted identity', () => {
      const document = parseXml(documentXml);
      const start = document.getElementsByTagName('w:bookmarkStart')[0];
      const end = document.getElementsByTagName('w:bookmarkEnd')[0];
      expect(start?.getAttribute('w:id')).toBeTruthy();
      expect(end?.getAttribute('w:id')).toBe(start?.getAttribute('w:id'));
    });

    await and('Reject All restores the range over exactly its original span', () => {
      const emittedId = parseXml(documentXml)
        .getElementsByTagName('w:bookmarkStart')[0]!.getAttribute('w:id')!;
      const restored = rangeText(rejectAllChanges(documentXml), emittedId);
      expect(restored).toContain('kept');
      expect(restored).toContain('inside-range');
      expect(restored).not.toContain('outside-range');
    });

    await and('Accept All matches the revised source by removing the deleted range', () => {
      expect(acceptAllChanges(documentXml)).not.toContain('w:name="Partial"');
    });

    await and('every emitted revision wrapper keeps a unique w:id', () => {
      expectUniqueWrapperIds(documentXml);
    });
  });

  test('a boundary partway inside a pre-existing deletion splits it in the final document [inplace]', async (
    { given, when, then, and }: AllureBddContext
  ) => {
    let documentXml: string;
    const trackedBody =
      '<w:p><w:bookmarkStart w:id="50" w:name="Partial"/>' +
      '<w:r><w:t>kept</w:t></w:r>' +
      '<w:del w:id="1" w:author="Earlier" w:date="2026-01-01T00:00:00Z">' +
      '<w:r><w:delText>inside-range</w:delText></w:r>' +
      '<w:bookmarkEnd w:id="50"/>' +
      '<w:r><w:delText>outside-range</w:delText></w:r></w:del></w:p>';

    await given('both documents carry a tracked deletion with a bookmark end partway inside', () => {});

    await when('the identical documents are compared in inplace mode', async () => {
      // The inplace pipeline runs its wrapper-merging postprocess passes over
      // this tree, so this asserts end-to-end that none of them re-merge the
      // split halves across the boundary.
      documentXml = await compare(trackedBody, trackedBody);
    });

    await then('the pre-existing wrapper is split with the boundary between the halves', () => {
      expect(paragraphChildTags(documentXml, 'inside-range')).toEqual([
        'w:bookmarkStart',
        'w:r',
        'w:del',
        'w:bookmarkEnd',
        'w:del',
      ]);
    });

    await and('the second half keeps the original author under a fresh w:id', () => {
      const paragraph = bodyOf(documentXml).getElementsByTagName('w:p')[0] as Element;
      const halves = childElements(paragraph).filter((child) => child.tagName === 'w:del');
      expect(halves[0]!.getAttribute('w:id')).toBe('1');
      expect(halves[1]!.getAttribute('w:id')).not.toBe('1');
      expect(halves[1]!.getAttribute('w:author')).toBe('Earlier');
    });

    await and('Reject All restores the range over exactly its original span', () => {
      const restored = rangeText(rejectAllChanges(documentXml), '50');
      expect(restored).toBe('keptinside-range');
    });

    await and('Accept All keeps the range over the surviving text only', () => {
      expect(rangeText(acceptAllChanges(documentXml), '50')).toBe('kept');
    });

    await and('the split half w:id does not collide with the pre-existing wrapper ids', () => {
      expectUniqueWrapperIds(documentXml);
    });
  });
});

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Run the pass over one hand-written paragraph and report where markers landed. */
function markerLayout(
  paragraphXml: string,
  repairBookmarkInventory = true,
): {
  paragraph: string[];
  body: string[];
  paragraphEl: Element;
} {
  const doc = parseXml(`<w:document xmlns:w="${W_NS}"><w:body>${paragraphXml}</w:body></w:document>`);
  const body = doc.getElementsByTagName('w:body')[0] as Element;
  let nextRevisionId = 900;
  enforceConsumerCompatibility(body, () => nextRevisionId++, { repairBookmarkInventory });
  const paragraph = body.getElementsByTagName('w:p')[0] as Element;
  const label = (child: Element) =>
    child.tagName.startsWith('w:bookmark')
      ? `${child.tagName}#${child.getAttribute('w:id')}`
      : child.tagName;
  return {
    paragraph: childElements(paragraph).map(label),
    body: childElements(body).map(label),
    paragraphEl: paragraph,
  };
}

describe('Bookmark boundaries relative to an inline revision wrapper', () => {
  test('tagged projection preserves only ranges with matching revision semantics', () => {
    const enclosed = markerLayout(
      '<w:p><w:del w:id="1">' +
        '<w:bookmarkStart w:id="70" w:name="Enclosed"/>' +
        '<w:r><w:delText>enclosed</w:delText></w:r>' +
        '<w:bookmarkEnd w:id="70"/></w:del></w:p>',
      false,
    );
    const matchingSiblings = markerLayout(
      '<w:p><w:del w:id="1"><w:bookmarkStart w:id="71" w:name="Matching"/>' +
        '<w:r><w:delText>left</w:delText></w:r></w:del>' +
        '<w:del w:id="2"><w:r><w:delText>right</w:delText></w:r>' +
        '<w:sdt><w:sdtContent><w:bookmarkEnd w:id="71"/></w:sdtContent></w:sdt>' +
        '</w:del></w:p>',
      false,
    );
    const mismatched = markerLayout(
      '<w:p><w:del w:id="1"><w:bookmarkStart w:id="72" w:name="Mismatched"/>' +
        '<w:r><w:delText>deleted</w:delText></w:r></w:del>' +
        '<w:ins w:id="2"><w:r><w:t>inserted</w:t></w:r>' +
        '<w:bookmarkEnd w:id="72"/></w:ins></w:p>',
      false,
    );
    const orphan = markerLayout(
      '<w:p><w:del w:id="1"><w:bookmarkStart w:id="73" w:name="Orphan"/>' +
        '<w:r><w:delText>deleted</w:delText></w:r></w:del></w:p>',
      false,
    );
    const missingId = markerLayout(
      '<w:p><w:del w:id="1"><w:bookmarkStart w:name="MissingId"/>' +
        '<w:r><w:delText>deleted</w:delText></w:r></w:del></w:p>',
      false,
    );

    expect(enclosed.paragraph).toEqual(['w:del']);
    expect(enclosed.paragraphEl.getElementsByTagName('w:del')[0]!
      .getElementsByTagName('w:bookmarkStart')).toHaveLength(1);

    expect(matchingSiblings.paragraph).toEqual(['w:del', 'w:del']);
    expect(Array.from(matchingSiblings.paragraphEl.getElementsByTagName('w:del'))
      .map((wrapper) => [
        wrapper.getElementsByTagName('w:bookmarkStart').length,
        wrapper.getElementsByTagName('w:bookmarkEnd').length,
      ])).toEqual([[1, 0], [0, 1]]);

    expect(mismatched.paragraph).toEqual([
      'w:bookmarkStart#72',
      'w:del',
      'w:ins',
      'w:bookmarkEnd#72',
    ]);
    expect(orphan.paragraph).toEqual(['w:bookmarkStart#73', 'w:del']);
    expect(missingId.paragraph).toEqual(['w:bookmarkStart#null', 'w:del']);
  });

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

  test('a boundary partway inside a wrapper splits the wrapper at the boundary', async (
    { given, when, then, and }: AllureBddContext
  ) => {
    let endInside: ReturnType<typeof markerLayout>;
    let startInside: ReturnType<typeof markerLayout>;

    await given('ranges with exactly one boundary inside a w:del', () => {});

    await when('the consumer-compatibility pass runs', () => {
      endInside = markerLayout(
        '<w:p><w:bookmarkStart w:id="50" w:name="Partial"/>' +
          '<w:r><w:t>kept</w:t></w:r>' +
          '<w:del w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z">' +
          '<w:r><w:delText>inside-range</w:delText></w:r>' +
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

    await then('the wrapper is split in two with the end between the halves', () => {
      // Anchoring the end before or after the whole wrapper would shrink or
      // grow the range, because the boundary sat partway through content one
      // projection removes. Splitting keeps the original span exactly
      // (issue #643, superseding the lossy placement pinned before it).
      expect(endInside.paragraph).toEqual([
        'w:bookmarkStart#50',
        'w:r',
        'w:del',
        'w:bookmarkEnd#50',
        'w:del',
      ]);
    });

    await and('the second half copies the wrapper attributes under a fresh w:id', () => {
      const halves = childElements(endInside.paragraphEl).filter(
        (child) => child.tagName === 'w:del'
      );
      expect(halves[0]!.textContent).toBe('inside-range');
      expect(halves[1]!.textContent).toBe('outside-range');
      expect(halves[0]!.getAttribute('w:id')).toBe('1');
      expect(halves[1]!.getAttribute('w:id')).toBe('900');
      expect(halves[1]!.getAttribute('w:author')).toBe('A');
      expect(halves[1]!.getAttribute('w:date')).toBe('2026-01-01T00:00:00Z');
    });

    await and('the mirrored case splits around the inside start the same way', () => {
      expect(startInside.paragraph).toEqual([
        'w:del',
        'w:bookmarkStart#51',
        'w:del',
        'w:r',
        'w:bookmarkEnd#51',
      ]);
      const halves = childElements(startInside.paragraphEl).filter(
        (child) => child.tagName === 'w:del'
      );
      expect(halves[0]!.textContent).toBe('before-range');
      expect(halves[1]!.textContent).toBe('inside-range');
    });
  });

  test('a boundary partway inside a move wrapper splits it too', async (
    { given, when, then }: AllureBddContext
  ) => {
    let layout: ReturnType<typeof markerLayout>;

    await given('a range whose end sits partway inside a w:moveFrom', () => {});

    await when('the consumer-compatibility pass runs', () => {
      layout = markerLayout(
        '<w:p><w:bookmarkStart w:id="54" w:name="MovePartial"/>' +
          '<w:r><w:t>kept</w:t></w:r>' +
          '<w:moveFrom w:id="7" w:author="A" w:date="2026-01-01T00:00:00Z">' +
          '<w:r><w:t>inside-range</w:t></w:r>' +
          '<w:bookmarkEnd w:id="54"/>' +
          '<w:r><w:t>outside-range</w:t></w:r></w:moveFrom></w:p>'
      );
    });

    await then('the move wrapper is split with the end between the halves', () => {
      expect(layout.paragraph).toEqual([
        'w:bookmarkStart#54',
        'w:r',
        'w:moveFrom',
        'w:bookmarkEnd#54',
        'w:moveFrom',
      ]);
      const halves = childElements(layout.paragraphEl).filter(
        (child) => child.tagName === 'w:moveFrom'
      );
      expect(halves[1]!.getAttribute('w:author')).toBe('A');
      expect(halves[1]!.getAttribute('w:id')).not.toBe('7');
    });
  });

  test('an enclosed range and a partial boundary in one wrapper come out in content order', async (
    { given, when, then, and }: AllureBddContext
  ) => {
    let layout: ReturnType<typeof markerLayout>;

    await given('a wrapper holding a partial end followed by a whole enclosed range', () => {});

    await when('the consumer-compatibility pass runs', () => {
      layout = markerLayout(
        '<w:p><w:bookmarkStart w:id="60" w:name="Outer"/>' +
          '<w:r><w:t>lead</w:t></w:r>' +
          '<w:del w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z">' +
          '<w:r><w:delText>up-to-boundary</w:delText></w:r>' +
          '<w:bookmarkEnd w:id="60"/>' +
          '<w:bookmarkStart w:id="61" w:name="Inner"/>' +
          '<w:r><w:delText>enclosed</w:delText></w:r>' +
          '<w:bookmarkEnd w:id="61"/>' +
          '</w:del></w:p>'
      );
    });

    await then('the two ranges stay disjoint instead of crossing', () => {
      // Before the split fix, the partial end and the enclosed start were both
      // dropped in front of the wrapper in a crossing order — legal, since
      // bookmark markers pair by id rather than nesting, but a gratuitous
      // reshuffle of ranges that were disjoint in the input (issue #643).
      expect(layout.paragraph).toEqual([
        'w:bookmarkStart#60',
        'w:r',
        'w:del',
        'w:bookmarkEnd#60',
        'w:bookmarkStart#61',
        'w:del',
        'w:bookmarkEnd#61',
      ]);
    });

    await and('each range still covers exactly its original content', () => {
      const halves = childElements(layout.paragraphEl).filter(
        (child) => child.tagName === 'w:del'
      );
      expect(halves[0]!.textContent).toBe('up-to-boundary');
      expect(halves[1]!.textContent).toBe('enclosed');
    });
  });

  test('adjacent boundaries inside a wrapper do not leave an empty wrapper half behind', async (
    { given, when, then }: AllureBddContext
  ) => {
    let layout: ReturnType<typeof markerLayout>;

    await given('two ranges whose ends sit back to back inside a w:del', () => {});

    await when('the consumer-compatibility pass runs', () => {
      layout = markerLayout(
        '<w:p><w:bookmarkStart w:id="64" w:name="First"/>' +
          '<w:bookmarkStart w:id="65" w:name="Second"/>' +
          '<w:r><w:t>kept</w:t></w:r>' +
          '<w:del w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z">' +
          '<w:r><w:delText>inside</w:delText></w:r>' +
          '<w:bookmarkEnd w:id="64"/>' +
          '<w:bookmarkEnd w:id="65"/>' +
          '<w:r><w:delText>outside</w:delText></w:r></w:del></w:p>'
      );
    });

    await then('one split serves both boundaries, in their original order', () => {
      expect(layout.paragraph).toEqual([
        'w:bookmarkStart#64',
        'w:bookmarkStart#65',
        'w:r',
        'w:del',
        'w:bookmarkEnd#64',
        'w:bookmarkEnd#65',
        'w:del',
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
