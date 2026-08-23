import { describe, expect } from 'vitest';
import { parseXml } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import {
  completeField,
  FIELD_INSTRUCTIONS,
  paragraphWithField,
} from '../testing/ooxml-fixtures.js';
import {
  buildTaggedTreePublication,
  type TaggedTreePublication,
} from './taggedTreeShadow.js';
import { COMPARISON_REVISION_ATTRIBUTE } from './taggedTreeSerializer.js';

const TEST_FEATURE = 'refactor-tagged-tree-redline-construction';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const transformationTest = test.openspec('Serialized wrapper transformations determine range totals');
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AUTHOR = 'Range Statistics';
const DATE = new Date('2026-08-23T12:00:00Z');

function documentWithBody(body: string): string {
  return `<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`;
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function table(rowTexts: readonly string[]): string {
  return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
    + '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>'
    + rowTexts.map((text) =>
    `<w:tr><w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`,
    ).join('')
    + '</w:tbl>';
}

function publish(
  originalBody: string,
  revisedBody: string,
  options: Partial<Parameters<typeof buildTaggedTreePublication>[0]> = {},
): TaggedTreePublication {
  return buildTaggedTreePublication({
    originalXml: documentWithBody(originalBody),
    revisedXml: documentWithBody(revisedBody),
    author: AUTHOR,
    date: DATE,
    retainStatisticsMarkers: true,
    ...options,
  });
}

function generatedElements(publication: TaggedTreePublication, localName: string): Element[] {
  return Array.from(parseXml(publication.xml).getElementsByTagNameNS(W_NS, localName))
    .filter((element) => element.getAttribute(COMPARISON_REVISION_ATTRIBUTE) === '1');
}

function expectRetainedMarkersAndStatsAliasesAgree(
  publication: TaggedTreePublication,
  options: { assertFormatting?: boolean } = {},
): void {
  const inserted = generatedElements(publication, 'ins');
  const deleted = generatedElements(publication, 'del');
  const movedFrom = generatedElements(publication, 'moveFrom');
  const movedTo = generatedElements(publication, 'moveTo');

  expect(publication.stats.insertions).toBe(inserted.length);
  expect(publication.stats.deletions).toBe(deleted.length);
  // Pin both historical aliases to the same final-wrapper source of truth.
  expect(publication.stats.insertedRanges).toBe(inserted.length);
  expect(publication.stats.deletedRanges).toBe(deleted.length);
  expect(publication.serializedRangeStats).toEqual({
    insertedRanges: inserted.length,
    deletedRanges: deleted.length,
    moveFromRanges: movedFrom.length,
    moveToRanges: movedTo.length,
  });
  if (options.assertFormatting !== false) {
    const propertyChanges = generatedElements(publication, 'rPrChange').length
      + generatedElements(publication, 'pPrChange').length;
    expect(publication.stats.formatChanges).toBe(propertyChanges);
  }
}

describe('tagged publication range statistics', () => {
  // This matrix covers serialized insertion, deletion, and move wrappers. The
  // distinct contract for serializer-restorative property markup is tracked by
  // #937 instead of being treated as settled range-stat evidence here.
  transformationTest('counts wrappers after word-level refinement splits replacement tokens', () => {
    const publication = publish(
      paragraph('Shared prefix old middle shared suffix.'),
      paragraph('Shared prefix new middle shared suffix.'),
    );
    const publicPublication = publish(
      paragraph('Shared prefix old middle shared suffix.'),
      paragraph('Shared prefix new middle shared suffix.'),
      { retainStatisticsMarkers: false },
    );

    expectRetainedMarkersAndStatsAliasesAgree(publication);
    expect(publication.stats.insertedRanges).toBe(1);
    expect(publication.stats.deletedRanges).toBe(1);
    expect(generatedElements(publication, 'del')[0]!.textContent).toBe('old');
    expect(generatedElements(publication, 'ins')[0]!.textContent).toBe('new');
    expect(publicPublication.xml).not.toContain(COMPARISON_REVISION_ATTRIBUTE);
  });

  transformationTest('coalesces a contiguous multi-token deletion into one wrapper', () => {
    const publication = publish(
      paragraph('alpha beta gamma delta'),
      paragraph('alpha delta'),
    );

    expectRetainedMarkersAndStatsAliasesAgree(publication);
    expect(publication.stats.insertedRanges).toBe(0);
    expect(publication.stats.deletedRanges).toBe(1);
    expect(publication.stats.deletedAtoms).toBe(4);
    expect(generatedElements(publication, 'del')[0]!.textContent).toBe('beta gamma ');
  });

  transformationTest('counts wrappers split around bookmark and comment-range boundaries', () => {
    for (const boundary of [
      {
        name: 'bookmark',
        start: '<w:bookmarkStart w:id="7" w:name="Clause"/>',
        end: '<w:bookmarkEnd w:id="7"/>',
        startLocalName: 'bookmarkStart',
        endLocalName: 'bookmarkEnd',
      },
      {
        name: 'comment',
        start: '<w:commentRangeStart w:id="3"/>',
        end: '<w:commentRangeEnd w:id="3"/>',
        startLocalName: 'commentRangeStart',
        endLocalName: 'commentRangeEnd',
      },
    ] as const) {
      const original = '<w:p><w:r><w:t>alpha </w:t></w:r>'
        + boundary.start
        + '<w:r><w:t>beta gamma</w:t></w:r>'
        + boundary.end
        + '<w:r><w:t> omega</w:t></w:r></w:p>';
      const publication = publish(original, paragraph('alpha new omega'));
      const withoutBoundary = publish(
        paragraph('alpha beta gamma omega'),
        paragraph('alpha new omega'),
      );
      const emitted = parseXml(publication.xml);
      const generatedDeletions = generatedElements(publication, 'del');
      const generatedInsertions = generatedElements(publication, 'ins');

      expectRetainedMarkersAndStatsAliasesAgree(publication);
      expect(publication.stats.insertedRanges, boundary.name).toBe(1);
      expect(publication.stats.deletedRanges, boundary.name).toBe(4);
      expect(withoutBoundary.stats.deletedRanges, boundary.name).toBe(1);
      // Characterization: compared with the control's one text deletion, this
      // public total contains two boundary-only wrappers plus a separate
      // trailing-text deletion caused by suffix-alignment loss. #938 tracks
      // both the range-counting rule and the avoidable alignment churn.
      expect(generatedDeletions.map((element) => element.textContent), boundary.name)
        .toEqual(['', 'beta gamma', '', ' omega']);
      expect(generatedInsertions[0]!.textContent, boundary.name).toBe('new omega');
      expect(emitted.getElementsByTagNameNS(W_NS, boundary.startLocalName), boundary.name)
        .toHaveLength(1);
      expect(emitted.getElementsByTagNameNS(W_NS, boundary.endLocalName), boundary.name)
        .toHaveLength(1);
      expect((emitted.getElementsByTagNameNS(W_NS, boundary.startLocalName)[0]!.parentNode as Element).localName)
        .toBe('del');
      expect((emitted.getElementsByTagNameNS(W_NS, boundary.endLocalName)[0]!.parentNode as Element).localName)
        .toBe('del');
    }
  });

  transformationTest('reports a property-node range from the emitted property revision', () => {
    const formatted = (property: string) => '<w:p><w:r>'
      + `<w:rPr>${property}</w:rPr><w:t>same words</w:t>`
      + '</w:r></w:p>';
    const publication = publish(formatted('<w:i/>'), formatted('<w:b/>'));
    const propertyChanges = generatedElements(publication, 'rPrChange');

    expectRetainedMarkersAndStatsAliasesAgree(publication);
    expect(publication.stats.formatChanges).toBe(1);
    expect(propertyChanges).toHaveLength(1);
  });

  test('characterizes split run-property revisions absent from formatting totals', () => {
    const formatted = (property: string, text: string) => '<w:p><w:r>'
      + `<w:rPr>${property}</w:rPr><w:t>${text}</w:t>`
      + '</w:r></w:p>';
    const publication = publish(
      formatted('<w:i/>', 'alpha beta'),
      formatted('<w:b/>', 'alpha gamma'),
    );

    expectRetainedMarkersAndStatsAliasesAgree(publication, { assertFormatting: false });
    expect(publication.stats.insertedRanges).toBe(1);
    expect(publication.stats.deletedRanges).toBe(1);
    // #937 tracks the crossed text-and-formatting path separately from its
    // restorative whole-paragraph property-revision case.
    expect(generatedElements(publication, 'rPrChange')).toHaveLength(2);
    expect(publication.stats.formatChanges).toBe(0);
  });

  transformationTest('counts an opaque inline subtree after whole-node wrapping', () => {
    const insertedRuns = '<w:r><w:t>opaque one</w:t></w:r>'
      + '<w:r><w:t> opaque two</w:t></w:r>'
      + '<w:r><w:t> opaque three</w:t></w:r>';
    const opaque = '<w:sdt>'
      + '<w:sdtPr><w:tag w:val="fixture"/></w:sdtPr>'
      + `<w:sdtContent>${insertedRuns}</w:sdtContent>`
      + '</w:sdt>';
    const publication = publish(
      '<w:p><w:r><w:t>stable</w:t></w:r></w:p>',
      `<w:p><w:r><w:t>stable</w:t></w:r>${opaque}</w:p>`,
    );
    const plainRuns = publish(
      '<w:p><w:r><w:t>stable</w:t></w:r></w:p>',
      `<w:p><w:r><w:t>stable</w:t></w:r>${insertedRuns}</w:p>`,
    );
    const emitted = parseXml(publication.xml);

    expectRetainedMarkersAndStatsAliasesAgree(publication);
    expectRetainedMarkersAndStatsAliasesAgree(plainRuns);
    expect(publication.stats.insertedRanges).toBe(1);
    expect(plainRuns.stats.insertedRanges).toBe(3);
    expect(publication.stats.deletedRanges).toBe(0);
    const control = emitted.getElementsByTagNameNS(W_NS, 'sdt')[0]!;
    expect((control.parentNode as Element).localName).toBe('ins');
  });

  test('counts both paragraph-mark and content ranges emitted for a whole paragraph deletion', () => {
    const publication = publish(
      paragraph('stable') + paragraph('deleted paragraph'),
      paragraph('stable'),
    );

    expectRetainedMarkersAndStatsAliasesAgree(publication, { assertFormatting: false });
    expect(publication.stats.deletedRanges).toBe(2);
    // Characterize the serializer-restorative property wrapper separately:
    // #937 tracks why it does not yet contribute to formatChanges.
    expect(generatedElements(publication, 'pPrChange')).toHaveLength(1);
    expect(publication.stats.formatChanges).toBe(0);
    expect(generatedElements(publication, 'del').some((element) =>
      (element.parentNode as Element | null)?.localName === 'rPr',
    )).toBe(true);
    expect(generatedElements(publication, 'del').some((element) =>
      element.getElementsByTagNameNS(W_NS, 'delText').length > 0,
    )).toBe(true);
  });

  transformationTest('counts a whole-row deletion from its row-property marker', () => {
    const publication = publish(table(['deleted row', 'stable row']), table(['stable row']));
    const deletions = generatedElements(publication, 'del');

    expectRetainedMarkersAndStatsAliasesAgree(publication);
    expect(deletions).toHaveLength(1);
    expect((deletions[0]!.parentNode as Element).localName).toBe('trPr');
    expect((deletions[0]!.parentNode?.parentNode as Element).localName).toBe('tr');
  });

  transformationTest('excludes preserved same-author prior revisions from comparison counts', () => {
    const priorRevision = (value: string) => '<w:p>'
      + `<w:ins w:id="4" w:author="${AUTHOR}" w:date="2026-08-01T00:00:00Z">`
      + `<w:r><w:t>${value}</w:t></w:r></w:ins>`
      + '</w:p>';
    const publication = publish(priorRevision('old text'), priorRevision('new text'));
    const emitted = parseXml(publication.xml);

    expectRetainedMarkersAndStatsAliasesAgree(publication);
    expect(publication.stats.insertedRanges).toBe(1);
    expect(publication.stats.deletedRanges).toBe(1);
    expect(Array.from(emitted.getElementsByTagNameNS(W_NS, 'ins')).filter((element) =>
      element.getAttributeNS(W_NS, 'author') === AUTHOR &&
          !element.hasAttribute(COMPARISON_REVISION_ATTRIBUTE),
      )).toHaveLength(1);
    expect(emitted.getElementsByTagNameNS(W_NS, 'ins').length)
      .toBe(2);
  });

  transformationTest('counts wrappers after complex-field controls force atomic replacement', () => {
    const publication = publish(
      paragraphWithField('Pages: ', completeField(FIELD_INSTRUCTIONS.PAGE, '1'), '.'),
      paragraphWithField('Pages: ', completeField(FIELD_INSTRUCTIONS.NUMPAGES, '3'), '.'),
    );
    const emitted = parseXml(publication.xml);

    expectRetainedMarkersAndStatsAliasesAgree(publication);
    expect(publication.stats.insertedRanges).toBe(1);
    expect(publication.stats.deletedRanges).toBe(1);
    expect(generatedElements(publication, 'del')[0]!
      .getElementsByTagNameNS(W_NS, 'fldChar')).toHaveLength(3);
    expect(emitted.getElementsByTagNameNS(W_NS, 'fldChar')).toHaveLength(6);
    expect(Array.from(emitted.getElementsByTagNameNS(W_NS, 'fldChar')).filter((field) =>
      field.getAttributeNS(W_NS, 'fldCharType') === 'begin',
    )).toHaveLength(2);
  });

  transformationTest('reports balanced move ranges from the serialized move wrappers', () => {
    const publication = publish(
      paragraph('this complete paragraph moves away') + paragraph('stable paragraph'),
      paragraph('stable paragraph') + paragraph('this complete paragraph moves away'),
    );

    expectRetainedMarkersAndStatsAliasesAgree(publication);
    expect(publication.serializedRangeStats.moveFromRanges).toBe(1);
    expect(publication.serializedRangeStats.moveToRanges).toBe(1);
    // CompareStats has no public move fields, so pure moves otherwise report
    // all-zero public stats (#940). The serialized move shape itself also has
    // a separately tracked ECMA schema defect (#941).
    expect(publication.stats.insertedRanges).toBe(0);
    expect(publication.stats.deletedRanges).toBe(0);
  });
});
