// The 30-fixture section-boundary matrix behind #1188 (issue #1144 part B).
//
// Two shapes remove a paragraph-owned section boundary:
// - S1e: an empty boundary paragraph whose INSERTED mark owns the w:sectPr (removed by Reject All);
// - S3b: a content paragraph whose DELETED mark owns the w:sectPr (removed by Accept All).
// The removed section is landscape and bound to header/footer set A. The variants change what the
// surviving (next) section binds, which is what decides whether Word copies A's references onto it.
// v0-v4 run with the survivor at body level and at paragraph level; v5-v9 at body level only.
//
// The XML matches the fixtures the #1188 Word runs used, byte for byte in word/document.xml.
import { buildPackage } from './package.mjs';

const TYPES = ['default', 'first', 'even'];
const SETS = { A: 0, B: 3, C: 6 };
const DATE = 'w:author="Tester" w:date="2026-10-08T00:00:00Z"';

/** Every header and footer part: set A → 1-3, B → 4-6, C → 7-9, text `H-<set>-<type>`. */
export const MATRIX_STORIES = Object.entries(SETS).flatMap(([set, base]) =>
  TYPES.flatMap((type, i) => [
    { id: `rIdH${set}${type}`, kind: 'header', target: `header${base + i + 1}.xml`, text: `H-${set}-${type}` },
    { id: `rIdF${set}${type}`, kind: 'footer', target: `footer${base + i + 1}.xml`, text: `F-${set}-${type}` },
  ]));

function sectPr({ set, headers = [], footers = [], landscape = false, titlePg = false, nextPage = false }) {
  const h = headers.map((t) => `<w:headerReference w:type="${t}" r:id="rIdH${set}${t}"/>`).join('');
  const f = footers.map((t) => `<w:footerReference w:type="${t}" r:id="rIdF${set}${t}"/>`).join('');
  const size = landscape ? '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>' : '<w:pgSz w:w="12240" w:h="15840"/>';
  return `<w:sectPr>${h}${f}${nextPage ? '<w:type w:val="nextPage"/>' : ''}${size}`
    + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
    + `${titlePg ? '<w:titlePg/>' : ''}</w:sectPr>`;
}

const paragraph = (text, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

const ALL = { headers: TYPES, footers: TYPES };
const NONE = {};

/** name → survivor bindings, removed-section overrides, positions, and an optional prior section. */
export const MATRIX_VARIANTS = {
  v0none: { survivor: NONE, removed: {}, positions: ['body', 'para'] },
  v1default: { survivor: { headers: ['default'], footers: ['default'] }, removed: {}, positions: ['body', 'para'] },
  v2all: { survivor: { ...ALL, titlePg: true }, removed: { titlePg: false }, positions: ['body', 'para'] },
  v3tponly: { survivor: { titlePg: true }, removed: { titlePg: false }, positions: ['body', 'para'] },
  v4partial: { survivor: { headers: ['default'], footers: ['default'] }, removed: { headers: ['default', 'first'], footers: ['default', 'first'] }, positions: ['body', 'para'] },
  v5hdronly: { survivor: { headers: ['default'] }, removed: {}, positions: ['body'] },
  v6ftronly: { survivor: { footers: ['default'] }, removed: {}, positions: ['body'] },
  v7firstonly: { survivor: { headers: ['first'] }, removed: {}, positions: ['body'] },
  v8evenftr: { survivor: { footers: ['even'] }, removed: {}, positions: ['body'] },
  // The removed section binds only defaults; an earlier section C binds everything.
  v9prior: { survivor: NONE, removed: { headers: ['default'], footers: ['default'], titlePg: false }, positions: ['body'], prior: true },
};

/** The body XML of one matrix fixture. */
export function matrixBody(shape, variantName, position) {
  const variant = MATRIX_VARIANTS[variantName];
  if (!variant) throw new Error(`unknown matrix variant ${variantName}`);
  const removed = sectPr({ set: 'A', ...ALL, landscape: true, titlePg: true, nextPage: true, ...variant.removed });
  const prior = variant.prior ? paragraph('Zero section', sectPr({ set: 'C', ...ALL, titlePg: true, nextPage: true })) : '';
  const boundary = shape === 's1e'
    ? paragraph('First section') + `<w:p><w:pPr><w:rPr><w:ins w:id="1" ${DATE}/></w:rPr>${removed}</w:pPr></w:p>`
    : paragraph('First section', `<w:rPr><w:del w:id="1" ${DATE}/></w:rPr>${removed}`);
  const survivor = { set: 'B', ...variant.survivor };
  const tail = position === 'body'
    ? paragraph('Second section') + sectPr(survivor)
    : paragraph('Second section', sectPr({ ...survivor, nextPage: true })) + paragraph('Third section')
      + sectPr({ set: 'C', ...ALL, titlePg: true });
  return prior + boundary + tail;
}

/**
 * The 30 fixtures, in a stable order: `{ id, shape, variant, position, primaryMode }`. The primary
 * mode is the one that removes the boundary (S1e → reject, S3b → accept); the oracle runs both.
 */
export function matrixFixtures() {
  const out = [];
  for (const shape of ['s1e', 's3b']) {
    for (const [variant, { positions }] of Object.entries(MATRIX_VARIANTS)) {
      for (const position of positions) {
        out.push({ id: `${shape}-${variant}-${position}`, shape, variant, position, primaryMode: shape === 's1e' ? 'reject' : 'accept' });
      }
    }
  }
  return out;
}

/** The .docx bytes of one matrix fixture. */
export function buildMatrixFixture({ shape, variant, position }) {
  return buildPackage(matrixBody(shape, variant, position), MATRIX_STORIES);
}
