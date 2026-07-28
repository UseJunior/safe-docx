import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import {
  getParagraphBookmarkId,
  insertParagraphBookmarks,
} from './bookmarks.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';
import {
  getDocumentSections,
  insertSectionBreak,
  SectionMutationError,
} from './sections.js';
import { createRevisionContext, createRevisionIdState } from './track-changes-emitter.js';
import { parseXml, serializeXml } from './xml.js';
import { OOXML, W } from './namespaces.js';

const TEST_FEATURE = 'add-section-break-insertion';
const test = testAllure.epic('Document Comparison').withLabels({
  feature: TEST_FEATURE,
});
const conformanceTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.18' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.22' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' },
);

const W_NS = OOXML.W_NS;
const R_NS = OOXML.R_NS;
const SECTION_PROPERTIES =
  '<w:headerReference w:type="default" r:id="rIdHeader"/>'
  + '<w:footerReference w:type="first" r:id="rIdFooter"/>'
  + '<w:pgSz w:w="12240" w:h="15840"/>'
  + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"'
  + ' w:header="720" w:footer="720" w:gutter="0"/>'
  + '<w:pgNumType w:start="4" w:fmt="decimal"/>'
  + '<w:cols w:num="2"/>';

function makeDocument(): Document {
  const doc = parseXml(
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>`
      + '<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>Beta</w:t></w:r></w:p>'
      + `<w:sectPr w:rsidR="00112233">${SECTION_PROPERTIES}</w:sectPr>`
      + '</w:body></w:document>',
  );
  insertParagraphBookmarks(doc, 'section-break-test');
  return doc;
}

function paragraphId(doc: Document, index: number): string {
  const paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(index) as Element;
  const id = getParagraphBookmarkId(paragraph);
  if (!id) throw new Error(`Expected paragraph id at ${index}`);
  return id;
}

function directChildren(parent: Element): string[] {
  return Array.from(parent.childNodes)
    .filter((node): node is Element => node.nodeType === 1)
    .map((node) => node.localName);
}

describe('OpenSpec: anchored section-break primitive', () => {
  conformanceTest.openspec('Insert a boundary inside the final section')(
    'adds a dedicated boundary and preserves section properties and references',
    () => {
      const doc = makeDocument();
      const result = insertSectionBreak(doc, {
        anchorParagraphId: paragraphId(doc, 0),
        breakType: 'nextPage',
      });

      expect(result).toMatchObject({
        changed: true,
        precedingSectionIndex: 0,
        followingSectionIndex: 1,
        sectionCountBefore: 1,
        sectionCountAfter: 2,
      });
      expect(getDocumentSections(doc)).toHaveLength(2);
      expect(result.precedingSection).toMatchObject({
        anchorParagraphId: result.insertedBoundaryParagraphId,
        breakType: 'nextPage',
        pageNumberStart: 4,
        headers: [{ type: 'default', relationshipId: 'rIdHeader' }],
        footers: [{ type: 'first', relationshipId: 'rIdFooter' }],
      });
      expect(result.followingSection).toMatchObject({
        pageNumberStart: 4,
        headers: [{ type: 'default', relationshipId: 'rIdHeader' }],
        footers: [{ type: 'first', relationshipId: 'rIdFooter' }],
      });
      const inserted = doc.getElementsByTagNameNS(W_NS, W.p).item(1) as Element;
      expect(directChildren(inserted)).toEqual([W.pPr]);
      expect(serializeXml(doc)).not.toContain('<w:ins');
    },
  );

  conformanceTest.openspec('Inherit and override the following section')(
    'applies one following-section property change without disturbing other properties',
    () => {
      const doc = makeDocument();
      const result = insertSectionBreak(
        doc,
        {
          anchorParagraphId: paragraphId(doc, 0),
          breakType: 'continuous',
          newSection: { pageNumberStart: 1 },
        },
        createRevisionContext({
          author: 'AI',
          date: '2026-07-28T20:00:00Z',
          idState: createRevisionIdState(30),
        }),
      );

      expect(result.precedingSection.pageNumberStart).toBe(4);
      expect(result.followingSection).toMatchObject({
        pageNumberStart: 1,
        pageSize: { widthTwips: 12240, heightTwips: 15840 },
        headers: [{ type: 'default', relationshipId: 'rIdHeader' }],
      });
      const xml = serializeXml(doc);
      expect(xml.match(/<w:sectPrChange\b/g)).toHaveLength(1);
      expect(xml.match(/<w:pPr><w:rPr><w:ins\b/g)).toHaveLength(1);
    },
  );

  conformanceTest.openspec('Reset non-relationship properties')(
    'removes inherited layout but retains relationship references and explicit overrides',
    () => {
      const doc = makeDocument();
      const result = insertSectionBreak(doc, {
        anchorParagraphId: paragraphId(doc, 0),
        breakType: 'oddPage',
        inheritProperties: false,
        newSection: {
          pageSize: {
            widthTwips: 15840,
            heightTwips: 12240,
            orientation: 'landscape',
          },
          margins: {
            topTwips: 720,
            rightTwips: 720,
            bottomTwips: 720,
            leftTwips: 720,
            headerTwips: 360,
            footerTwips: 360,
            gutterTwips: 0,
          },
        },
      });

      expect(result.precedingSection).toMatchObject({
        pageNumberStart: 4,
        breakType: 'oddPage',
      });
      expect(result.followingSection).toMatchObject({
        pageNumberStart: null,
        pageSize: {
          widthTwips: 15840,
          heightTwips: 12240,
          orientation: 'landscape',
        },
        headers: [{ type: 'default', relationshipId: 'rIdHeader' }],
        footers: [{ type: 'first', relationshipId: 'rIdFooter' }],
      });
      const followingXml = serializeXml(
        doc,
      ).slice(serializeXml(doc).lastIndexOf('<w:sectPr'));
      expect(followingXml).not.toContain('<w:cols');
      expect(followingXml).not.toContain('w:rsidR=');
    },
  );

  conformanceTest.openspec('Accept and reject restore topology')(
    'keeps the split on accept and restores the exact original setup on reject',
    () => {
      const tracked = makeDocument();
      const originalSections = getDocumentSections(tracked);
      insertSectionBreak(
        tracked,
        {
          anchorParagraphId: paragraphId(tracked, 0),
          breakType: 'evenPage',
          inheritProperties: false,
          newSection: {
            pageNumberStart: 1,
            pageSize: { widthTwips: 15840, heightTwips: 12240 },
            margins: {
              topTwips: 720,
              rightTwips: 720,
              bottomTwips: 720,
              leftTwips: 720,
              headerTwips: 360,
              footerTwips: 360,
              gutterTwips: 0,
            },
          },
        },
        createRevisionContext({
          author: 'AI',
          date: '2026-07-28T20:00:00Z',
          idState: createRevisionIdState(40),
        }),
      );

      const accepted = parseXml(serializeXml(tracked));
      acceptChanges(accepted);
      expect(getDocumentSections(accepted)).toHaveLength(2);
      expect(getDocumentSections(accepted)[1]?.pageNumberStart).toBe(1);
      expect(serializeXml(accepted)).not.toMatch(/<w:(?:ins|sectPrChange)\b/);

      const rejected = parseXml(serializeXml(tracked));
      rejectChanges(rejected);
      expect(getDocumentSections(rejected)).toEqual(originalSections);
      expect(rejected.getElementsByTagNameNS(W_NS, W.p)).toHaveLength(2);
      expect(serializeXml(rejected)).not.toMatch(/<w:(?:ins|sectPrChange)\b/);
    },
  );

  conformanceTest.openspec('Reject unsupported or stale anchors atomically')(
    'rejects invalid anchors, existing boundaries, and incomplete reset setup without mutation',
    () => {
      const doc = makeDocument();
      const before = serializeXml(doc);
      expect(() => insertSectionBreak(doc, {
        anchorParagraphId: '_bk_missing',
        breakType: 'nextPage',
      })).toThrowError(SectionMutationError);
      expect(() => insertSectionBreak(doc, {
        anchorParagraphId: paragraphId(doc, 0),
        breakType: 'nextPage',
        inheritProperties: false,
        newSection: { pageSize: { orientation: 'landscape' } },
      })).toThrowError(SectionMutationError);
      expect(serializeXml(doc)).toBe(before);

      const nested = parseXml(
        `<w:document xmlns:w="${W_NS}"><w:body><w:tbl><w:tr><w:tc>`
          + '<w:p><w:r><w:t>Nested</w:t></w:r></w:p>'
          + '</w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>',
      );
      insertParagraphBookmarks(nested, 'nested-section-break-test');
      expect(() => insertSectionBreak(nested, {
        anchorParagraphId: paragraphId(nested, 0),
        breakType: 'continuous',
      })).toThrowError(SectionMutationError);
    },
  );
});
