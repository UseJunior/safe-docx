import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { getParagraphBookmarkId, insertParagraphBookmarks } from './bookmarks.js';
import { getDirectChildrenByName } from './dom-helpers.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';
import {
  getDocumentSections,
  SectionMutationError,
  setSectionPageNumberStart,
} from './sections.js';
import { createRevisionContext, createRevisionIdState } from './track-changes-emitter.js';
import { parseXml, serializeXml } from './xml.js';
import { OOXML, W } from './namespaces.js';

const W_NS = OOXML.W_NS;
const R_NS = OOXML.R_NS;
const TEST_FEATURE = 'add-section-page-numbering-formatting';
const test = testAllure.epic('Document Comparison').withLabels({
  feature: TEST_FEATURE,
});
const conformanceTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.12' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.18' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' },
);

function makeDocument(bodyXml: string): Document {
  const doc = parseXml(
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${bodyXml}</w:body></w:document>`,
  );
  insertParagraphBookmarks(doc, 'sections-test');
  return doc;
}

function direct(parent: Element, name: string): Element {
  const child = getDirectChildrenByName(parent, name)[0];
  if (!child) throw new Error(`Expected direct ${name}`);
  return child;
}

function attr(el: Element, name: string): string | null {
  return el.getAttributeNS(W_NS, name) || el.getAttribute(`w:${name}`) || null;
}

function liveSectPr(doc: Document, index: number): Element {
  const sections = Array.from(doc.getElementsByTagNameNS(W_NS, W.sectPr))
    .filter((sectPr) =>
      (sectPr.parentNode as Element | null)?.localName !== 'sectPrChange');
  const sectPr = sections[index];
  if (!sectPr) throw new Error(`Expected section ${index}`);
  return sectPr;
}

describe('OpenSpec traceability: section page numbering', () => {
  test.openspec('Paragraph boundaries precede the final body section')(
    'enumerates canonical live sections in document order',
    () => {
      const doc = makeDocument(
        '<w:p><w:r><w:t>First</w:t></w:r></w:p>'
          + '<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/></w:sectPr></w:pPr><w:r><w:t>Boundary</w:t></w:r></w:p>'
          + '<w:p><w:r><w:t>Second</w:t></w:r></w:p>'
          + '<w:sectPr><w:sectPrChange w:id="9"><w:sectPr><w:pgNumType w:start="8"/></w:sectPr></w:sectPrChange></w:sectPr>',
      );

      const sections = getDocumentSections(doc);
      expect(sections).toHaveLength(2);
      expect(sections.map((section) => section.location))
        .toEqual(['paragraph', 'body']);
      const boundaryParagraph = doc.getElementsByTagNameNS(W_NS, W.p).item(1) as Element;
      expect(sections[0]?.anchorParagraphId)
        .toBe(getParagraphBookmarkId(boundaryParagraph));
      expect(sections[1]?.anchorParagraphId).toBeNull();
      expect(sections[0]?.breakType).toBe('nextPage');
      expect(sections[1]?.pageNumberStart).toBeNull();
    },
  );

  test.openspec('Section inventory projects existing settings')(
    'projects page setup and references without mutating XML',
    () => {
      const doc = makeDocument(
        '<w:p><w:r><w:t>Body</w:t></w:r></w:p>'
          + '<w:sectPr>'
          + '<w:headerReference w:type="default" r:id="rId4"/>'
          + '<w:footerReference w:type="first" r:id="rId5"/>'
          + '<w:pgSz w:w="12240" w:h="15840" w:orient="portrait"/>'
          + '<w:pgMar w:top="1440" w:right="720" w:bottom="1440" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>'
          + '<w:pgNumType w:start="3" w:fmt="lowerRoman"/>'
          + '</w:sectPr>',
      );
      const before = serializeXml(doc);

      expect(getDocumentSections(doc)[0]).toMatchObject({
        pageNumberStart: 3,
        pageNumberFormat: 'lowerRoman',
        pageSize: {
          widthTwips: 12240,
          heightTwips: 15840,
          orientation: 'portrait',
        },
        margins: {
          topTwips: 1440,
          rightTwips: 720,
          gutterTwips: 0,
        },
        headers: [{ type: 'default', relationshipId: 'rId4' }],
        footers: [{ type: 'first', relationshipId: 'rId5' }],
      });
      expect(serializeXml(doc)).toBe(before);
    },
  );

  test.openspec('Revision snapshots are not live sections')(
    'excludes nested prior-properties snapshots from the inventory',
    () => {
      const doc = makeDocument(
        '<w:p><w:r><w:t>Body</w:t></w:r></w:p>'
          + '<w:sectPr><w:sectPrChange w:id="9"><w:sectPr>'
          + '<w:pgNumType w:start="8"/>'
          + '</w:sectPr></w:sectPrChange></w:sectPr>',
      );

      const sections = getDocumentSections(doc);
      expect(sections).toHaveLength(1);
      expect(sections[0]?.pageNumberStart).toBeNull();
    },
  );

  conformanceTest.openspec('Missing page numbering settings are created in schema order')(
    'creates pgNumType between margins and later section properties',
    () => {
      const doc = makeDocument(
        '<w:p><w:r><w:t>Body</w:t></w:r></w:p>'
          + '<w:sectPr><w:pgSz w:w="12240"/><w:pgMar w:top="1440"/><w:cols w:num="2"/><w:titlePg/><w:docGrid w:linePitch="360"/></w:sectPr>',
      );

      expect(setSectionPageNumberStart(
        doc,
        { sectionIndex: 0, pageNumberStart: 1 },
      )).toEqual({
        sectionIndex: 0,
        changed: true,
        previousPageNumberStart: null,
        currentPageNumberStart: 1,
      });
      const children = Array.from(liveSectPr(doc, 0).children)
        .map((child) => child.localName);
      expect(children).toEqual([
        W.pgSz,
        W.pgMar,
        W.pgNumType,
        'cols',
        W.titlePg,
        'docGrid',
      ]);
    },
  );

  conformanceTest.openspec('Existing page numbering attributes are preserved')(
    'updates only start and preserves unrelated section XML',
    () => {
      const doc = makeDocument(
        '<w:p><w:r><w:t>Body</w:t></w:r></w:p>'
          + '<w:sectPr w:rsidR="AA">'
          + '<w:headerReference w:type="default" r:id="rId1"/>'
          + '<w:pgSz w:w="12240" w:h="15840"/>'
          + '<w:pgMar w:top="1440" w:left="720"/>'
          + '<w:pgNumType w:start="2" w:fmt="lowerRoman" w:chapStyle="1" w:chapSep="hyphen"/>'
          + '<w:cols w:num="2"/>'
          + '<w:titlePg/>'
          + '</w:sectPr>',
      );
      const sectPr = liveSectPr(doc, 0);
      const preservedBefore = [
        direct(sectPr, W.headerReference).toString(),
        direct(sectPr, W.pgSz).toString(),
        direct(sectPr, W.pgMar).toString(),
        direct(sectPr, 'cols').toString(),
        direct(sectPr, W.titlePg).toString(),
      ];

      setSectionPageNumberStart(doc, { sectionIndex: 0, pageNumberStart: 7 });

      const pgNumType = direct(sectPr, W.pgNumType);
      expect(attr(pgNumType, W.start)).toBe('7');
      expect(attr(pgNumType, 'fmt')).toBe('lowerRoman');
      expect(attr(pgNumType, 'chapStyle')).toBe('1');
      expect(attr(pgNumType, 'chapSep')).toBe('hyphen');
      expect([
        direct(sectPr, W.headerReference).toString(),
        direct(sectPr, W.pgSz).toString(),
        direct(sectPr, W.pgMar).toString(),
        direct(sectPr, 'cols').toString(),
        direct(sectPr, W.titlePg).toString(),
      ]).toEqual(preservedBefore);
      expect(attr(sectPr, 'rsidR')).toBe('AA');
    },
  );

  conformanceTest.openspec('Unrelated section properties are preserved')(
    'keeps page setup, columns, references, topology, and text unchanged',
    () => {
      const doc = makeDocument(
        '<w:p><w:r><w:t>Visible body</w:t></w:r></w:p>'
          + '<w:sectPr>'
          + '<w:headerReference w:type="default" r:id="rId1"/>'
          + '<w:footerReference w:type="first" r:id="rId2"/>'
          + '<w:pgSz w:w="12240" w:h="15840"/>'
          + '<w:pgMar w:top="1440" w:left="720"/>'
          + '<w:pgNumType w:start="2"/><w:cols w:num="2"/>'
          + '</w:sectPr>',
      );
      const sectionBefore = liveSectPr(doc, 0);
      const preservedBefore = [
        direct(sectionBefore, W.headerReference).toString(),
        direct(sectionBefore, W.footerReference).toString(),
        direct(sectionBefore, W.pgSz).toString(),
        direct(sectionBefore, W.pgMar).toString(),
        direct(sectionBefore, 'cols').toString(),
      ];
      const paragraphCountBefore = doc.getElementsByTagNameNS(W_NS, W.p).length;
      const textBefore = doc.documentElement.textContent;

      setSectionPageNumberStart(doc, { sectionIndex: 0, pageNumberStart: 6 });

      const sectionAfter = liveSectPr(doc, 0);
      expect([
        direct(sectionAfter, W.headerReference).toString(),
        direct(sectionAfter, W.footerReference).toString(),
        direct(sectionAfter, W.pgSz).toString(),
        direct(sectionAfter, W.pgMar).toString(),
        direct(sectionAfter, 'cols').toString(),
      ]).toEqual(preservedBefore);
      expect(getDocumentSections(doc)).toHaveLength(1);
      expect(doc.getElementsByTagNameNS(W_NS, W.p)).toHaveLength(paragraphCountBefore);
      expect(doc.documentElement.textContent).toBe(textBefore);
    },
  );

  conformanceTest.openspec('Prior section properties are captured')(
    'emits a single prior snapshot and supports accept/reject projections',
    () => {
      const doc = makeDocument(
        '<w:p><w:r><w:t>Body</w:t></w:r></w:p>'
          + '<w:sectPr w:rsidR="AABBCCDD">'
          + '<w:headerReference w:type="default" r:id="rId1"/>'
          + '<w:pgSz w:w="12240"/><w:pgNumType w:start="2" w:fmt="decimal"/>'
          + '</w:sectPr>',
      );
      const ctx = createRevisionContext({
        author: 'SafeDocX AI',
        date: '2026-07-27T12:00:00Z',
        idState: createRevisionIdState(),
      });

      setSectionPageNumberStart(
        doc,
        { sectionIndex: 0, pageNumberStart: 5 },
        ctx,
      );
      const sectPr = liveSectPr(doc, 0);
      const change = direct(sectPr, 'sectPrChange');
      expect(attr(change, 'author')).toBe('SafeDocX AI');
      const priorSectPr = direct(change, W.sectPr);
      expect(attr(direct(priorSectPr, W.pgNumType), W.start)).toBe('2');
      expect(getDirectChildrenByName(priorSectPr, 'sectPrChange')).toHaveLength(0);
      expect(getDirectChildrenByName(priorSectPr, W.headerReference)).toHaveLength(0);
      expect(attr(priorSectPr, 'rsidR')).toBe('AABBCCDD');
    },
  );

  conformanceTest.openspec('Accept and reject preserve section semantics')(
    'keeps the new restart on accept and restores prior properties on reject',
    () => {
      const doc = makeDocument(
        '<w:p><w:r><w:t>Body</w:t></w:r></w:p>'
          + '<w:sectPr><w:headerReference w:type="default" r:id="rId1"/>'
          + '<w:pgSz w:w="12240"/><w:pgNumType w:start="2"/>'
          + '</w:sectPr>',
      );
      setSectionPageNumberStart(
        doc,
        { sectionIndex: 0, pageNumberStart: 5 },
        createRevisionContext({
          author: 'SafeDocX AI',
          idState: createRevisionIdState(),
        }),
      );
      const accepted = doc.cloneNode(true) as Document;
      acceptChanges(accepted);
      expect(attr(direct(liveSectPr(accepted, 0), W.pgNumType), W.start)).toBe('5');
      expect(getDirectChildrenByName(liveSectPr(accepted, 0), 'sectPrChange'))
        .toHaveLength(0);

      const rejected = doc.cloneNode(true) as Document;
      rejectChanges(rejected);
      expect(attr(direct(liveSectPr(rejected, 0), W.pgNumType), W.start)).toBe('2');
      expect(attr(direct(liveSectPr(rejected, 0), W.pgSz), W.w)).toBe('12240');
      expect(
        direct(liveSectPr(rejected, 0), W.headerReference)
          .getAttributeNS(R_NS, 'id'),
      ).toBe('rId1');
    },
  );

  test.openspec('Identical page number restart is a deterministic no-op')(
    'does not serialize or allocate a revision for an identical request',
    () => {
      const doc = makeDocument(
        '<w:p><w:r><w:t>Body</w:t></w:r></w:p>'
          + '<w:sectPr><w:pgNumType w:start="4"/></w:sectPr>',
      );
      const ctx = createRevisionContext({
        author: 'SafeDocX AI',
        idState: createRevisionIdState(),
      });
      const before = serializeXml(doc);

      expect(setSectionPageNumberStart(
        doc,
        { sectionIndex: 0, pageNumberStart: 4 },
        ctx,
      ).changed).toBe(false);
      expect(serializeXml(doc)).toBe(before);
      expect(ctx.idState.nextId).toBe(1);
    },
  );

  test.openspec('Invalid input is transactional')(
    'rejects invalid selectors and values before mutation',
    () => {
      const doc = makeDocument(
        '<w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr/>',
      );
      const before = serializeXml(doc);
      expect(() => setSectionPageNumberStart(
        doc,
        { sectionIndex: 9, pageNumberStart: 1 },
      )).toThrowError(SectionMutationError);
      expect(() => setSectionPageNumberStart(
        doc,
        { sectionIndex: 0, pageNumberStart: -1 },
      )).toThrowError(expect.objectContaining({
        code: 'INVALID_PAGE_NUMBER_START',
      }));
      expect(serializeXml(doc)).toBe(before);
    },
  );
});
