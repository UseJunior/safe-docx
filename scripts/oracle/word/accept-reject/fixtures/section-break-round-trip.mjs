// The nine #1144 part A round-trip pairs (#1171), ported from
// packages/docx-compare/src/tagged/sectionBreakParagraphMark.test.ts.
//
// Each pair adds or removes a paragraph-level section break. The oracle compares the pair with
// our compareDocuments, then asks Word to Accept All (which must give back the revised document)
// and Reject All (which must give back the original), and checks our appliers against Word.
import { buildPackage } from './package.mjs';

const HEADER_ONE = { id: 'rIdHeaderOne', kind: 'header', target: 'header1.xml', text: 'HEADER-ONE' };
const FOOTER_ONE = { id: 'rIdFooterOne', kind: 'footer', target: 'footer1.xml', text: 'FOOTER-ONE' };
const HEADER_TWO = { id: 'rIdHeaderTwo', kind: 'header', target: 'header2.xml', text: 'HEADER-TWO' };
const FOOTER_TWO = { id: 'rIdFooterTwo', kind: 'footer', target: 'footer2.xml', text: 'FOOTER-TWO' };

const PORTRAIT = '<w:pgSz w:w="12240" w:h="15840"/>';
const LANDSCAPE = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>';
const NEXT_PAGE = '<w:type w:val="nextPage"/>';

const references = (...parts) => parts.map((p) => `<w:${p.kind}Reference w:type="default" r:id="${p.id}"/>`).join('');
const section = (...contents) => `<w:sectPr>${contents.join('')}</w:sectPr>`;
function paragraph(text, properties = '') {
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;
}
const table = (text) => '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>'
  + `<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${paragraph(text)}</w:tc></w:tr></w:tbl>`;

const ONE_SECTION_FINAL = section(references(HEADER_ONE, FOOTER_ONE), PORTRAIT);
const LANDSCAPE_FINAL = section(references(HEADER_TWO, FOOTER_TWO), LANDSCAPE);
const FIRST_SECTION = section(references(HEADER_ONE, FOOTER_ONE), NEXT_PAGE, PORTRAIT);
const ALL_PARTS = [HEADER_ONE, FOOTER_ONE, HEADER_TWO, FOOTER_TWO];

/** `{ id, label, original: {body, finalSection, parts}, revised: {...} }`, in the test file's order. */
export const ROUND_TRIP_CASES = [
  {
    id: 'c1-removed-break-paragraph-survives',
    label: 'a removed break whose paragraph survives',
    original: { body: paragraph('First section', FIRST_SECTION) + paragraph('Second section'), finalSection: LANDSCAPE_FINAL, parts: ALL_PARTS },
    revised: { body: paragraph('First section') + paragraph('Second section'), finalSection: LANDSCAPE_FINAL, parts: [HEADER_TWO, FOOTER_TWO] },
  },
  {
    id: 'c2-added-nondefault-break',
    label: 'an added non-default break on an existing paragraph',
    original: { body: paragraph('First part') + paragraph('Second part'), finalSection: ONE_SECTION_FINAL, parts: [HEADER_ONE, FOOTER_ONE] },
    revised: {
      body: paragraph('First part', section(references(HEADER_ONE, FOOTER_ONE), NEXT_PAGE, LANDSCAPE)) + paragraph('Second part'),
      finalSection: ONE_SECTION_FINAL, parts: [HEADER_ONE, FOOTER_ONE],
    },
  },
  {
    id: 'c3-added-default-break',
    label: 'an added default (empty) break',
    original: { body: paragraph('First part') + paragraph('Second part'), finalSection: ONE_SECTION_FINAL, parts: [HEADER_ONE, FOOTER_ONE] },
    revised: { body: paragraph('First part', '<w:sectPr/>') + paragraph('Second part'), finalSection: ONE_SECTION_FINAL, parts: [HEADER_ONE, FOOTER_ONE] },
  },
  {
    id: 'c4-removed-break-text-and-alignment-change',
    label: 'a removed break on a paragraph whose text and alignment also change',
    original: { body: paragraph('First section', `<w:jc w:val="center"/>${FIRST_SECTION}`) + paragraph('Second section'), finalSection: LANDSCAPE_FINAL, parts: ALL_PARTS },
    revised: { body: paragraph('First section, edited', '<w:jc w:val="right"/>') + paragraph('Second section'), finalSection: LANDSCAPE_FINAL, parts: [HEADER_TWO, FOOTER_TWO] },
  },
  {
    id: 'c5-added-break-mark-formatting-change',
    label: 'an added break on a paragraph whose mark formatting also changes',
    original: { body: paragraph('First part', '<w:rPr><w:b/></w:rPr>') + paragraph('Second part'), finalSection: ONE_SECTION_FINAL, parts: [HEADER_ONE, FOOTER_ONE] },
    revised: {
      body: paragraph('First part', `<w:rPr><w:i/></w:rPr>${section(references(HEADER_ONE, FOOTER_ONE), LANDSCAPE)}`) + paragraph('Second part'),
      finalSection: ONE_SECTION_FINAL, parts: [HEADER_ONE, FOOTER_ONE],
    },
  },
  {
    id: 'c6-removed-break-empty-boundary',
    label: 'a removed break on an empty boundary paragraph',
    original: { body: paragraph('First section') + paragraph('', FIRST_SECTION) + paragraph('Second section'), finalSection: LANDSCAPE_FINAL, parts: ALL_PARTS },
    revised: { body: paragraph('First section') + paragraph('Second section'), finalSection: LANDSCAPE_FINAL, parts: [HEADER_TWO, FOOTER_TWO] },
  },
  {
    id: 'c7-added-break-new-empty-paragraph',
    label: 'an added break on a new empty paragraph',
    original: { body: paragraph('First part') + paragraph('Second part'), finalSection: ONE_SECTION_FINAL, parts: [HEADER_ONE, FOOTER_ONE] },
    revised: {
      body: paragraph('First part') + paragraph('', section(references(HEADER_ONE, FOOTER_ONE), NEXT_PAGE, LANDSCAPE)) + paragraph('Second part'),
      finalSection: ONE_SECTION_FINAL, parts: [HEADER_ONE, FOOTER_ONE],
    },
  },
  {
    id: 'c8-removed-middle-of-three',
    label: 'removing the middle of three breaks',
    original: {
      body: paragraph('Alpha', FIRST_SECTION) + paragraph('Bravo', section(references(HEADER_TWO), NEXT_PAGE, LANDSCAPE)) + paragraph('Charlie'),
      finalSection: section(references(FOOTER_TWO), PORTRAIT), parts: ALL_PARTS,
    },
    revised: {
      body: paragraph('Alpha', FIRST_SECTION) + paragraph('Bravo') + paragraph('Charlie'),
      finalSection: section(references(FOOTER_TWO), PORTRAIT), parts: [HEADER_ONE, FOOTER_ONE, FOOTER_TWO],
    },
  },
  {
    id: 'c9-removed-break-before-table',
    label: 'a removed break before a table',
    original: { body: paragraph('First section', FIRST_SECTION) + table('Cell') + paragraph('After the table'), finalSection: LANDSCAPE_FINAL, parts: ALL_PARTS },
    revised: { body: paragraph('First section') + table('Cell') + paragraph('After the table'), finalSection: LANDSCAPE_FINAL, parts: [HEADER_TWO, FOOTER_TWO] },
  },
];

/** The .docx bytes of one side of a pair. */
export function buildRoundTripSide(side) {
  return buildPackage(side.body + side.finalSection, side.parts);
}
