/**
 * The header/footer story checks compare what Word shows after Accept All /
 * Reject All: they project with Word's carry of a removed section boundary's
 * references (#1144) and resolve each displayed section slot through
 * inheritance, with a story that projects to blank read as no story.
 *
 * Every case removes a section boundary whose section's footer holds a text
 * box. Word 16 for Mac Accept All / Reject All of each compared output was run
 * through the local Word oracle (`npm run oracle:word:accept-reject -- --pair`
 * / `--fixture`); its displayed footer per section matched the expectations
 * pinned here (see the PR for #1204).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @see https://github.com/UseJunior/safe-docx/issues/1204
 * @see https://github.com/UseJunior/safe-docx/issues/1144
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { DocxArchive, DocxDocument, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import {
  displayedStorySlots,
  isBlankStoryPart,
  resolveEffectiveStoryBindings,
} from './effectiveStoryBindings.js';
import {
  assertAncillaryTextBoxStoryProjection,
  deletedAncillaryStoryOutputPaths,
  rejectedSelectedAncillaryStoryPaths,
  type TextBoxStoryInput,
} from './textBoxRevisionSafety.js';

const TEST_FEATURE = 'Effective Header/Footer Story Checks';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
  );

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DATE = 'w:author="Comparison" w:date="2026-11-10T00:00:00Z"';
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-10T00:00:00.000Z') };
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

interface Part { id: string; kind: 'header' | 'footer'; target: string; xml: string }

const paragraph = (text: string, pPr = ''): string =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const reference = (kind: 'header' | 'footer', id: string): string =>
  `<w:${kind}Reference w:type="default" r:id="${id}"/>`;
const sectionParagraph = (text: string, references: string, mark = ''): string =>
  `<w:p><w:pPr>${mark ? `<w:rPr>${mark}</w:rPr>` : ''}<w:sectPr>${references}</w:sectPr></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

function story(kind: 'header' | 'footer', line: string, box?: string): string {
  const root = kind === 'header' ? 'w:hdr' : 'w:ftr';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<${root} xmlns:w="${W_NS}" xmlns:v="urn:schemas-microsoft-com:vml">` +
    (box === undefined
      ? ''
      : `<w:p><w:r><w:pict><v:shape id="box1" style="width:200pt;height:40pt"><v:textbox><w:txbxContent>` +
        `${box}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`) +
    paragraph(line) + `</${root}>`;
}

async function packageWith(body: string, finalSection: string, parts: Part[], settingsXml?: string): Promise<Buffer> {
  const archive = await DocxArchive.load(
    await buildDocxFromBodyXml(body, [], { namespaces: { r: R_NS, v: 'urn:schemas-microsoft-com:vml' } }),
  );
  archive.setDocumentXml((await archive.getDocumentXml()).replace('<w:sectPr/>', finalSection));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      parts.map((part) => `<Relationship Id="${part.id}" Type="${R_NS}/${part.kind}" Target="${part.target}"/>`).join('') +
      (settingsXml === undefined ? '' : `<Relationship Id="rIdSettings" Type="${R_NS}/settings" Target="settings.xml"/>`) +
      `</Relationships>`,
  );
  for (const part of parts) archive.setFile(`word/${part.target}`, part.xml);
  if (settingsXml !== undefined) archive.setFile('word/settings.xml', settingsXml);
  // Word opens a header/footer part only under its own content type.
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>', parts.map((part) =>
    `<Override PartName="/word/${part.target}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${part.kind}+xml"/>`,
  ).join('') + (settingsXml === undefined || contentTypes.includes('/word/settings.xml')
    ? ''
    : '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>') +
    '</Types>'));
  return archive.save();
}

type Projection = (xml: string) => string;

/**
 * What each displayed section slot shows: `<section>:<kind>:<role>=<text>`,
 * with `-` for a blank story. `project` is applied to the document and to
 * every bound part, as Accept All / Reject All would.
 */
async function shownStories(buffer: Buffer, project: Projection = (xml) => xml): Promise<string[]> {
  const archive = await DocxArchive.load(buffer);
  const bindings = resolveEffectiveStoryBindings({
    documentXml: project(await archive.getDocumentXml()),
    relationshipsXml: await archive.getFile('word/_rels/document.xml.rels'),
    settingsXml: await archive.getFile('word/settings.xml'),
  });
  const shown: string[] = [];
  for (const slot of displayedStorySlots(bindings)) {
    const xml = slot.targetPath ? await archive.getFile(slot.targetPath) : null;
    const projected = xml === null ? null : project(xml);
    const text = projected === null || isBlankStoryPart(projected)
      ? '-'
      : Array.from(parseXml(projected).getElementsByTagNameNS(W_NS, 't'))
        .map((text) => text.textContent ?? '').join(' ').trim().replace(/\s+/gu, ' ');
    shown.push(`${slot.sectionOrdinal}:${slot.kind}:${slot.role}=${text}`);
  }
  return shown;
}

