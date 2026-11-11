/**
 * `unrepresentedChanges` lists only the section and header/footer changes the
 * redline does not carry.
 *
 * `detectUnrepresentedChanges` pairs the two documents' sections by index.
 * After a section break is added or removed, every later index pairs sections
 * the body comparison never aligned, so the positional entries describe
 * differences the redline may carry in full. An entry is dropped only where
 * Reject All of the redline reproduces the original and Accept All the
 * revised document at that index, in that scope (section properties, or the
 * header/footer story each page shows). Every other entry stays: the cases at
 * the end of this file pin shapes that are still not represented.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @see https://github.com/UseJunior/safe-docx/issues/1427
 * @see https://github.com/UseJunior/safe-docx/issues/1181
 * @see https://github.com/UseJunior/safe-docx/issues/1030
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { DocxArchive, DocxDocument, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { compareSourceProjectedFormattingFidelity } from './formattingFidelity.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import {
  isBlankStoryPart,
  pageStorySlots,
  resolveEffectiveStoryBindings,
} from './effectiveStoryBindings.js';

const TEST_FEATURE = 'docx-comparison';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
  );

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-11T00:00:00.000Z') };
const PORTRAIT = '<w:pgSz w:w="12240" w:h="15840"/>';
const LANDSCAPE = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>';
const MARGINS = '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

type Kind = 'header' | 'footer';
interface Part { id: string; kind: Kind; target: string; contentXml: string }

const paragraph = (text: string): string => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const ref = (kind: Kind, id: string, role = 'default'): string =>
  `<w:${kind}Reference w:type="${role}" r:id="${id}"/>`;
/** Every section carries an explicit page size and margins, as Word writes them. */
const sectionEnd = (text: string, sectPr: string): string =>
  `<w:p><w:pPr><w:sectPr>${sectPr}</w:sectPr></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const story = (id: string, kind: Kind, target: string, text: string): Part =>
  ({ id, kind, target, contentXml: paragraph(text) });

async function packageWith(
  body: string,
  finalSectPr: string,
  parts: Part[],
  settingsContents = '',
): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(body, [], { namespaces: { r: R_NS } }));
  archive.setDocumentXml((await archive.getDocumentXml()).replace('<w:sectPr/>', `<w:sectPr>${finalSectPr}</w:sectPr>`));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      parts.map((entry) => `<Relationship Id="${entry.id}" Type="${R_NS}/${entry.kind}" Target="${entry.target}"/>`).join('') +
      `<Relationship Id="rIdSettings" Type="${R_NS}/settings" Target="settings.xml"/></Relationships>`,
  );
  for (const entry of parts) {
    const root = entry.kind === 'header' ? 'w:hdr' : 'w:ftr';
    archive.setFile(
      `word/${entry.target}`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${root} xmlns:w="${W_NS}" ` +
        `xmlns:v="urn:schemas-microsoft-com:vml">${entry.contentXml}</${root}>`,
    );
  }
  archive.setFile(
    'word/settings.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${W_NS}">${settingsContents}</w:settings>`,
  );
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>', parts.map((entry) =>
    `<Override PartName="/word/${entry.target}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${entry.kind}+xml"/>`,
  ).join('') + (contentTypes.includes('/word/settings.xml')
    ? ''
    : '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>') +
    '</Types>'));
  return archive.save();
}

type Projection = (xml: string) => string;
const identity: Projection = (xml) => xml;

/** What each first, odd and even page of each section shows, `-` for a blank story. */
async function shownPages(buffer: Buffer, project: Projection = identity): Promise<string[]> {
  const archive = await DocxArchive.load(buffer);
  const bindings = resolveEffectiveStoryBindings({
    documentXml: project(await archive.getDocumentXml()),
    relationshipsXml: await archive.getFile('word/_rels/document.xml.rels'),
    settingsXml: await archive.getFile('word/settings.xml'),
  });
  const shown: string[] = [];
  for (const { page, slot } of pageStorySlots(bindings)) {
    const xml = slot.targetPath ? await archive.getFile(slot.targetPath) : null;
    const projected = xml === null ? null : project(xml);
    const text = projected === null || isBlankStoryPart(projected)
      ? '-'
      : extractRoundTripComparisonText(projected).trim();
    shown.push(`${slot.sectionOrdinal}:${slot.kind}:${page}=${text}`);
  }
  return shown;
}

