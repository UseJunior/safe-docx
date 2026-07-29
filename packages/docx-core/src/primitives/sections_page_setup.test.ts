import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { insertParagraphBookmarks } from './bookmarks.js';
import { getDirectChildrenByName } from './dom-helpers.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';
import {
  getDocumentSections,
  SectionMutationError,
  updateSectionProperties,
} from './sections.js';
import { createRevisionContext, createRevisionIdState } from './track-changes-emitter.js';
import { parseXml, serializeXml } from './xml.js';
import { OOXML, W } from './namespaces.js';

const TEST_FEATURE = 'add-section-page-setup-formatting';
const test = testAllure.epic('Document Comparison').withLabels({
  feature: TEST_FEATURE,
});
const conformanceTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.13' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.11' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' },
);

const W_NS = OOXML.W_NS;
const R_NS = OOXML.R_NS;
const COMPLETE_MARGINS =
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"'
  + ' w:header="720" w:footer="720" w:gutter="0"/>';

function makeDocument(sectPr: string): Document {
  const doc = parseXml(
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>`
      + '<w:p><w:r><w:t>Visible body</w:t></w:r></w:p>'
      + `<w:sectPr>${sectPr}</w:sectPr>`
      + '</w:body></w:document>',
  );
  insertParagraphBookmarks(doc, 'page-setup-test');
  return doc;
}

function direct(parent: Element, localName: string): Element {
  const child = getDirectChildrenByName(parent, localName)[0];
  if (!child) throw new Error(`Expected ${localName}`);
  return child;
}

function liveSectPr(doc: Document): Element {
  const body = doc.getElementsByTagNameNS(W_NS, W.body).item(0) as Element;
  return direct(body, W.sectPr);
}

function attr(element: Element, localName: string): string | null {
  return element.getAttributeNS(W_NS, localName)
    || element.getAttribute(`w:${localName}`)
    || null;
}

describe('OpenSpec: atomic section page setup primitive', () => {
  conformanceTest.openspec('Existing page size receives a partial update')(
    'preserves height and paper code while changing width and orientation',
    () => {
      const doc = makeDocument(
        '<w:pgSz w:w="12240" w:h="15840" w:orient="portrait" w:code="1"/>'
          + COMPLETE_MARGINS,
      );
      updateSectionProperties(doc, {
        sectionIndex: 0,
        pageSize: { widthTwips: 15840, orientation: 'landscape' },
      });
      const pgSz = direct(liveSectPr(doc), W.pgSz);
      expect([attr(pgSz, W.w), attr(pgSz, 'h'), attr(pgSz, 'orient'), attr(pgSz, 'code')])
        .toEqual(['15840', '15840', 'landscape', '1']);
    },
  );

  conformanceTest.openspec('Missing page size is created with explicit dimensions')(
    'inserts pgSz before pgMar and rejects orientation-only creation',
    () => {
      const doc = makeDocument(COMPLETE_MARGINS + '<w:pgNumType w:start="1"/>');
      updateSectionProperties(doc, {
        sectionIndex: 0,
        pageSize: { widthTwips: 15840, heightTwips: 12240, orientation: 'landscape' },
      });
      expect(Array.from(liveSectPr(doc).children).map((child) => child.localName))
        .toEqual([W.pgSz, W.pgMar, W.pgNumType]);

      const incomplete = makeDocument('');
      const before = serializeXml(incomplete);
      expect(() => updateSectionProperties(incomplete, {
        sectionIndex: 0,
        pageSize: { orientation: 'landscape' },
      })).toThrowError(expect.objectContaining({ code: 'INCOMPLETE_PAGE_SIZE' }));
      expect(serializeXml(incomplete)).toBe(before);
    },
  );

  conformanceTest.openspec('Existing margins receive a partial update')(
    'supports signed top/bottom and preserves unspecified attributes',
    () => {
      const doc = makeDocument(
        '<w:pgSz w:w="12240" w:h="15840"/>' + COMPLETE_MARGINS,
      );
      updateSectionProperties(doc, {
        sectionIndex: 0,
        margins: { topTwips: -120, rightTwips: 720 },
      });
      expect(getDocumentSections(doc)[0]?.margins).toEqual({
        topTwips: -120,
        rightTwips: 720,
        bottomTwips: 1440,
        leftTwips: 1440,
        headerTwips: 720,
        footerTwips: 720,
        gutterTwips: 0,
      });
    },
  );

  conformanceTest.openspec('Missing margins require the complete attribute set')(
    'creates all seven attributes before pgNumType and rejects partial creation',
    () => {
      const doc = makeDocument(
        '<w:pgSz w:w="12240" w:h="15840"/><w:pgNumType w:start="1"/>',
      );
      updateSectionProperties(doc, {
        sectionIndex: 0,
        margins: {
          topTwips: 720,
          rightTwips: 720,
          bottomTwips: 720,
          leftTwips: 720,
          headerTwips: 360,
          footerTwips: 360,
          gutterTwips: 0,
        },
      });
      expect(Array.from(liveSectPr(doc).children).map((child) => child.localName))
        .toEqual([W.pgSz, W.pgMar, W.pgNumType]);
      const incomplete = makeDocument('');
      expect(() => updateSectionProperties(incomplete, {
        sectionIndex: 0,
        margins: { topTwips: 720 },
      })).toThrowError(expect.objectContaining({ code: 'INCOMPLETE_PAGE_MARGINS' }));
    },
  );

  test.openspec('Page setup values follow their OOXML domains')(
    'rejects invalid values before mutation',
    () => {
      const doc = makeDocument(
        '<w:pgSz w:w="12240" w:h="15840"/>' + COMPLETE_MARGINS,
      );
      const before = serializeXml(doc);
      for (const mutation of [
        { pageSize: { widthTwips: 0 } },
        { pageSize: { orientation: 'sideways' } },
        { margins: { leftTwips: -1 } },
        { margins: { topTwips: 1.5 } },
        {},
      ]) {
        expect(() => updateSectionProperties(doc, {
          sectionIndex: 0,
          ...mutation,
        } as never)).toThrowError(SectionMutationError);
        expect(serializeXml(doc)).toBe(before);
      }
    },
  );

  conformanceTest.openspec('Mixed page setup changes are atomic')(
    'records one snapshot of the state before all requested changes',
    () => {
      const doc = makeDocument(
        '<w:pgSz w:w="12240" w:h="15840" w:code="1"/>'
          + COMPLETE_MARGINS
          + '<w:pgNumType w:start="1" w:fmt="decimal"/>',
      );
      const result = updateSectionProperties(
        doc,
        {
          sectionIndex: 0,
          pageNumberStart: 3,
          pageSize: { widthTwips: 15840, heightTwips: 12240, orientation: 'landscape' },
          margins: { topTwips: 720, gutterTwips: 180 },
        },
        createRevisionContext({
          author: 'SafeDocX AI',
          idState: createRevisionIdState(),
        }),
      );
      expect(result.currentSection).toMatchObject({
        pageNumberStart: 3,
        pageSize: { widthTwips: 15840, heightTwips: 12240, orientation: 'landscape' },
        margins: { topTwips: 720, gutterTwips: 180 },
      });
      const changes = getDirectChildrenByName(liveSectPr(doc), 'sectPrChange');
      expect(changes).toHaveLength(1);
      const prior = direct(changes[0]!, W.sectPr);
      expect(attr(direct(prior, W.pgSz), W.w)).toBe('12240');
      expect(attr(direct(prior, W.pgMar), W.top)).toBe('1440');
      expect(attr(direct(prior, W.pgNumType), W.start)).toBe('1');
    },
  );

  test.openspec('Identical page setup is a deterministic no-op')(
    'leaves XML and revision allocation unchanged',
    () => {
      const doc = makeDocument(
        '<w:pgSz w:w="12240" w:h="15840" w:orient="portrait"/>'
          + COMPLETE_MARGINS,
      );
      const before = serializeXml(doc);
      const ctx = createRevisionContext({
        author: 'SafeDocX AI',
        idState: createRevisionIdState(),
      });
      expect(updateSectionProperties(doc, {
        sectionIndex: 0,
        pageSize: { widthTwips: 12240, orientation: 'portrait' },
        margins: { topTwips: 1440, gutterTwips: 0 },
      }, ctx).changed).toBe(false);
      expect(serializeXml(doc)).toBe(before);
      expect(ctx.idState.nextId).toBe(1);
    },
  );

  conformanceTest.openspec('Untargeted section properties survive page setup editing')(
    'preserves references, numbering, break type, columns, borders, and topology',
    () => {
      const doc = makeDocument(
        '<w:headerReference w:type="default" r:id="rId1"/>'
          + '<w:footerReference w:type="first" r:id="rId2"/>'
          + '<w:type w:val="continuous"/>'
          + '<w:pgSz w:w="12240" w:h="15840" w:code="1"/>'
          + COMPLETE_MARGINS
          + '<w:pgBorders/><w:pgNumType w:start="1" w:fmt="lowerRoman"/>'
          + '<w:cols w:num="2"/>',
      );
      const before = getDocumentSections(doc)[0]!;
      const paragraphs = doc.getElementsByTagNameNS(W_NS, W.p).length;
      const text = doc.documentElement.textContent;
      updateSectionProperties(doc, {
        sectionIndex: 0,
        pageSize: { widthTwips: 15840 },
        margins: { leftTwips: 720 },
      });
      const after = getDocumentSections(doc)[0]!;
      expect(after).toMatchObject({
        breakType: before.breakType,
        pageNumberStart: before.pageNumberStart,
        pageNumberFormat: before.pageNumberFormat,
        headers: before.headers,
        footers: before.footers,
      });
      expect(direct(liveSectPr(doc), 'pgBorders')).toBeTruthy();
      expect(direct(liveSectPr(doc), 'cols')).toBeTruthy();
      expect(doc.getElementsByTagNameNS(W_NS, W.p)).toHaveLength(paragraphs);
      expect(doc.documentElement.textContent).toBe(text);
    },
  );

  conformanceTest.openspec('Accept and reject preserve page setup semantics')(
    'keeps current values on accept and restores the complete prior section on reject',
    () => {
      const doc = makeDocument(
        '<w:headerReference w:type="default" r:id="rId1"/>'
          + '<w:pgSz w:w="12240" w:h="15840" w:code="1"/>'
          + COMPLETE_MARGINS
          + '<w:pgNumType w:start="1" w:fmt="decimal"/>',
      );
      updateSectionProperties(
        doc,
        {
          sectionIndex: 0,
          pageNumberStart: 4,
          pageSize: { widthTwips: 15840, heightTwips: 12240, orientation: 'landscape' },
          margins: { topTwips: 720, leftTwips: 720 },
        },
        createRevisionContext({
          author: 'SafeDocX AI',
          idState: createRevisionIdState(),
        }),
      );
      const accepted = doc.cloneNode(true) as Document;
      acceptChanges(accepted);
      expect(getDocumentSections(accepted)[0]).toMatchObject({
        pageNumberStart: 4,
        pageSize: { widthTwips: 15840, heightTwips: 12240, orientation: 'landscape' },
        margins: { topTwips: 720, leftTwips: 720 },
      });

      const rejected = doc.cloneNode(true) as Document;
      rejectChanges(rejected);
      expect(getDocumentSections(rejected)[0]).toMatchObject({
        pageNumberStart: 1,
        pageNumberFormat: 'decimal',
        pageSize: { widthTwips: 12240, heightTwips: 15840, orientation: null },
        margins: { topTwips: 1440, leftTwips: 1440 },
        headers: [{ type: 'default', relationshipId: 'rId1' }],
      });
    },
  );
});