/** The same, after docx-core's whole-package Accept All / Reject All. */
async function shownAfterDocxCore(buffer: Buffer, mode: 'accept' | 'reject'): Promise<string[]> {
  const document = await DocxDocument.load(buffer);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return shownStories((await document.toBuffer()).buffer);
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1204-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function bodyText(xml: string): string {
  return extractRoundTripComparisonText(xml);
}

/**
 * The compared output reproduces, page by page, the footers and headers the
 * revision shows after Accept All and the original shows after Reject All,
 * under both appliers, with the body text and a schema-valid package.
 */
async function expectDisplayedParity(original: Buffer, revised: Buffer, compared: Buffer): Promise<void> {
  const accepted = await shownStories(revised);
  const rejected = await shownStories(original);
  expect(await shownStories(compared, acceptAllChanges)).toEqual(accepted);
  expect(await shownStories(compared, rejectAllChanges)).toEqual(rejected);
  expect(await shownAfterDocxCore(compared, 'accept')).toEqual(accepted);
  expect(await shownAfterDocxCore(compared, 'reject')).toEqual(rejected);
  const documentXml = await (await DocxArchive.load(compared)).getDocumentXml();
  expect(bodyText(acceptAllChanges(documentXml))).toBe(bodyText(await (await DocxArchive.load(revised)).getDocumentXml()));
  expect(bodyText(rejectAllChanges(documentXml))).toBe(bodyText(await (await DocxArchive.load(original)).getDocumentXml()));
  await assertSchema(compared);
}

const BASE_FOOTER: Part = { id: 'rIdFooter0', kind: 'footer', target: 'footer0.xml', xml: story('footer', 'Base footer') };

/**
 * Footer0 on section 0, a boxed footer1 on section 1, and a final section
 * with no references, which inherits footer1 where section 1's boundary
 * exists and footer0 where it does not. `removed` drops the boundary in the
 * revision; `inserted` adds it.
 */
function carriedFooterPair(
  direction: 'removed' | 'inserted',
  footer0: Part = BASE_FOOTER,
  footer1Ending = '',
): Promise<[Buffer, Buffer]> {
  const label = direction === 'removed' ? 'Removed' : 'Inserted';
  const footer1: Part = {
    id: 'rIdFooter1', kind: 'footer', target: 'footer1.xml',
    xml: story('footer', `${label} footer line`, paragraph(`${label} box`)).replace('</w:ftr>', `${footer1Ending}</w:ftr>`),
  };
  const head = paragraph('Intro') + sectionParagraph('Zero end', reference('footer', 'rIdFooter0')) + paragraph('One body');
  const withBoundary = packageWith(
    head + sectionParagraph('One end', reference('footer', 'rIdFooter1')) + paragraph('Two'),
    '<w:sectPr/>',
    [footer0, footer1],
  );
  const withoutBoundary = packageWith(head + paragraph('One end') + paragraph('Two'), '<w:sectPr/>', [footer0]);
  return Promise.all(direction === 'removed' ? [withBoundary, withoutBoundary] : [withoutBoundary, withBoundary]);
}

/**
 * A section whose boxed footer also holds a table with the given borders,
 * over a final section with no references; `removed` drops the section's
 * boundary in the revision, `inserted` adds it.
 */
function tableFooterPair(direction: 'removed' | 'inserted', borders: string, cellText = ''): Promise<[Buffer, Buffer]> {
  const label = direction === 'removed' ? 'Removed' : 'Inserted';
  const table =
    `<w:tbl><w:tblPr><w:tblBorders>${borders}</w:tblBorders></w:tblPr>` +
    '<w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc>' +
    (cellText ? paragraph(cellText) : '<w:p/>') + '</w:tc></w:tr></w:tbl>';
  const footer: Part = {
    id: 'rIdTableFooter', kind: 'footer', target: 'footer1.xml',
    xml: story('footer', `${label} footer line`, paragraph(`${label} box`)).replace('</w:ftr>', `${table}<w:p/></w:ftr>`),
  };
  const withBoundary = packageWith(
    paragraph('Stable body') + sectionParagraph('End of section', reference('footer', 'rIdTableFooter')) + paragraph('Final section'),
    '<w:sectPr/>',
    [footer],
  );
  const withoutBoundary = packageWith(paragraph('Stable body') + paragraph('End of section') + paragraph('Final section'), '<w:sectPr/>', []);
  return Promise.all(direction === 'removed' ? [withBoundary, withoutBoundary] : [withoutBoundary, withBoundary]);
}

const SINGLE_BORDERS = '<w:top w:val="single"/><w:bottom w:val="single"/>';
const NIL_BORDERS = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((edge) => `<w:${edge} w:val="nil"/>`).join('');

const SHARED_FOOTER = (box: string): Part => ({
  id: 'rIdShared', kind: 'footer', target: 'footer1.xml',
  xml: story('footer', 'Shared footer line', paragraph(box)),
});
const SURVIVOR_HEADER: Part = {
  id: 'rIdSurvivorHeader', kind: 'header', target: 'header2.xml',
  xml: story('header', 'Survivor header'),
};
const SURVIVOR_FOOTER: Part = {
  id: 'rIdSurvivorFooter', kind: 'footer', target: 'footer2.xml',
  xml: story('footer', 'Survivor footer'),
};

/**
 * Three sections. The first two share a footer whose text box changes; the
 * revision removes the second section's boundary, so the final section is
 * the survivor. `survivor` sets the final section's own references.
 */
function removedBoundaryPair(survivor: { references: string; parts: readonly Part[] }): Promise<[Buffer, Buffer]> {
  const shared = reference('footer', 'rIdShared');
  return Promise.all([
    packageWith(
      sectionParagraph('First section', shared) + paragraph('Second body') +
        sectionParagraph('Second section end', shared) + paragraph('Third section'),
      `<w:sectPr>${survivor.references}</w:sectPr>`,
      [SHARED_FOOTER('Original box text'), ...survivor.parts],
    ),
    packageWith(
      sectionParagraph('First section', shared) + paragraph('Second body') +
        paragraph('Second section end') + paragraph('Third section'),
      `<w:sectPr>${survivor.references}</w:sectPr>`,
      [SHARED_FOOTER('Revised box text'), ...survivor.parts],
    ),
  ]);
}

const SURVIVOR_VARIANTS = [
  {
    name: 'has no references, so Accept All carries the removed section\'s footer onto it',
    survivor: { references: '', parts: [] as Part[] },
    accepted: [
      '0:header:default=-', '0:footer:default=Revised box text Shared footer line',
      '1:header:default=-', '1:footer:default=Revised box text Shared footer line',
    ],
    rejected: [
      '0:header:default=-', '0:footer:default=Original box text Shared footer line',
      '1:header:default=-', '1:footer:default=Original box text Shared footer line',
      '2:header:default=-', '2:footer:default=Original box text Shared footer line',
    ],
  },
  {
    name: 'has a header of its own, so nothing is carried and its footer stays inherited',
    survivor: { references: reference('header', 'rIdSurvivorHeader'), parts: [SURVIVOR_HEADER] },
    accepted: [
      '0:header:default=-', '0:footer:default=Revised box text Shared footer line',
      '1:header:default=Survivor header', '1:footer:default=Revised box text Shared footer line',
    ],
    rejected: [
      '0:header:default=-', '0:footer:default=Original box text Shared footer line',
      '1:header:default=-', '1:footer:default=Original box text Shared footer line',
      '2:header:default=Survivor header', '2:footer:default=Original box text Shared footer line',
    ],
  },
  {
    name: 'has a header and a footer of its own, so nothing is carried',
    survivor: {
      references: reference('header', 'rIdSurvivorHeader') + reference('footer', 'rIdSurvivorFooter'),
      parts: [SURVIVOR_HEADER, SURVIVOR_FOOTER],
    },
    accepted: [
      '0:header:default=-', '0:footer:default=Revised box text Shared footer line',
      '1:header:default=Survivor header', '1:footer:default=Survivor footer',
    ],
    rejected: [
      '0:header:default=-', '0:footer:default=Original box text Shared footer line',
      '1:header:default=-', '1:footer:default=Original box text Shared footer line',
      '2:header:default=Survivor header', '2:footer:default=Survivor footer',
    ],
  },
] as const;

describe('removed section boundary whose footer holds a changed text box (#1204)', () => {
  for (const variant of SURVIVOR_VARIANTS) {
    test(`redlines the text box when the surviving section ${variant.name}`, async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('a section boundary removed between two sections sharing the boxed footer', () =>
        removedBoundaryPair(variant.survivor));
      const result = await when('the pair is compared', () =>
        compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      const archive = await DocxArchive.load(result.document);
      const footer = (await archive.getFile('word/footer1.xml'))!;

      await then('the text box carries the tracked edit', () => {
        const box = parseXml(footer).getElementsByTagNameNS(W_NS, 'txbxContent').item(0)!;
        expect(Array.from(box.getElementsByTagNameNS(W_NS, 'delText')).map((t) => t.textContent).join('')).toContain('Original');
        expect(Array.from(box.getElementsByTagNameNS(W_NS, 'ins')).length).toBeGreaterThan(0);
      });

      await then('both appliers show, per section, the footer and header Word shows', async () => {
        expect(await shownStories(revised)).toEqual(variant.accepted);
        expect(await shownStories(original)).toEqual(variant.rejected);
        expect(await shownStories(result.document, acceptAllChanges)).toEqual(variant.accepted);
        expect(await shownStories(result.document, rejectAllChanges)).toEqual(variant.rejected);
        expect(await shownAfterDocxCore(result.document, 'accept')).toEqual(variant.accepted);
        expect(await shownAfterDocxCore(result.document, 'reject')).toEqual(variant.rejected);
      });

      await then('accept-all and reject-all reproduce the body text, and the package is schema-valid', async () => {
        const documentXml = await archive.getDocumentXml();
        expect(bodyText(acceptAllChanges(documentXml))).toBe(bodyText(await (await DocxArchive.load(revised)).getDocumentXml()));
        expect(bodyText(rejectAllChanges(documentXml))).toBe(bodyText(await (await DocxArchive.load(original)).getDocumentXml()));
        await assertSchema(result.document);
      });
    });
  }
});

describe('the projection check compares displayed stories, not literal references (#1204)', () => {
  test('a survivor that names the inherited footer explicitly is the same story graph', async ({ given, when, then }: AllureBddContext) => {
    // Original: section 1 inherits footer1 from section 0. Revised: one
    // section that names footer1 itself. The compared output keeps the
    // removed boundary on a deleted paragraph mark, and its final section
    // names footer1, so Reject All leaves an explicit reference where the
    // original inherited one. Both show footer1 on every page; Word 16 Accept
    // All / Reject All of this output reproduce the revised / original
    // footers and body text.
    const footerReference = reference('footer', 'rIdShared');
    const [original, revised, compared] = await given('an original, a revision and its compared output', () =>
      Promise.all([
        packageWith(
          sectionParagraph('First section', footerReference) + paragraph('Second section'),
          '<w:sectPr/>',
          [SHARED_FOOTER('Original box text')],
        ),
        packageWith(
          paragraph('First section') + paragraph('Second section'),
          `<w:sectPr>${footerReference}</w:sectPr>`,
          [SHARED_FOOTER('Revised box text')],
        ),
        packageWith(
          // The shape the comparison emits for a removed break whose
          // paragraph survives: the text keeps an inserted mark, and an
          // empty paragraph with a deleted mark owns the old w:sectPr.
          paragraph('First section', `<w:rPr><w:ins w:id="4" ${DATE}/></w:rPr>`) +
            `<w:p><w:pPr><w:rPr><w:del w:id="1" ${DATE}/></w:rPr><w:sectPr>${footerReference}</w:sectPr></w:pPr></w:p>` +
            paragraph('Second section'),
          `<w:sectPr>${footerReference}</w:sectPr>`,
          [{
            ...SHARED_FOOTER(''),
            xml: story(
              'footer',
              'Shared footer line',
              `<w:p><w:del w:id="2" ${DATE}><w:r><w:delText>Original</w:delText></w:r></w:del>` +
                `<w:ins w:id="3" ${DATE}><w:r><w:t>Revised</w:t></w:r></w:ins>` +
                `<w:r><w:t xml:space="preserve"> box text</w:t></w:r></w:p>`,
            ),
          }],
        ),
      ]));

    await then('the original and the rejected output show footer1 on both sections', async () => {
      expect(await shownStories(original)).toEqual(await shownStories(compared, rejectAllChanges));
      expect(await shownStories(revised)).toEqual(await shownStories(compared, acceptAllChanges));
      const comparedXml = await (await DocxArchive.load(compared)).getDocumentXml();
      expect(bodyText(acceptAllChanges(comparedXml))).toBe(bodyText(await (await DocxArchive.load(revised)).getDocumentXml()));
      expect(bodyText(rejectAllChanges(comparedXml))).toBe(bodyText(await (await DocxArchive.load(original)).getDocumentXml()));
    });

    await when('the projection check runs', async () => {
      await expect(assertAncillaryTextBoxStoryProjection(original, revised, compared)).resolves.toBeUndefined();
    });
  });

  test('a carried story that replaces an inherited footer on Accept All is tracked as content', async ({ given, when, then }: AllureBddContext) => {
    // Original: footer0 on section 0, a boxed footer1 on section 1, and a
    // final section that inherits footer1. The revision removes section 1's
    // boundary, so its final section inherits footer0. Accept All of the
    // compared output removes the boundary and, as Word does, carries
    // footer1 (all of it a tracked deletion) onto the final section, which
    // would then show a blank footer instead of footer0. A w:sectPrChange
    // cannot hold the reference (#944), so the display change is tracked as
    // content: footer1 also holds footer0's text as a tracked insertion after
    // its own deleted text (#1454).
    const [original, revised] = await given('a removed section whose footer the final section inherited', () =>
      carriedFooterPair('removed'));

    await then('the revision shows footer0 on its final section', async () => {
      expect(await shownStories(revised)).toEqual([
        '0:header:default=-', '0:footer:default=Base footer',
        '1:header:default=-', '1:footer:default=Base footer',
      ]);
    });

    const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('footer1 holds footer0\'s text as a tracked insertion after its own deleted text', async () => {
      const footer = parseXml((await (await DocxArchive.load(result.document)).getFile('word/footer1.xml'))!);
      expect(Array.from(footer.getElementsByTagNameNS(W_NS, 'delText')).map((t) => t.textContent).join('')).toContain('Removed footer line');
      const inserted = Array.from(footer.getElementsByTagNameNS(W_NS, 'ins'))
        .flatMap((ins) => Array.from(ins.getElementsByTagNameNS(W_NS, 't'))).map((t) => t.textContent).join('');
      expect(inserted).toBe('Base footer');
    });

    await then('each section shows, under both appliers, the footer the revision or the original shows', async () => {
      await expectDisplayedParity(original, revised, result.document);
    });
  });

  test('a carried story that replaces an inherited footer on Reject All is tracked as content', async ({ given, when, then }: AllureBddContext) => {
    // The mirror: the revision inserts a section whose boxed footer the final
    // section then inherits. Reject All removes the inserted boundary and
    // carries the new footer (all of it a tracked insertion) onto the final
    // section, which would show a blank footer instead of footer0, so
    // footer1 also holds footer0's text as a tracked deletion ahead of its
    // own inserted text (#1454).
    const [original, revised] = await given('an inserted section whose footer the final section inherits', () =>
      carriedFooterPair('inserted'));

    const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('footer1 holds footer0\'s text as a tracked deletion', async () => {
      const footer = parseXml((await (await DocxArchive.load(result.document)).getFile('word/footer1.xml'))!);
      expect(Array.from(footer.getElementsByTagNameNS(W_NS, 'delText')).map((t) => t.textContent).join('')).toBe('Base footer');
    });

    await then('each section shows, under both appliers, the footer the revision or the original shows', async () => {
      await expectDisplayedParity(original, revised, result.document);
    });
  });
});

describe('a displaced story copied into the carried part (#1454)', () => {
  const pageNumberFooter = (): Part => ({
    id: 'rIdFooter0', kind: 'footer', target: 'footer0.xml',
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W_NS}">` +
      paragraph('Base first', '<w:jc w:val="left"/>') +
      '<w:sdt><w:sdtPr><w:id w:val="7"/><w:docPartObj><w:docPartGallery w:val="Page Numbers (Bottom of Page)"/>' +
      '<w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>' +
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:sdtContent></w:sdt>' +
      '<w:p><w:pPr><w:jc w:val="right"/></w:pPr></w:p></w:ftr>',
  });
  /** Alignment and text of each paragraph outside a text box. */
  const paragraphLayout = (xml: string): string[] =>
    Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'p'))
      .filter((p) => p.getElementsByTagNameNS(W_NS, 'txbxContent').length === 0 &&
        (p.parentNode as Element | null)?.localName !== 'txbxContent')
      .map((p) => {
        const pPr = Array.from(p.childNodes).find((node) => (node as Element).localName === 'pPr') as Element | undefined;
        const jc = pPr && Array.from(pPr.childNodes).find((node) => (node as Element).localName === 'jc') as Element | undefined;
        const text = Array.from(p.getElementsByTagNameNS(W_NS, 't')).map((t) => t.textContent).join('');
        return `${jc?.getAttributeNS(W_NS, 'val') ?? '-'}:${text}`;
      });
  const footerAfterDocxCore = async (buffer: Buffer, mode: 'accept' | 'reject'): Promise<string> => {
    const document = await DocxDocument.load(buffer);
    if (mode === 'accept') await document.acceptChanges();
    else await document.rejectChanges();
    return (await (await DocxArchive.load((await document.toBuffer()).buffer)).getFile('word/footer1.xml'))!;
  };

  test('a page-number footer is copied without its content control, with the final paragraph properties tracked', async ({ given, when, then }: AllureBddContext) => {
    const [original, revised] = await given('a removed section whose footer displaces an inherited page-number footer', () =>
      carriedFooterPair('removed', pageNumberFooter()));
    const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    const compared = (await (await DocxArchive.load(result.document)).getFile('word/footer1.xml'))!;

    await then('the copy carries no content control, and the final paragraph tracks its properties', () => {
      const footer = parseXml(compared);
      expect(footer.getElementsByTagNameNS(W_NS, 'sdt')).toHaveLength(0);
      expect(footer.getElementsByTagNameNS(W_NS, 'pPrChange')).toHaveLength(1);
      expect(Array.from(footer.getElementsByTagNameNS(W_NS, 'instrText')).map((t) => t.textContent).join('')).toBe(' PAGE ');
    });

    await then('each section shows, under both appliers, the footer the revision or the original shows', async () => {
      await expectDisplayedParity(original, revised, result.document);
    });

    await then('the carried footer lays out its paragraphs as the displayed story does, under both appliers', async () => {
      const revisedFooter0 = (await (await DocxArchive.load(revised)).getFile('word/footer0.xml'))!;
      const originalFooter1 = (await (await DocxArchive.load(original)).getFile('word/footer1.xml'))!;
      expect(paragraphLayout(acceptAllChanges(compared))).toEqual(paragraphLayout(revisedFooter0));
      expect(paragraphLayout(rejectAllChanges(compared))).toEqual(paragraphLayout(originalFooter1));
      expect(paragraphLayout(await footerAfterDocxCore(result.document, 'accept'))).toEqual(paragraphLayout(revisedFooter0));
      expect(paragraphLayout(await footerAfterDocxCore(result.document, 'reject'))).toEqual(paragraphLayout(originalFooter1));
    });
  });

  // A story may end in a table (CT_HdrFtr does not require a final
  // paragraph); Word shows the empty paragraph mark after it either way.
  const tableEnding =
    '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Row</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const tableEndingFooter: Part = {
    id: 'rIdFooter0', kind: 'footer', target: 'footer0.xml',
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W_NS}">` +
      paragraph('Base footer', '<w:jc w:val="center"/>') + tableEnding + '</w:ftr>',
  };
  for (const { name, pair } of [
    { name: 'a displaced footer ending in a table, across a removed boundary', pair: () => carriedFooterPair('removed', tableEndingFooter) },
    { name: 'a displaced footer ending in a table, across an inserted boundary', pair: () => carriedFooterPair('inserted', tableEndingFooter) },
  ]) {
    test(`${name} ends in a paragraph neither projection removes`, async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('the pair', pair);
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await then('the carried footer ends in a paragraph whose mark carries no revision', async () => {
        const footer = parseXml((await (await DocxArchive.load(result.document)).getFile('word/footer1.xml'))!);
        const last = Array.from(footer.documentElement.childNodes).filter((node) => node.nodeType === 1).at(-1) as Element;
        expect(last.localName).toBe('p');
        const mark = last.getElementsByTagNameNS(W_NS, 'pPr').item(0)?.getElementsByTagNameNS(W_NS, 'rPr').item(0);
        expect(Array.from(mark?.childNodes ?? []).map((node) => (node as Element).localName)).not.toContain('ins');
        expect(Array.from(mark?.childNodes ?? []).map((node) => (node as Element).localName)).not.toContain('del');
      });
      await then('each section shows, under both appliers, the footer the revision or the original shows', async () => {
        await expectDisplayedParity(original, revised, result.document);
      });
    });
  }

  test('a displaced and a carried footer both ending in a table still fail closed', async ({ given, when }: AllureBddContext) => {
    // Neither half ends in a paragraph that could close the story on both
    // sides; Word never writes such a story, as it always ends one with a
    // paragraph mark.
    const [original, revised] = await given('both footers ending in a table', () =>
      carriedFooterPair('removed', tableEndingFooter, tableEnding));
    await when('the pair is compared, the comparison refuses instead of publishing', async () => {
      await expect(compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).rejects.toThrow(
        /accept\/reject package projection validation/u,
      );
    });
  });

  test('a displaced footer holding a drawing still fails closed', async ({ given, when }: AllureBddContext) => {
    // Copying a drawing would duplicate its shape into a second part; the
    // copy is limited to text, fields and tables.
    const footer0: Part = { id: 'rIdFooter0', kind: 'footer', target: 'footer0.xml', xml: story('footer', 'Base footer', paragraph('Base box')) };
    const [original, revised] = await given('a removed section whose footer displaces an inherited footer with a text box', () =>
      carriedFooterPair('removed', footer0));
    await when('the pair is compared, the comparison refuses instead of publishing', async () => {
      await expect(compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).rejects.toThrow(
        /accept\/reject package projection validation/u,
      );
    });
  });
});

