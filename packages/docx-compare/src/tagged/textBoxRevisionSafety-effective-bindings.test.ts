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
  UnsupportedTextBoxRevisionError,
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

  test('a carried story that replaces an inherited footer on Accept All fails closed', async ({ given, when, then }: AllureBddContext) => {
    // Original: footer0 on section 0, a boxed footer1 on section 1, and a
    // final section that inherits footer1. The revision removes section 1's
    // boundary, so its final section inherits footer0. Accept All of the
    // compared output removes the boundary and, as Word does, carries
    // footer1 (all of it a tracked deletion) onto the final section, which
    // then shows a blank footer instead of footer0. Before #1204 the check
    // compared literal references without the carry and passed this output.
    const footer0: Part = { id: 'rIdFooter0', kind: 'footer', target: 'footer0.xml', xml: story('footer', 'Base footer') };
    const footer1: Part = {
      id: 'rIdFooter1', kind: 'footer', target: 'footer1.xml',
      xml: story('footer', 'Removed footer line', paragraph('Removed box')),
    };
    const [original, revised] = await given('a removed section whose footer the final section inherited', () =>
      Promise.all([
        packageWith(
          paragraph('Intro') + sectionParagraph('Zero end', reference('footer', 'rIdFooter0')) +
            paragraph('One body') + sectionParagraph('One end', reference('footer', 'rIdFooter1')) + paragraph('Two'),
          '<w:sectPr/>',
          [footer0, footer1],
        ),
        packageWith(
          paragraph('Intro') + sectionParagraph('Zero end', reference('footer', 'rIdFooter0')) +
            paragraph('One body') + paragraph('One end') + paragraph('Two'),
          '<w:sectPr/>',
          [footer0],
        ),
      ]));

    await then('the revision shows footer0 on its final section', async () => {
      expect(await shownStories(revised)).toEqual([
        '0:header:default=-', '0:footer:default=Base footer',
        '1:header:default=-', '1:footer:default=Base footer',
      ]);
    });

    await when('the pair is compared, the comparison refuses instead of publishing', async () => {
      await expect(compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).rejects.toThrow(
        UnsupportedTextBoxRevisionError,
      );
      await expect(compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).rejects.toThrow(
        /accept\/reject package projection validation/u,
      );
    });
  });

  test('a carried story that replaces an inherited footer on Reject All fails closed', async ({ given, when }: AllureBddContext) => {
    // The mirror: the revision inserts a section whose boxed footer the final
    // section then inherits. Reject All removes the inserted boundary and
    // carries the new footer (all of it a tracked insertion) onto the final
    // section, which would show a blank footer instead of footer0.
    const footer0: Part = { id: 'rIdFooter0', kind: 'footer', target: 'footer0.xml', xml: story('footer', 'Base footer') };
    const footer1: Part = {
      id: 'rIdFooter1', kind: 'footer', target: 'footer1.xml',
      xml: story('footer', 'Inserted footer line', paragraph('Inserted box')),
    };
    const [original, revised] = await given('an inserted section whose footer the final section inherits', () =>
      Promise.all([
        packageWith(
          paragraph('Intro') + sectionParagraph('Zero end', reference('footer', 'rIdFooter0')) +
            paragraph('One body') + paragraph('One end') + paragraph('Two'),
          '<w:sectPr/>',
          [footer0],
        ),
        packageWith(
          paragraph('Intro') + sectionParagraph('Zero end', reference('footer', 'rIdFooter0')) +
            paragraph('One body') + sectionParagraph('One end', reference('footer', 'rIdFooter1')) + paragraph('Two'),
          '<w:sectPr/>',
          [footer0, footer1],
        ),
      ]));

    await when('the pair is compared, the comparison refuses instead of publishing', async () => {
      await expect(compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).rejects.toThrow(
        /accept\/reject package projection validation/u,
      );
    });
  });
});

describe('content the projection check must not read as blank (review of PR #1409)', () => {
  test('a removed footer whose bordered table survives Accept All fails closed', async ({ given, when }: AllureBddContext) => {
    // The removed section's footer holds a text box and a bordered table.
    // Accept All carries the footer onto the final section; the text is a
    // tracked deletion, but the table and its borders stay, so the final
    // section does not show the revision's blank footer.
    const table =
      '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/><w:bottom w:val="single"/></w:tblBorders></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>';
    const removed: Part = {
      id: 'rIdRemoved', kind: 'footer', target: 'footer1.xml',
      xml: story('footer', 'Removed footer line', paragraph('Removed box')).replace('</w:ftr>', `${table}<w:p/></w:ftr>`),
    };
    const [original, revised] = await given('a removed section whose footer holds a bordered table', () =>
      Promise.all([
        packageWith(
          paragraph('Stable body') + sectionParagraph('End of section', reference('footer', 'rIdRemoved')) + paragraph('Final section'),
          '<w:sectPr/>',
          [removed],
        ),
        packageWith(
          paragraph('Stable body') + paragraph('End of section') + paragraph('Final section'),
          '<w:sectPr/>',
          [],
        ),
      ]));

    await when('the pair is compared, the comparison refuses instead of publishing', async () => {
      await expect(compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).rejects.toThrow(
        /accept\/reject package projection validation/u,
      );
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