/** Each live section's properties other than header/footer references, in document order. */
async function sectionLayouts(buffer: Buffer, project: Projection = identity): Promise<string[]> {
  const document = parseXml(project(await (await DocxArchive.load(buffer)).getDocumentXml()));
  return Array.from(document.getElementsByTagNameNS(W_NS, 'sectPr'))
    .filter((section) => (section.parentNode as Element | null)?.localName !== 'sectPrChange')
    .map((section) => Array.from(section.childNodes)
      .filter((node): node is Element => node.nodeType === 1)
      .filter((child) => !/Reference$/u.test(child.localName) && child.localName !== 'sectPrChange')
      .map((child) => `${child.localName}${Array.from(child.attributes).map((a) => `|${a.localName}=${a.value}`).sort().join('')}`)
      .join(' '));
}

async function shownAfterDocxCore(buffer: Buffer, mode: 'accept' | 'reject'): Promise<string[]> {
  const document = await DocxDocument.load(buffer);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return shownPages((await document.toBuffer()).buffer);
}

const bodyText = async (buffer: Buffer, project: Projection = identity): Promise<string> =>
  extractRoundTripComparisonText(project(await (await DocxArchive.load(buffer)).getDocumentXml()));

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1427-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * The redline reproduces both documents: body text, section layout and the
 * story every page shows, with docx-compare's appliers and docx-core's.
 */
async function expectFaithfulProjections(original: Buffer, revised: Buffer, compared: Buffer): Promise<void> {
  expect(await bodyText(compared, acceptAllChanges)).toBe(await bodyText(revised, acceptAllChanges));
  expect(await bodyText(compared, rejectAllChanges)).toBe(await bodyText(original, rejectAllChanges));
  expect(await sectionLayouts(compared, acceptAllChanges)).toEqual(await sectionLayouts(revised));
  expect(await sectionLayouts(compared, rejectAllChanges)).toEqual(await sectionLayouts(original));
  expect(await shownPages(compared, acceptAllChanges)).toEqual(await shownPages(revised));
  expect(await shownPages(compared, rejectAllChanges)).toEqual(await shownPages(original));
  expect(await shownAfterDocxCore(compared, 'accept')).toEqual(await shownPages(revised));
  expect(await shownAfterDocxCore(compared, 'reject')).toEqual(await shownPages(original));
  await assertSchema(compared);
}

const LAYOUT = PORTRAIT + MARGINS;
const THREE_SECTION_PARTS: Part[] = [
  story('rIdHeaderA', 'header', 'header1.xml', 'Header A'),
  story('rIdFooterA', 'footer', 'footer1.xml', 'Footer A'),
  story('rIdHeaderB', 'header', 'header2.xml', 'Header B'),
  story('rIdFooterB', 'footer', 'footer2.xml', 'Footer B'),
  story('rIdHeaderC', 'header', 'header3.xml', 'Header C'),
  story('rIdFooterC', 'footer', 'footer3.xml', 'Footer C'),
];
const sectionRefs = (letter: string): string => ref('header', `rIdHeader${letter}`) + ref('footer', `rIdFooter${letter}`);