describe('content the projection check must not read as blank (review of PR #1409)', () => {
  test('a removed footer whose bordered table is tracked with its rows', async ({ given, when, then }: AllureBddContext) => {
    // The removed section's footer holds a text box and a bordered table.
    // Accept All carries the footer onto the final section; the text is a
    // tracked deletion, and the table's rows are tracked as deleted
    // (w:trPr/w:del), so the borders go with them and the final section
    // shows the revision's blank footer (#1454).
    const [original, revised] = await given('a removed section whose footer holds a bordered table', () =>
      tableFooterPair('removed', SINGLE_BORDERS));

    const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the table row carries a deleted-row marker', async () => {
      const footer = parseXml((await (await DocxArchive.load(result.document)).getFile('word/footer1.xml'))!);
      const rows = Array.from(footer.getElementsByTagNameNS(W_NS, 'tr'));
      expect(rows).toHaveLength(1);
      const trPr = Array.from(rows[0]!.childNodes).find((node) => (node as Element).localName === 'trPr') as Element;
      expect(Array.from(trPr.childNodes).map((node) => (node as Element).localName)).toContain('del');
    });

    await then('each section shows, under both appliers, the footer the revision or the original shows', async () => {
      await expectDisplayedParity(original, revised, result.document);
    });
  });

  test('an inserted footer whose bordered table is tracked with its rows', async ({ given, when, then }: AllureBddContext) => {
    // The mirror: Reject All carries the inserted section's footer onto the
    // final section, and its rows are tracked as inserted (w:trPr/w:ins).
    const [original, revised] = await given('an inserted section whose footer holds a bordered table', () =>
      tableFooterPair('inserted', SINGLE_BORDERS, 'Cell'));
    const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the table row carries an inserted-row marker, and the row count is reported', async () => {
      const footer = parseXml((await (await DocxArchive.load(result.document)).getFile('word/footer1.xml'))!);
      const trPr = footer.getElementsByTagNameNS(W_NS, 'trPr').item(0)!;
      expect(Array.from(trPr.childNodes).map((node) => (node as Element).localName)).toContain('ins');
      expect(result.stats.insertedTableRows).toBeGreaterThanOrEqual(1);
    });

    await then('each section shows, under both appliers, the footer the revision or the original shows', async () => {
      await expectDisplayedParity(original, revised, result.document);
    });
  });

  test('control: a removed footer whose table borders are all nil still publishes', async ({ given, when, then }: AllureBddContext) => {
    // Review round 2 of PR #1409: an unbordered layout table draws nothing
    // once Accept All empties its cells, so it must not read as content.
    const [original, revised] = await given('a removed section whose footer holds an unbordered table', () =>
      tableFooterPair('removed', NIL_BORDERS, 'Cell'));

    const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    await then('the redline publishes and passes the schema gate', async () => {
      await assertSchema(result.document);
    });
  });

  test('turning on different even pages alongside a text-box edit fails closed', async ({ given, when }: AllureBddContext) => {
    // The compared package carries the revised settings part, so Reject All
    // leaves w:evenAndOddHeaders on: the original's even pages showed the
    // default footer, the rejected output's even pages show none.
    const footer = (box: string): Part => ({
      id: 'rIdFooter', kind: 'footer', target: 'footer1.xml', xml: story('footer', 'Footer line', paragraph(box)),
    });
    const settingsPart = (contents: string): string =>
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${W_NS}">${contents}</w:settings>`;
    const [original, revised] = await given('a default footer whose text box changes while even pages are turned on', () =>
      Promise.all([
        packageWith(paragraph('Body'), `<w:sectPr>${reference('footer', 'rIdFooter')}</w:sectPr>`, [footer('Old box')], settingsPart('')),
        packageWith(
          paragraph('Body'),
          `<w:sectPr>${reference('footer', 'rIdFooter')}</w:sectPr>`,
          [footer('New box')],
          settingsPart('<w:evenAndOddHeaders/>'),
        ),
      ]));

    await when('the pair is compared, the comparison refuses instead of publishing', async () => {
      await expect(compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).rejects.toThrow(
        /accept\/reject package projection validation/u,
      );
    });
  });

  test('control: the same text-box edit with the setting unchanged still redlines', async ({ given, when }: AllureBddContext) => {
    const footer = (box: string): Part => ({
      id: 'rIdFooter', kind: 'footer', target: 'footer1.xml', xml: story('footer', 'Footer line', paragraph(box)),
    });
    const settingsPart = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${W_NS}"><w:evenAndOddHeaders/></w:settings>`;
    const [original, revised] = await given('a default footer whose text box changes, even pages on in both', () =>
      Promise.all([
        packageWith(paragraph('Body'), `<w:sectPr>${reference('footer', 'rIdFooter')}</w:sectPr>`, [footer('Old box')], settingsPart),
        packageWith(paragraph('Body'), `<w:sectPr>${reference('footer', 'rIdFooter')}</w:sectPr>`, [footer('New box')], settingsPart),
      ]));

    await when('the pair is compared, the redline publishes', async () => {
      const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
      await assertSchema(result.document);
    });
  });
});

