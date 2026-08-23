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
import { constructTaggedTree } from './taggedTreeConstruction.js';
import type { TaggedNode } from './taggedTree.js';

const TEST_FEATURE = 'refactor-tagged-tree-redline-construction';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
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
  return `<w:tbl>${rowTexts.map((text) =>
    `<w:tr><w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`,
  ).join('')}</w:tbl>`;
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
    .filter((element) => element.getAttribute('data-safe-docx-comparison-revision') === '1');
}

function expectRangeStatsMatchSerializedMarkup(publication: TaggedTreePublication): void {
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
}

describe('tagged publication range statistics', () => {
  test.openspec('Serialized wrapper transformations determine range totals')(
    'counts wrappers after word-level refinement splits and coalesces replacement tokens',
    () => {
      const publication = publish(
        paragraph('Shared prefix old middle shared suffix.'),
        paragraph('Shared prefix new middle shared suffix.'),
      );

      expectRangeStatsMatchSerializedMarkup(publication);
      expect(publication.stats.insertedRanges).toBeGreaterThan(0);
      expect(publication.stats.deletedRanges).toBeGreaterThan(0);
      expect(publication.xml).toContain('Shared prefix ');
      expect(publication.xml).toContain(' shared suffix.');
    },
  );

  test.openspec('Serialized wrapper transformations determine range totals')(
    'counts wrappers split around bookmark boundaries',
    () => {
      const original = '<w:p><w:r><w:t>alpha </w:t></w:r>'
        + '<w:bookmarkStart w:id="7" w:name="Clause"/>'
        + '<w:r><w:t>beta gamma</w:t></w:r>'
        + '<w:bookmarkEnd w:id="7"/>'
        + '<w:r><w:t> omega</w:t></w:r></w:p>';
      const publication = publish(original, paragraph('alpha new omega'));
      const withoutBoundary = publish(
        paragraph('alpha beta gamma omega'),
        paragraph('alpha new omega'),
      );
      const emitted = parseXml(publication.xml);

      expectRangeStatsMatchSerializedMarkup(publication);
      expect(publication.stats.insertedRanges).toBe(1);
      expect(publication.stats.deletedRanges).toBe(4);
      expect(withoutBoundary.stats.deletedRanges).toBe(1);
      expect(emitted.getElementsByTagNameNS(W_NS, 'bookmarkStart')).toHaveLength(1);
      expect(emitted.getElementsByTagNameNS(W_NS, 'bookmarkEnd')).toHaveLength(1);
      expect((emitted.getElementsByTagNameNS(W_NS, 'bookmarkStart')[0]!.parentNode as Element).localName)
        .toBe('del');
      expect((emitted.getElementsByTagNameNS(W_NS, 'bookmarkEnd')[0]!.parentNode as Element).localName)
        .toBe('del');
    },
  );

  test.openspec('Serialized wrapper transformations determine range totals')(
    'counts wrappers split around non-bookmark range boundaries',
    () => {
      const original = '<w:p><w:r><w:t>alpha </w:t></w:r>'
        + '<w:commentRangeStart w:id="3"/>'
        + '<w:r><w:t>beta gamma</w:t></w:r>'
        + '<w:commentRangeEnd w:id="3"/>'
        + '<w:r><w:t> omega</w:t></w:r></w:p>';
      const publication = publish(original, paragraph('alpha new omega'));
      const withoutBoundary = publish(
        paragraph('alpha beta gamma omega'),
        paragraph('alpha new omega'),
      );
      const emitted = parseXml(publication.xml);

      expectRangeStatsMatchSerializedMarkup(publication);
      expect(publication.stats.insertedRanges).toBe(1);
      expect(publication.stats.deletedRanges).toBe(4);
      expect(withoutBoundary.stats.deletedRanges).toBe(1);
      expect(emitted.getElementsByTagNameNS(W_NS, 'commentRangeStart')).toHaveLength(1);
      expect(emitted.getElementsByTagNameNS(W_NS, 'commentRangeEnd')).toHaveLength(1);
      expect((emitted.getElementsByTagNameNS(W_NS, 'commentRangeStart')[0]!.parentNode as Element).localName)
        .toBe('del');
      expect((emitted.getElementsByTagNameNS(W_NS, 'commentRangeEnd')[0]!.parentNode as Element).localName)
        .toBe('del');
    },
  );

  test.openspec('Serialized wrapper transformations determine range totals')(
    'reports a property-node range from the emitted property revision',
    () => {
      const formatted = (property: string) => '<w:p><w:r>'
        + `<w:rPr>${property}</w:rPr><w:t>same words</w:t>`
        + '</w:r></w:p>';
      const publication = publish(formatted('<w:i/>'), formatted('<w:b/>'));
      const propertyChanges = generatedElements(publication, 'rPrChange');

      expectRangeStatsMatchSerializedMarkup(publication);
      expect(publication.stats.formatChanges).toBe(propertyChanges.length);
      expect(propertyChanges).toHaveLength(1);
    },
  );

  test.openspec('Serialized wrapper transformations determine range totals')(
    'counts an opaque inline subtree after whole-node wrapping',
    () => {
      const opaque = '<w:sdt>'
        + '<w:sdtPr><w:tag w:val="fixture"/></w:sdtPr>'
        + '<w:sdtContent><w:r><w:t>opaque payload</w:t></w:r></w:sdtContent>'
        + '</w:sdt>';
      const publication = publish(
        '<w:p><w:r><w:t>stable</w:t></w:r></w:p>',
        `<w:p><w:r><w:t>stable</w:t></w:r>${opaque}</w:p>`,
      );
      const emitted = parseXml(publication.xml);
      const constructed = constructTaggedTree(
        parseXml(documentWithBody('<w:p><w:r><w:t>stable</w:t></w:r></w:p>')).documentElement,
        parseXml(documentWithBody(`<w:p><w:r><w:t>stable</w:t></w:r>${opaque}</w:p>`)).documentElement,
      );
      const descendants = (node: TaggedNode): TaggedNode[] =>
        [node, ...node.children.flatMap(descendants)];
      const opaqueControl = descendants(constructed.tree).find((node) =>
        node.tag === 'revised' && node.node.localName === 'sdt');

      expectRangeStatsMatchSerializedMarkup(publication);
      expect(publication.stats.insertedRanges).toBeGreaterThan(0);
      expect(publication.stats.deletedRanges).toBe(0);
      expect(opaqueControl?.opaque).toBe(true);
      const control = emitted.getElementsByTagNameNS(W_NS, 'sdt')[0]!;
      expect((control.parentNode as Element).localName).toBe('ins');
    },
  );

  test.openspec('Serialized wrapper transformations determine range totals')(
    'counts both paragraph-mark and content ranges emitted for a whole paragraph deletion',
    () => {
      const publication = publish(
        paragraph('stable') + paragraph('deleted paragraph'),
        paragraph('stable'),
      );

      expectRangeStatsMatchSerializedMarkup(publication);
      expect(publication.stats.deletedRanges).toBe(2);
      expect(generatedElements(publication, 'del').some((element) =>
        (element.parentNode as Element | null)?.localName === 'rPr',
      )).toBe(true);
      expect(generatedElements(publication, 'del').some((element) =>
        element.getElementsByTagNameNS(W_NS, 'delText').length > 0,
      )).toBe(true);
    },
  );

  test.openspec('Serialized wrapper transformations determine range totals')(
    'counts a whole-row deletion from its row-property marker',
    () => {
      const publication = publish(table(['deleted row', 'stable row']), table(['stable row']));
      const deletions = generatedElements(publication, 'del');

      expectRangeStatsMatchSerializedMarkup(publication);
      expect(deletions).toHaveLength(1);
      expect((deletions[0]!.parentNode as Element).localName).toBe('trPr');
      expect((deletions[0]!.parentNode?.parentNode as Element).localName).toBe('tr');
    },
  );

  test.openspec('Serialized wrapper transformations determine range totals')(
    'excludes preserved prior-author revisions while counting nested comparison ranges',
    () => {
      const priorRevision = (value: string) => '<w:p>'
        + `<w:ins w:id="4" w:author="${AUTHOR}" w:date="2026-08-01T00:00:00Z">`
        + `<w:r><w:t>${value}</w:t></w:r></w:ins>`
        + '</w:p>';
      const publication = publish(priorRevision('old text'), priorRevision('new text'));
      const emitted = parseXml(publication.xml);

      expectRangeStatsMatchSerializedMarkup(publication);
      expect(publication.stats.insertedRanges).toBeGreaterThan(0);
      expect(publication.stats.deletedRanges).toBeGreaterThan(0);
      expect(Array.from(emitted.getElementsByTagNameNS(W_NS, 'ins')).filter((element) =>
        element.getAttributeNS(W_NS, 'author') === AUTHOR &&
          !element.hasAttribute('data-safe-docx-comparison-revision'),
      )).not.toHaveLength(0);
      expect(emitted.getElementsByTagNameNS(W_NS, 'ins').length)
        .toBeGreaterThan(publication.stats.insertedRanges);
    },
  );

  test.openspec('Serialized wrapper transformations determine range totals')(
    'counts wrappers after complex-field controls force atomic replacement',
    () => {
      const publication = publish(
        paragraphWithField('Pages: ', completeField(FIELD_INSTRUCTIONS.PAGE, '1'), '.'),
        paragraphWithField('Pages: ', completeField(FIELD_INSTRUCTIONS.NUMPAGES, '3'), '.'),
      );
      const emitted = parseXml(publication.xml);

      expectRangeStatsMatchSerializedMarkup(publication);
      expect(publication.stats.insertedRanges).toBeGreaterThan(0);
      expect(publication.stats.deletedRanges).toBeGreaterThan(0);
      expect(emitted.getElementsByTagNameNS(W_NS, 'fldChar')).toHaveLength(6);
      expect(Array.from(emitted.getElementsByTagNameNS(W_NS, 'fldChar')).filter((field) =>
        field.getAttributeNS(W_NS, 'fldCharType') === 'begin',
      )).toHaveLength(2);
    },
  );

  test.openspec('Serialized wrapper transformations determine range totals')(
    'reports balanced move ranges from the serialized move wrappers',
    () => {
      const publication = publish(
        paragraph('this complete paragraph moves away') + paragraph('stable paragraph'),
        paragraph('stable paragraph') + paragraph('this complete paragraph moves away'),
      );

      expectRangeStatsMatchSerializedMarkup(publication);
      expect(publication.serializedRangeStats.moveFromRanges).toBe(1);
      expect(publication.serializedRangeStats.moveToRanges).toBe(1);
      expect(publication.stats.insertedRanges).toBe(0);
      expect(publication.stats.deletedRanges).toBe(0);
    },
  );
});