describe('index-shifted section and header/footer entries the redline represents (#1427)', () => {
  test('a deleted last section break whose following section keeps its own stories, plus a body edit, reports nothing', async () => {
    // The #1416 smoke (c) shape, as in the NVCA Stock Purchase Agreement:
    // three sections, each with its own header and footer; the revision
    // deletes the last paragraph-level break and edits the body.
    const body = (firstLine: string, keepBreak: boolean): string =>
      sectionEnd(firstLine, sectionRefs('A') + LAYOUT) +
      (keepBreak ? sectionEnd('Second section.', sectionRefs('B') + LAYOUT) : paragraph('Second section.')) +
      paragraph('Third section.');
    const original = await packageWith(body('First section.', true), sectionRefs('C') + LAYOUT, THREE_SECTION_PARTS);
    const revised = await packageWith(body('First section, amended.', false), sectionRefs('C') + LAYOUT, THREE_SECTION_PARTS);

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(await sectionLayouts(result.document, rejectAllChanges)).toHaveLength(3);
    expect(await sectionLayouts(result.document, acceptAllChanges)).toHaveLength(2);
    await expectFaithfulProjections(original, revised, result.document);
    expect(result.unrepresentedChanges).toBeUndefined();
  });

  test('a deleted middle section with its own stories reports none of the later sections', async () => {
    const body = (keepMiddle: boolean): string =>
      sectionEnd('Section A.', sectionRefs('A') + LAYOUT) +
      (keepMiddle ? sectionEnd('Section B.', sectionRefs('B') + LAYOUT) : '') +
      sectionEnd('Section C.', sectionRefs('C') + LAYOUT) +
      paragraph('Final section.');
    const original = await packageWith(body(true), LAYOUT, THREE_SECTION_PARTS);
    const revised = await packageWith(body(false), LAYOUT, THREE_SECTION_PARTS);

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    await expectFaithfulProjections(original, revised, result.document);
    expect(result.unrepresentedChanges).toBeUndefined();
  });
});

describe('section breaks carried on tracked paragraph marks or w:sectPrChange (#1181)', () => {
  const cases: Array<{ label: string; original: string; revised: string }> = [
    {
      label: 'removed break',
      original: sectionEnd('First part.', LAYOUT) + paragraph('Second part.'),
      revised: paragraph('First part.') + paragraph('Second part.'),
    },
    {
      label: 'added default break',
      original: paragraph('First part.') + paragraph('Second part.'),
      revised: sectionEnd('First part.', LAYOUT) + paragraph('Second part.'),
    },
    {
      label: 'added full break',
      original: paragraph('First part.') + paragraph('Second part.'),
      revised: sectionEnd('First part.', '<w:type w:val="nextPage"/>' + LANDSCAPE + MARGINS + '<w:cols w:space="720"/>') +
        paragraph('Second part.'),
    },
    {
      label: 'page size changed with a snapshot that names every live attribute',
      original: sectionEnd('First part.', LAYOUT) + paragraph('Second part.'),
      revised: sectionEnd('First part.', '<w:pgSz w:w="11906" w:h="16838"/>' + MARGINS) + paragraph('Second part.'),
    },
  ];
  for (const scenario of cases) {
    test(`${scenario.label}: no section entry`, async () => {
      const original = await packageWith(scenario.original, LAYOUT, []);
      const revised = await packageWith(scenario.revised, LAYOUT, []);

      const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

      await expectFaithfulProjections(original, revised, result.document);
      expect(result.unrepresentedChanges).toBeUndefined();
    });
  }
});

describe('a footer text-box change carried by native revisions in the footer (#1030)', () => {
  const textBoxFooter = (text: string): Part => ({
    id: 'rIdF',
    kind: 'footer',
    target: 'footer1.xml',
    contentXml:
      '<w:p><w:r><w:pict><v:shape id="tb1" style="width:200pt;height:50pt"><v:textbox><w:txbxContent>' +
      paragraph(text) +
      '</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>',
  });

  test('the issue repro reports no footer entry', async () => {
    const original = await packageWith(paragraph('Body one.'), ref('footer', 'rIdF') + LAYOUT, [textBoxFooter('Footer box old')]);
    const revised = await packageWith(paragraph('Body one, amended.'), ref('footer', 'rIdF') + LAYOUT, [textBoxFooter('Footer box new')]);

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
    const footer = (await (await DocxArchive.load(result.document)).getFile('word/footer1.xml'))!;
    const textBox = parseXml(footer).getElementsByTagNameNS(W_NS, 'txbxContent').item(0)!;

    expect(textBox.getElementsByTagNameNS(W_NS, 'del').length).toBeGreaterThan(0);
    expect(textBox.getElementsByTagNameNS(W_NS, 'ins').length).toBeGreaterThan(0);
    expect(extractRoundTripComparisonText(acceptAllChanges(footer))).toContain('Footer box new');
    expect(extractRoundTripComparisonText(rejectAllChanges(footer))).toContain('Footer box old');
    await expectFaithfulProjections(original, revised, result.document);
    expect(result.unrepresentedChanges).toBeUndefined();
  });
});