describe('lifecycle story selection with the carry applied (#1204)', () => {
  const footer: Part = {
    id: 'rIdStory', kind: 'footer', target: 'footer1.xml',
    xml: story('footer', 'Lifecycle footer line', paragraph('Lifecycle box')),
  };

  test('a reference Reject All only carries from an inserted boundary does not select the story', async ({ given, then }: AllureBddContext) => {
    const compared = await given('an inserted paragraph mark owning a section that selects the footer, over a final section with none', () =>
      packageWith(
        paragraph('Stable body') + sectionParagraph('Inserted section', reference('footer', 'rIdStory'), `<w:ins w:id="1" ${DATE}/>`) +
          paragraph('Final section'),
        '<w:sectPr/>',
        [footer],
      ));
    await then('Reject All carries the reference to the final section, as Word does', async () => {
      expect([...await rejectedSelectedAncillaryStoryPaths(compared)]).toEqual(['word/footer1.xml']);
    });
    await then('with carried references ignored, the story is not selected', async () => {
      expect([...await rejectedSelectedAncillaryStoryPaths(compared, { ignoreCarriedReferences: true })]).toEqual([]);
    });
  });

  test('a reference Reject All keeps in place still selects the story', async ({ given, then }: AllureBddContext) => {
    const compared = await given('a final section that names the footer itself', () =>
      packageWith(paragraph('Body'), `<w:sectPr>${reference('footer', 'rIdStory')}</w:sectPr>`, [footer]));
    await then('the story stays selected', async () => {
      expect([...await rejectedSelectedAncillaryStoryPaths(compared, { ignoreCarriedReferences: true })]).toEqual(['word/footer1.xml']);
    });
  });

  test('a removed section\'s story carried onto the final section by Accept All stays representable', async ({ given, then }: AllureBddContext) => {
    const compared = await given('a deleted paragraph mark owning a section that selects the footer, over a final section with none', () =>
      packageWith(
        paragraph('Stable body') + sectionParagraph('Deleted section', reference('footer', 'rIdStory'), `<w:del w:id="1" ${DATE}/>`) +
          paragraph('Final section'),
        '<w:sectPr/>',
        [footer],
      ));
    const story: TextBoxStoryInput = {
      index: 0,
      visualIndex: 0,
      partPath: 'word/footer1.xml',
      container: 'ancillaryPart',
      ancillaryMode: 'deleted',
      selectedSlots: [{ sectionOrdinal: 0, kind: 'footer', role: 'default' }],
      original: compared,
      revised: compared,
    };
    await then('the story resolves to its output part', async () => {
      const resolved = await deletedAncillaryStoryOutputPaths(compared, [story]);
      expect(resolved.get(story)).toBe('word/footer1.xml');
    });
    await then('Accept All binds the final section to it by a carried reference', async () => {
      const accepted = acceptAllChanges(await (await DocxArchive.load(compared)).getDocumentXml());
      const references = parseXml(accepted).getElementsByTagNameNS(W_NS, 'footerReference');
      expect(references).toHaveLength(1);
    });
  });
});

const STYLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
const OFFICE_NS = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';

/**
 * The footer text LibreOffice's saved ODT shows on each section, in order.
 * LibreOffice maps a DOCX section to a page style: the first paragraph of a
 * section names its master page (`style:master-page-name` on its automatic
 * paragraph style), and that master page's `style:footer` is what the
 * section's pages show. A footer that keeps a table says so, since a table's
 * borders draw without any text.
 */
async function odtFooterPerSection(bytes: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  const content = parseXml((await zip.file('content.xml')!.async('string')));
  const styles = parseXml((await zip.file('styles.xml')!.async('string')));
  const masterOf = new Map<string, string>();
  for (const style of Array.from(content.getElementsByTagNameNS(STYLE_NS, 'style'))) {
    const master = style.getAttributeNS(STYLE_NS, 'master-page-name');
    if (master) masterOf.set(style.getAttributeNS(STYLE_NS, 'name') ?? '', master);
  }
  const footerOf = new Map<string, string>();
  for (const master of Array.from(styles.getElementsByTagNameNS(STYLE_NS, 'master-page'))) {
    const footer = master.getElementsByTagNameNS(STYLE_NS, 'footer').item(0);
    const tables = footer?.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:table:1.0', 'table').length ?? 0;
    // LibreOffice can leave a zero-width joiner where it resolved a revision.
    const text = (footer?.textContent ?? '').replace(/\u200d/gu, '').replace(/\s+/gu, ' ').trim();
    footerOf.set(master.getAttributeNS(STYLE_NS, 'name') ?? '', `${text || '-'}${tables > 0 ? ` [${tables} table]` : ''}`);
  }
  const body = content.getElementsByTagNameNS(OFFICE_NS, 'text').item(0)!;
  const sections: string[] = [];
  for (const block of Array.from(body.childNodes) as Element[]) {
    if (block.nodeType !== 1) continue;
    const master = masterOf.get(block.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:text:1.0', 'style-name') ??
      block.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:table:1.0', 'style-name') ?? '');
    // The first section uses the default page style unless it names one.
    if (master) sections.push(footerOf.get(master) ?? '?');
    else if (sections.length === 0) sections.push(footerOf.get('Standard') ?? '?');
  }
  return sections;
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice.
const reader = process.env.SAFE_DOCX_CARRIED_FOOTER_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice accepts and rejects a carried footer per section (#1454)', () => {
  test('displaced inherited footers and carried bordered tables', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    // `owner` is the last section whose footer is the first (or only) page
    // style LibreOffice builds from the changed part; see below.
    const cases: Array<{ label: string; owner: number; pair: [Buffer, Buffer] }> = [
      // Baseline from #1204, untouched by #1454: LibreOffice shows the same
      // section and shared-footer behaviour for a removed boundary whose
      // shared footer's text box changed.
      { label: 'baseline: removed boundary, shared boxed footer (#1204)', owner: 0, pair: await removedBoundaryPair(SURVIVOR_VARIANTS[0].survivor) },
      { label: 'removed boundary displaces footer0', owner: 1, pair: await carriedFooterPair('removed') },
      { label: 'inserted boundary displaces footer0', owner: 1, pair: await carriedFooterPair('inserted') },
      { label: 'removed footer with a bordered table', owner: 0, pair: await tableFooterPair('removed', SINGLE_BORDERS) },
      { label: 'inserted footer with a bordered table', owner: 0, pair: await tableFooterPair('inserted', SINGLE_BORDERS, 'Cell') },
    ];
    for (const { label, owner, pair: [original, revised] } of cases) {
      const compared = (await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).document;
      const jobs = [
        { op: 'identity' as const, docx: original, saveAs: 'odt' as const },
        { op: 'identity' as const, docx: revised, saveAs: 'odt' as const },
        { op: 'accept' as const, docx: compared, saveAs: 'odt' as const },
        { op: 'reject' as const, docx: compared, saveAs: 'odt' as const },
      ];
      const packages: Buffer[] = [];
      const capture = (offset: number, bytes: Buffer) => { packages[offset] = bytes; };
      try {
        await runLibreOfficeOracle(jobs, undefined, capture);
      } catch (error) {
        if (!/produced no output/u.test(String(error))) throw error;
        await runLibreOfficeOracle(jobs, undefined, capture);
      }
      const [originalView, revisedView, acceptedView, rejectedView] = (await Promise.all(packages.map(odtFooterPerSection))) as [string[], string[], string[], string[]];
      console.log(`[#1454] ${label}: original=${JSON.stringify(originalView)} revised=${JSON.stringify(revisedView)}` +
        ` accepted=${JSON.stringify(acceptedView)} rejected=${JSON.stringify(rejectedView)}`);
      // LibreOffice does not apply a tracked section boundary as Word does:
      // it keeps the page style a removed boundary started on Accept and
      // drops one on Reject, and a footer part that two page styles share
      // keeps its revisions only in the first, so the second reads as plain
      // text holding both sides (the #1204 baseline shows both). The verdict
      // is therefore the sections up to the one whose page style is the
      // changed part's first, where LibreOffice does apply the revisions.
      const upToOwner = (view: string[]): string[] => view.slice(0, owner + 1);
      expect(upToOwner(acceptedView), `${label} accept`).toEqual(upToOwner(revisedView));
      expect(upToOwner(rejectedView), `${label} reject`).toEqual(upToOwner(originalView));
    }
  }, 600_000);
});