describe('changes the redline still does not carry stay listed', () => {
  test('a header dropped from a surviving section stays listed when a represented break deletion shifts the indexes', async () => {
    // Section B (which inherits its stories) loses its break, which is
    // represented, and the surviving first section drops its header, which
    // no CT_SectPrBase snapshot can restore (#944). (When the removed section
    // owns stories, the package projection check refuses this pair outright.)
    const parts = [THREE_SECTION_PARTS[0]!, THREE_SECTION_PARTS[1]!, THREE_SECTION_PARTS[5]!];
    const body = (firstRefs: string, keepB: boolean): string =>
      sectionEnd('Section A.', firstRefs + LAYOUT) +
      (keepB ? sectionEnd('Section B.', LAYOUT) : paragraph('Section B.')) +
      paragraph('Section C.');
    const original = await packageWith(body(sectionRefs('A'), true), ref('footer', 'rIdFooterC') + LAYOUT, parts);
    const revised = await packageWith(body(ref('footer', 'rIdFooterA'), false), ref('footer', 'rIdFooterC') + LAYOUT, parts);

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    // Reject All keeps the revised first section's missing header, so the
    // redline does not reproduce the original there.
    expect(await shownPages(result.document, rejectAllChanges)).not.toEqual(await shownPages(original));
    expect(result.unrepresentedChanges).toEqual([
      { scope: 'header', kind: 'removed', sectionIndex: 0, role: 'default' },
    ]);
  });

  test('a changed footer field stays listed when a represented break deletion shifts the indexes', async () => {
    // Header/footer stories are redlined only when their field scaffold is
    // unchanged, so a PAGE -> NUMPAGES footer field keeps the revised footer
    // live and unredlined (#1432).
    const field = (instruction: string): string =>
      `<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:fldSimple w:instr=" ${instruction} "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>`;
    const footer = (instruction: string): Part =>
      ({ id: 'rIdF', kind: 'footer', target: 'footer1.xml', contentXml: field(instruction) });
    const original = await packageWith(
      sectionEnd('First part.', LAYOUT) + paragraph('Second part.'),
      ref('footer', 'rIdF') + LAYOUT,
      [footer('PAGE')],
    );
    const revised = await packageWith(
      paragraph('First part.') + paragraph('Second part.'),
      ref('footer', 'rIdF') + LAYOUT,
      [footer('NUMPAGES')],
    );

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'footer' }),
    ]));
    expect((result.unrepresentedChanges ?? []).filter((change) => change.scope === 'section')).toEqual([]);
  });

  test('turning different even pages off stays listed when a represented break deletion shifts the indexes', async () => {
    // settings.xml carries no revision markup, so Reject All keeps the
    // revised w:evenAndOddHeaders and the original's even pages lose their
    // story (fail-closed in #1412).
    const parts: Part[] = [
      story('rIdFooter', 'footer', 'footer1.xml', 'Odd footer'),
      story('rIdEven', 'footer', 'footer2.xml', 'Even footer'),
    ];
    const footers = ref('footer', 'rIdFooter') + ref('footer', 'rIdEven', 'even');
    const original = await packageWith(
      sectionEnd('First part.', LAYOUT) + paragraph('Second part.'),
      footers + LAYOUT,
      parts,
      '<w:evenAndOddHeaders/>',
    );
    const revised = await packageWith(
      paragraph('First part.') + paragraph('Second part.'),
      footers + LAYOUT,
      parts,
    );

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(await shownPages(result.document, rejectAllChanges)).not.toEqual(await shownPages(original));
    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'footer', role: 'even' }),
    ]));
  });

  for (const [label, before, after] of [
    ['fill', 'style="width:100pt;height:50pt" fillcolor="red"', 'style="width:100pt;height:50pt" fillcolor="blue"'],
    ['height', 'style="width:100pt;height:50pt" fillcolor="red"', 'style="width:100pt;height:200pt" fillcolor="red"'],
  ] as const) {
    test(`an empty header text box whose ${label} changes stays listed`, async () => {
      // The box shows no text, but its carrier still draws a shape the
      // redline does not track; it must not read as a blank story.
      const header = (shape: string): Part => ({
        id: 'rIdH',
        kind: 'header',
        target: 'header1.xml',
        contentXml: `<w:p><w:r><w:pict><v:rect id="tb" ${shape}><v:textbox><w:txbxContent><w:p/></w:txbxContent></v:textbox></v:rect></w:pict></w:r></w:p>`,
      });
      const original = await packageWith(paragraph('Stable body.'), ref('header', 'rIdH') + LAYOUT, [header(before)]);
      const revised = await packageWith(paragraph('Stable body.'), ref('header', 'rIdH') + LAYOUT, [header(after)]);

      const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
      const headerXml = (await (await DocxArchive.load(result.document)).getFile('word/header1.xml'))!;

      expect(rejectAllChanges(headerXml)).toContain(after);
      expect(result.unrepresentedChanges).toEqual([
        { scope: 'header', kind: 'changed', sectionIndex: 0, role: 'default' },
      ]);
    });
  }

  test('a w:titlePg the snapshot cannot undo in Word stays listed', async () => {
    // w:sectPrChange snapshots are applied property by property by Word: a
    // snapshot without w:titlePg leaves the revised title page in place on
    // Reject All, though the appliers restore the original (#1412).
    const original = await packageWith(sectionEnd('First part.', LAYOUT) + paragraph('Second part.'), LAYOUT, []);
    const revised = await packageWith(
      sectionEnd('First part.', LAYOUT + '<w:titlePg/>') + paragraph('Second part.'),
      LAYOUT,
      [],
    );

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
    const documentXml = await (await DocxArchive.load(result.document)).getDocumentXml();

    expect(documentXml).toContain('w:sectPrChange');
    expect(await sectionLayouts(result.document, rejectAllChanges)).toEqual(await sectionLayouts(original));
    expect(result.unrepresentedChanges).toEqual([{ scope: 'section', kind: 'changed', sectionIndex: 0 }]);
  });

  test('an orientation change whose snapshot omits w:orient stays listed', async () => {
    const original = await packageWith(sectionEnd('First part.', LAYOUT) + paragraph('Second part.'), LAYOUT, []);
    const revised = await packageWith(sectionEnd('First part.', LANDSCAPE + MARGINS) + paragraph('Second part.'), LAYOUT, []);

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges).toEqual([{ scope: 'section', kind: 'changed', sectionIndex: 0 }]);
  });

  test('the publication gate refuses a section divergence once the index-shifted entries are gone', async () => {
    // A represented break deletion used to leave index-shifted section
    // entries, and any one of them admitted every section-scope divergence.
    // With those entries dropped, a divergence nothing reports is refused.
    const original = await packageWith(
      sectionEnd('First part.', LAYOUT) + paragraph('Second part.'),
      LAYOUT,
      [],
    );
    const revised = await packageWith(paragraph('First part.') + paragraph('Second part.'), LAYOUT, []);

    await expect(compareDocumentsAtomizer(original, revised, {
      ...COMPARE_OPTIONS,
      taggedTreeFormattingFidelityEvaluator: (originalXml, revisedXml, candidateXml) => {
        const actual = compareSourceProjectedFormattingFidelity(originalXml, revisedXml, candidateXml);
        const divergence = {
          scope: 'section' as const,
          property: 'w:pgSz',
          kind: 'changed' as const,
          expectedValue: '<w:pgSz/>',
          actualValue: '<w:pgSz w:orient="landscape"/>',
          paragraphIndex: -1,
          textSample: '',
          sectionIndex: 0,
        };
        return {
          ...actual,
          score: 0.5,
          reject: { ...actual.reject, score: 0.5, divergences: [divergence] },
        };
      },
    })).rejects.toMatchObject({
      name: 'TaggedPublicationSafetyError',
      failedChecks: ['formattingFidelity'],
    });
  });
});
