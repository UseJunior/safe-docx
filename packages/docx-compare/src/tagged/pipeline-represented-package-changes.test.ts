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
import { subtractRepresentedPackageChanges } from './unrepresentedChanges.js';
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

  test('a deleted last section break whose footers show a PAGE field, plus a body edit, reports nothing', async () => {
    // A page-number field reads no other story, so its footers are still
    // compared slot by slot.
    const pageFooter = (id: string, target: string, label: string): Part => ({
      id, kind: 'footer', target,
      contentXml: `<w:p><w:r><w:t xml:space="preserve">${label} page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        '<w:r><w:instrText xml:space="preserve"> PAGE \\* MERGEFORMAT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    });
    const parts = THREE_SECTION_PARTS.map((part) => (part.kind === 'footer' ? pageFooter(part.id, part.target, part.id) : part));
    const body = (firstLine: string, keepBreak: boolean): string =>
      sectionEnd(firstLine, sectionRefs('A') + LAYOUT) +
      (keepBreak ? sectionEnd('Second section.', sectionRefs('B') + LAYOUT) : paragraph('Second section.')) +
      paragraph('Third section.');
    const original = await packageWith(body('First section.', true), sectionRefs('C') + LAYOUT, parts);
    const revised = await packageWith(body('First section, amended.', false), sectionRefs('C') + LAYOUT, parts);

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

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

  const TALL_EMPTY_HEADERS = [
    ['an exact-height empty line', '<w:p><w:pPr><w:spacing w:line="6000" w:lineRule="exact"/></w:pPr></w:p>'],
    ['paragraph spacing', '<w:p><w:pPr><w:spacing w:before="2000" w:after="2000"/></w:pPr></w:p>'],
    ['many empty paragraphs', '<w:p/>'.repeat(25)],
  ] as const;
  for (const [label, contentXml] of TALL_EMPTY_HEADERS) {
    for (const kind of ['added', 'removed'] as const) {
      test(`a header with no text but ${label} stays listed when ${kind}`, async () => {
        // The header shows no text, but its empty paragraphs take up room and
        // push the body down; a part that shows nothing never stands in for
        // no part (Codex round 2).
        const header: Part = { id: 'rIdH', kind: 'header', target: 'header1.xml', contentXml };
        const withHeader = await packageWith(paragraph('Stable body.'), ref('header', 'rIdH') + LAYOUT, [header]);
        const withoutHeader = await packageWith(paragraph('Stable body.'), LAYOUT, []);
        const [original, revised] = kind === 'added' ? [withoutHeader, withHeader] : [withHeader, withoutHeader];

        const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

        expect(result.unrepresentedChanges).toEqual([
          { scope: 'header', kind, sectionIndex: 0, role: 'default' },
        ]);
      });
    }
  }

  for (const [label, contentXml] of TALL_EMPTY_HEADERS) {
    for (const kind of ['removed', 'added'] as const) {
      test(`a first-page header with no text but ${label} stays listed when ${kind} with a section break and a default header edit`, async () => {
        // The section-aligned story pairing reads a part with no text as no
        // part; its index-based drop used to hide this entry before the
        // package check ran (Codex round 3). On the side without the extra
        // section, the merged section must match in full.
        const withFirst = await packageWith(
          sectionEnd('Section one.', LAYOUT) + paragraph('Body.'),
          ref('header', 'rIdD') + ref('header', 'rIdFirst', 'first') + LAYOUT + '<w:titlePg/>',
          [story('rIdD', 'header', 'header1.xml', 'Old default'),
            { id: 'rIdFirst', kind: 'header', target: 'header2.xml', contentXml }],
        );
        const withoutFirst = await packageWith(
          paragraph('Section one.') + paragraph('Body.'),
          ref('header', 'rIdD') + LAYOUT + '<w:titlePg/>',
          [story('rIdD', 'header', 'header1.xml', 'New default')],
        );
        const [original, revised] = kind === 'removed' ? [withFirst, withoutFirst] : [withoutFirst, withFirst];

        const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

        expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
          { scope: 'header', kind, sectionIndex: 1, role: 'first' },
        ]));
      });
    }
  }

  for (const [label, space] of [['no-break space', '\u00a0'], ['em space', '\u2003']] as const) {
    test(`a header ${label} the compared package does not track stays listed`, async () => {
      // Word drops only XML white space from an unpreserved w:t, so a leading
      // ${label} is shown text; an untracked compared package (the revised
      // document itself) must not read as reproducing the original.
      const header = (text: string): Part =>
        ({ id: 'rIdH', kind: 'header', target: 'header1.xml', contentXml: `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` });
      const original = await DocxArchive.load(
        await packageWith(paragraph('Stable body.'), ref('header', 'rIdH') + LAYOUT, [header(`${space}Draft`)]));
      const revised = await DocxArchive.load(
        await packageWith(paragraph('Stable body.'), ref('header', 'rIdH') + LAYOUT, [header('Draft')]));
      const entry = { scope: 'header', kind: 'changed', sectionIndex: 0, role: 'default' } as const;

      const reported = await subtractRepresentedPackageChanges({
        original: { archive: original },
        revised: { archive: revised },
        compared: { archive: revised },
        changes: [entry],
        scopes: new Set(['header']),
      });

      expect(reported).toEqual([entry]);
    });
  }

  test('the package check keeps preserved spaces removed from an Office Math run in a header', async () => {
    // Only indentation between WordprocessingML elements is dropped from the
    // story identity; preserved white space in m:t is shown text (Codex round 4).
    const mathRun = (text: string): string =>
      `<m:r><m:rPr><m:nor/></m:rPr><m:t xml:space="preserve">${text}</m:t></m:r>`;
    const header = (runs: string): Part => ({
      id: 'rIdH',
      kind: 'header',
      target: 'header1.xml',
      contentXml: `<w:p><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${runs}</m:oMath></w:p>`,
    });
    const originalBuffer = await packageWith(
      paragraph('Stable body.'), ref('header', 'rIdH') + LAYOUT, [header(mathRun('A') + mathRun('          ') + mathRun('B'))]);
    const revisedBuffer = await packageWith(
      paragraph('Stable body.'), ref('header', 'rIdH') + LAYOUT, [header(mathRun('A') + mathRun('') + mathRun('B'))]);
    const entry = { scope: 'header', kind: 'changed', sectionIndex: 0, role: 'default' } as const;

    const reported = await subtractRepresentedPackageChanges({
      original: { archive: await DocxArchive.load(originalBuffer) },
      revised: { archive: await DocxArchive.load(revisedBuffer) },
      compared: { archive: await DocxArchive.load(revisedBuffer) },
      changes: [entry],
      scopes: new Set(['header']),
    });
    expect(reported).toEqual([entry]);
  });

  const FORMATTING_PARTS = [
    {
      label: 'character style definition',
      path: 'word/styles.xml', target: 'styles.xml', relationship: 'styles', contentType: 'styles+xml',
      runProperties: '<w:rStyle w:val="Logo"/>',
      part: (color: string) => `<w:styles xmlns:w="${W_NS}"><w:style w:type="character" w:styleId="Logo">` +
        `<w:name w:val="Logo"/><w:rPr><w:color w:val="${color}"/></w:rPr></w:style></w:styles>`,
    },
    {
      label: 'theme colour',
      path: 'word/theme/theme1.xml', target: 'theme/theme1.xml', relationship: 'theme', contentType: 'theme+xml',
      contentTypePrefix: 'application/vnd.openxmlformats-officedocument.',
      runProperties: '<w:color w:val="000000" w:themeColor="accent1"/>',
      part: (color: string) => '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T">' +
        `<a:themeElements><a:clrScheme name="C"><a:accent1><a:srgbClr val="${color}"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`,
    },
    {
      label: 'theme colour, with the theme reached through a dot-relative target',
      path: 'word/theme/brand.xml', target: './theme/brand.xml', relationship: 'theme', contentType: 'theme+xml',
      contentTypePrefix: 'application/vnd.openxmlformats-officedocument.',
      runProperties: '<w:color w:val="000000" w:themeColor="accent1"/>',
      part: (color: string) => '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T">' +
        `<a:themeElements><a:clrScheme name="C"><a:accent1><a:srgbClr val="${color}"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`,
    },
    {
      label: 'font table entry',
      path: 'word/fontTable.xml', target: 'fontTable.xml', relationship: 'fontTable', contentType: 'fontTable+xml',
      runProperties: '<w:rFonts w:ascii="Brand" w:hAnsi="Brand"/>',
      part: (color: string) => `<w:fonts xmlns:w="${W_NS}"><w:font w:name="Brand">` +
        `<w:altName w:val="${color === '000000' ? 'Arial' : 'Courier New'}"/></w:font></w:fonts>`,
    },
  ] as const;
  for (const formatting of FORMATTING_PARTS) {
    test(`a header whose ${formatting.label} changes stays listed when only its reference allocation differs`, async () => {
      // The header part is the same on both sides, but a definition it
      // depends on changes in a part the redline does not track. Story
      // identity includes those parts (Codex rounds 5 and 6).
      const withPart = async (buffer: Buffer, color: string): Promise<Buffer> => {
        const archive = await DocxArchive.load(buffer);
        archive.setFile(formatting.path,
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${formatting.part(color)}`);
        const rels = (await archive.getFile('word/_rels/document.xml.rels'))!;
        archive.setFile('word/_rels/document.xml.rels', rels.replace('</Relationships>',
          `<Relationship Id="rIdFormatting" Type="${R_NS}/${formatting.relationship}" Target="${formatting.target}"/></Relationships>`));
        const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
        if (!contentTypes.includes(`/${formatting.path}`)) {
          const prefix = 'contentTypePrefix' in formatting
            ? formatting.contentTypePrefix
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
          archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>',
            `<Override PartName="/${formatting.path}" ContentType="${prefix}${formatting.contentType}"/></Types>`));
        }
        return archive.save();
      };
      const header: Part = {
        id: 'rIdH', kind: 'header', target: 'header1.xml',
        contentXml: `<w:p><w:r><w:rPr>${formatting.runProperties}</w:rPr><w:t>Logo</w:t></w:r></w:p>`,
      };
      const body = sectionEnd('Section one.', ref('header', 'rIdH') + LAYOUT) + paragraph('Section two.');
      const original = await withPart(await packageWith(body, LAYOUT, [header]), '000000');
      const revised = await withPart(await packageWith(body, ref('header', 'rIdH') + LAYOUT, [header]), 'FF0000');

      const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

      expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
        { scope: 'header', kind: 'added', sectionIndex: 1, role: 'default' },
      ]));
    });
  }

  test('a header whose default tab stop changes in settings stays listed when only its reference allocation differs', async () => {
    // w:defaultTabStop sets where an automatic tab lands; settings.xml has no
    // revision markup, so the compared package keeps the revised value
    // (Codex round 7).
    const header: Part = {
      id: 'rIdH', kind: 'header', target: 'header1.xml',
      contentXml: '<w:p><w:r><w:t>A</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>B</w:t></w:r></w:p>',
    };
    const body = sectionEnd('Section one.', ref('header', 'rIdH') + LAYOUT) + paragraph('Section two.');
    const original = await packageWith(body, LAYOUT, [header], '<w:defaultTabStop w:val="720"/>');
    const revised = await packageWith(body, ref('header', 'rIdH') + LAYOUT, [header], '<w:defaultTabStop w:val="2880"/>');

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
      { scope: 'header', kind: 'added', sectionIndex: 1, role: 'default' },
    ]));
  });

  test('a header whose theme changes only by which theme part the document relationship names stays listed', async () => {
    // Both packages hold the same two theme parts; only the relationship
    // target moves from black to red (Codex round 8).
    const theme = (color: string): string =>
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T">' +
      `<a:themeElements><a:clrScheme name="C"><a:accent1><a:srgbClr val="${color}"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`;
    const withThemes = async (buffer: Buffer, selected: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(buffer);
      archive.setFile('word/theme/black.xml', theme('000000'));
      archive.setFile('word/theme/red.xml', theme('FF0000'));
      const rels = (await archive.getFile('word/_rels/document.xml.rels'))!;
      archive.setFile('word/_rels/document.xml.rels', rels.replace('</Relationships>',
        `<Relationship Id="rIdTheme" Type="${R_NS}/theme" Target="theme/${selected}.xml"/></Relationships>`));
      const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
      archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>',
        ['black', 'red'].map((name) =>
          `<Override PartName="/word/theme/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`).join('') +
        '</Types>'));
      return archive.save();
    };
    const header: Part = {
      id: 'rIdH', kind: 'header', target: 'header1.xml',
      contentXml: '<w:p><w:r><w:rPr><w:color w:val="000000" w:themeColor="accent1"/></w:rPr><w:t>Logo</w:t></w:r></w:p>',
    };
    const body = sectionEnd('Section one.', ref('header', 'rIdH') + LAYOUT) + paragraph('Section two.');
    const original = await withThemes(await packageWith(body, LAYOUT, [header]), 'black');
    const revised = await withThemes(await packageWith(body, ref('header', 'rIdH') + LAYOUT, [header]), 'red');

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
      { scope: 'header', kind: 'added', sectionIndex: 1, role: 'default' },
    ]));
  });

  test('w:evenAndOddHeaders turned on in a settings part with a non-default name stays listed', async () => {
    // The page check reads the settings part the document relationship
    // names, not a fixed word/settings.xml (Codex round 8).
    const moveSettings = async (buffer: Buffer): Promise<Buffer> => {
      const archive = await DocxArchive.load(buffer);
      archive.setFile('word/brand-settings.xml', (await archive.getFile('word/settings.xml'))!);
      // A stale word/settings.xml stays behind, the same on both sides.
      archive.setFile('word/settings.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${W_NS}"/>`);
      const rels = (await archive.getFile('word/_rels/document.xml.rels'))!;
      archive.setFile('word/_rels/document.xml.rels', rels.replace('Target="settings.xml"', 'Target="brand-settings.xml"'));
      const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
      archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>',
        '<Override PartName="/word/brand-settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'));
      return archive.save();
    };
    const parts = [
      story('rIdH', 'header', 'header1.xml', 'Header'),
      story('rIdE', 'header', 'header2.xml', 'Even header'),
    ];
    const body = sectionEnd('Section one.', ref('header', 'rIdH') + ref('header', 'rIdE', 'even') + LAYOUT) + paragraph('Section two.');
    const original = await moveSettings(await packageWith(body, LAYOUT, parts));
    const revised = await moveSettings(await packageWith(body, ref('header', 'rIdH') + LAYOUT, parts, '<w:evenAndOddHeaders/>'));

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges ?? []).not.toEqual([]);
    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'header', sectionIndex: 1 }),
    ]));
  });

  test('a header DOCPROPERTY field whose custom property changes stays listed when only its reference allocation differs', async () => {
    // docProps/custom.xml has no revision markup; the compared package keeps
    // the revised property value the field shows once updated (Codex round 9).
    const withProperty = async (buffer: Buffer, value: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(buffer);
      archive.setFile('docProps/custom.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ' +
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
        `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Brand"><vt:lpwstr>${value}</vt:lpwstr></property></Properties>`);
      const rootRels = await archive.getFile('_rels/.rels');
      if (rootRels && !rootRels.includes('custom-properties')) {
        archive.setFile('_rels/.rels', rootRels.replace('</Relationships>',
          `<Relationship Id="rIdCustom" Type="${R_NS}/custom-properties" Target="docProps/custom.xml"/></Relationships>`));
      }
      const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
      if (!contentTypes.includes('/docProps/custom.xml')) {
        archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>',
          '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>'));
      }
      return archive.save();
    };
    const header: Part = {
      id: 'rIdH', kind: 'header', target: 'header1.xml',
      contentXml: '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> DOCPROPERTY Brand </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Original brand</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    };
    const body = sectionEnd('Section one.', ref('header', 'rIdH') + LAYOUT) + paragraph('Section two.');
    const original = await withProperty(await packageWith(body, LAYOUT, [header]), 'Original brand');
    const revised = await withProperty(await packageWith(body, ref('header', 'rIdH') + LAYOUT, [header]), 'Revised brand');

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
      { scope: 'header', kind: 'added', sectionIndex: 1, role: 'default' },
    ]));
  });

  for (const [label, instruction] of [
    ['', '<w:r><w:instrText xml:space="preserve"> LASTSAVEDBY </w:instrText></w:r>'],
    [' split over two runs', '<w:r><w:instrText xml:space="preserve"> LAST</w:instrText></w:r><w:r><w:instrText xml:space="preserve">SAVEDBY </w:instrText></w:r>'],
  ] as const) {
  test(`a header LASTSAVEDBY field${label} whose last-saved-by property changes stays listed when only its reference allocation differs`, async () => {
    // cp:lastModifiedBy is rewritten on every save and left out of the
    // environment digest, but not while a header field can show it
    // (Codex round 10).
    const withLastSavedBy = async (buffer: Buffer, name: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(buffer);
      archive.setFile('docProps/core.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        `xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Agreement</dc:title><cp:lastModifiedBy>${name}</cp:lastModifiedBy></cp:coreProperties>`);
      return archive.save();
    };
    const header: Part = {
      id: 'rIdH', kind: 'header', target: 'header1.xml',
      contentXml: `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>${instruction}` +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Alice</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    };
    const body = sectionEnd('Section one.', ref('header', 'rIdH') + LAYOUT) + paragraph('Section two.');
    const original = await withLastSavedBy(await packageWith(body, LAYOUT, [header]), 'Alice');
    const revised = await withLastSavedBy(await packageWith(body, ref('header', 'rIdH') + LAYOUT, [header]), 'Bob');

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
      { scope: 'header', kind: 'added', sectionIndex: 1, role: 'default' },
    ]));
  });
  }

  const boundHeader = (xpath: string, prefixMappings: string, shown: string): Part => ({
    id: 'rIdH', kind: 'header', target: 'header1.xml',
    contentXml: `<w:sdt><w:sdtPr><w:dataBinding w:prefixMappings="${prefixMappings}" w:xpath="${xpath}"/><w:text/></w:sdtPr>` +
      `<w:sdtContent><w:p><w:r><w:t>${shown}</w:t></w:r></w:p></w:sdtContent></w:sdt>`,
  });

  test('a header content control bound to the last-saved-by property stays listed when that property changes and only its reference allocation differs', async () => {
    // A data-bound control shows a document property without any field, so
    // cp:lastModifiedBy stays in the environment digest (Codex round 12).
    const withLastSavedBy = async (buffer: Buffer, name: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(buffer);
      archive.setFile('docProps/core.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties">' +
        `<cp:lastModifiedBy>${name}</cp:lastModifiedBy></cp:coreProperties>`);
      return archive.save();
    };
    const header = boundHeader('/cp:coreProperties[1]/cp:lastModifiedBy[1]',
      "xmlns:cp='http://schemas.openxmlformats.org/package/2006/metadata/core-properties'", 'Alice');
    const body = sectionEnd('Section one.', ref('header', 'rIdH') + LAYOUT) + paragraph('Section two.');
    const original = await withLastSavedBy(await packageWith(body, LAYOUT, [header]), 'Alice');
    const revised = await withLastSavedBy(await packageWith(body, ref('header', 'rIdH') + LAYOUT, [header]), 'Bob');

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
      { scope: 'header', kind: 'added', sectionIndex: 1, role: 'default' },
    ]));
  });

  test('a header content control bound to a custom XML attribute named rsid stays listed when that attribute changes and only its reference allocation differs', async () => {
    // Only WordprocessingML editing-session ids are left out of the
    // environment; a custom XML attribute that happens to be named rsid is
    // data a bound control shows (Codex round 12).
    const withBrand = async (buffer: Buffer, value: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(buffer);
      archive.setFile('customXml/item1.xml', `<b:brand xmlns:b="urn:review:brand" rsid="${value}"/>`);
      return archive.save();
    };
    const header = boundHeader('/b:brand[1]/@rsid', "xmlns:b='urn:review:brand'", 'Alice');
    const body = sectionEnd('Section one.', ref('header', 'rIdH') + LAYOUT) + paragraph('Section two.');
    const original = await withBrand(await packageWith(body, LAYOUT, [header]), 'Alice');
    const revised = await withBrand(await packageWith(body, ref('header', 'rIdH') + LAYOUT, [header]), 'Bob');

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
      { scope: 'header', kind: 'added', sectionIndex: 1, role: 'default' },
    ]));
  });

  test('a header content control bound to a w:zoom element inside custom XML stays listed when its value changes and only its reference allocation differs', async () => {
    // View state is left out only of the settings part; the same element
    // inside a custom XML store is data a bound control shows (Codex round 13).
    const withZoom = async (buffer: Buffer, percent: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(buffer);
      archive.setFile('customXml/item1.xml', `<b:brand xmlns:b="urn:review:brand" xmlns:w="${W_NS}"><w:zoom w:percent="${percent}"/></b:brand>`);
      return archive.save();
    };
    const header = boundHeader('/b:brand[1]/w:zoom[1]/@w:percent', `xmlns:b='urn:review:brand' xmlns:w='${W_NS}'`, '100');
    const body = sectionEnd('Section one.', ref('header', 'rIdH') + LAYOUT) + paragraph('Section two.');
    const original = await withZoom(await packageWith(body, LAYOUT, [header]), '100');
    const revised = await withZoom(await packageWith(body, ref('header', 'rIdH') + LAYOUT, [header]), '200');

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
      { scope: 'header', kind: 'added', sectionIndex: 1, role: 'default' },
    ]));
  });

  test('a custom XML store at word/comments.xml bound to a header control stays listed when it changes and only its reference allocation differs', async () => {
    // A part is left out as comments only when a comments relationship names
    // it; here a customXml relationship does (Codex round 13).
    const withStore = async (buffer: Buffer, value: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(buffer);
      archive.setFile('word/comments.xml', `<b:brand xmlns:b="urn:review:brand" brand="${value}"/>`);
      const rels = (await archive.getFile('word/_rels/document.xml.rels'))!;
      archive.setFile('word/_rels/document.xml.rels', rels.replace('</Relationships>',
        `<Relationship Id="rIdData" Type="${R_NS}/customXml" Target="comments.xml"/></Relationships>`));
      return archive.save();
    };
    const header = boundHeader('/b:brand[1]/@brand', "xmlns:b='urn:review:brand'", 'Alice');
    const body = sectionEnd('Section one.', ref('header', 'rIdH') + LAYOUT) + paragraph('Section two.');
    const original = await withStore(await packageWith(body, LAYOUT, [header]), 'Alice');
    const revised = await withStore(await packageWith(body, ref('header', 'rIdH') + LAYOUT, [header]), 'Bob');

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
      { scope: 'header', kind: 'added', sectionIndex: 1, role: 'default' },
    ]));
  });

  for (const [label, instruction] of [
    ['REF', ' REF Brand '],
    ['bare bookmark', ' Brand '],
  ] as const) {
    test(`a header ${label} field whose bookmark moves without a tracked change stays listed when only its reference allocation differs`, async () => {
      // The field shows text from the body, where a bookmark move is not a
      // revision; a header field that reads another story keeps every
      // header/footer entry listed (Codex round 14).
      const brandBody = (bookmarked: 'Alice' | 'Bob'): string => {
        const mark = (text: string): string => (text === bookmarked
          ? `<w:bookmarkStart w:id="7" w:name="Brand"/><w:r><w:t>${text}</w:t></w:r><w:bookmarkEnd w:id="7"/>`
          : `<w:r><w:t>${text}</w:t></w:r>`);
        return `<w:p>${mark('Alice')}<w:r><w:t xml:space="preserve"> </w:t></w:r>${mark('Bob')}</w:p>`;
      };
      const header: Part = {
        id: 'rIdH', kind: 'header', target: 'header1.xml',
        contentXml: `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>` +
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Alice</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
      };
      const body = (bookmarked: 'Alice' | 'Bob'): string =>
        brandBody(bookmarked) + sectionEnd('Section one.', ref('header', 'rIdH') + LAYOUT) + paragraph('Section two.');
      const original = await packageWith(body('Alice'), LAYOUT, [header]);
      const revised = await packageWith(body('Bob'), ref('header', 'rIdH') + LAYOUT, [header]);

      const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

      expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
        { scope: 'header', kind: 'added', sectionIndex: 1, role: 'default' },
      ]));
    });
  }

  const withRootRelationship = async (archive: DocxArchive, id: string, type: string, target: string, contentType: string): Promise<void> => {
    const rootRels = (await archive.getFile('_rels/.rels'))!;
    if (!rootRels.includes(`Target="${target}"`)) {
      archive.setFile('_rels/.rels', rootRels.replace('</Relationships>', `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`));
    }
    const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
    if (!contentTypes.includes(`PartName="/${target}"`)) {
      archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>', `<Override PartName="/${target}" ContentType="${contentType}"/></Types>`));
    }
  };

  test('a last-saved-by property no header/footer shows does not keep an allocation-only header entry listed', async () => {
    // cp:lastModifiedBy is rewritten on every save; with no field or binding
    // that shows it, the core properties part the package root names is
    // compared without it.
    const withLastSavedBy = async (buffer: Buffer, name: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(buffer);
      archive.setFile('docProps/core.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties">' +
        `<cp:lastModifiedBy>${name}</cp:lastModifiedBy></cp:coreProperties>`);
      await withRootRelationship(archive, 'rIdCore', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
        'docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml');
      return archive.save();
    };
    const header = story('rIdH', 'header', 'header1.xml', 'Plain header');
    const body = sectionEnd('Section one.', ref('header', 'rIdH') + LAYOUT) + paragraph('Section two.');
    const original = await withLastSavedBy(await packageWith(body, LAYOUT, [header]), 'Alice');
    const revised = await withLastSavedBy(await packageWith(body, ref('header', 'rIdH') + LAYOUT, [header]), 'Bob');

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect((result.unrepresentedChanges ?? []).filter((change) => change.scope === 'header')).toEqual([]);
  });

  test('a header DOCPROPERTY field whose custom property is linked to a moved bookmark stays listed when only its reference allocation differs', async () => {
    // A linked custom property (linkTarget) shows the bookmarked text of
    // another story (Codex round 15).
    const withLinkedProperty = async (buffer: Buffer): Promise<Buffer> => {
      const archive = await DocxArchive.load(buffer);
      archive.setFile('docProps/custom.xml',
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
        '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Brand" linkTarget="Brand"><vt:lpwstr>Alice</vt:lpwstr></property></Properties>');
      await withRootRelationship(archive, 'rIdCustom', `${R_NS}/custom-properties`,
        'docProps/custom.xml', 'application/vnd.openxmlformats-officedocument.custom-properties+xml');
      return archive.save();
    };
    const mark = (bookmarked: 'Alice' | 'Bob', text: 'Alice' | 'Bob'): string => (text === bookmarked
      ? `<w:bookmarkStart w:id="7" w:name="Brand"/><w:r><w:t>${text}</w:t></w:r><w:bookmarkEnd w:id="7"/>`
      : `<w:r><w:t>${text}</w:t></w:r>`);
    const header: Part = {
      id: 'rIdH', kind: 'header', target: 'header1.xml',
      contentXml: '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> DOCPROPERTY Brand </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Alice</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    };
    const body = (bookmarked: 'Alice' | 'Bob'): string =>
      `<w:p>${mark(bookmarked, 'Alice')}<w:r><w:t xml:space="preserve"> </w:t></w:r>${mark(bookmarked, 'Bob')}</w:p>` +
      sectionEnd('Section one.', ref('header', 'rIdH') + LAYOUT) + paragraph('Section two.');
    const original = await withLinkedProperty(await packageWith(body('Alice'), LAYOUT, [header]));
    const revised = await withLinkedProperty(await packageWith(body('Bob'), ref('header', 'rIdH') + LAYOUT, [header]));

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
      { scope: 'header', kind: 'added', sectionIndex: 1, role: 'default' },
    ]));
  });

  test('a header mc:Choice whose required prefix is rebound stays listed when only its reference allocation differs', async () => {
    // Requires names a namespace by prefix; rebinding the prefix changes
    // which branch Word shows without changing any other character (Codex
    // round 15).
    const withRequiredNamespace = async (buffer: Buffer, uri: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(buffer);
      const xml = (await archive.getFile('word/header1.xml'))!;
      archive.setFile('word/header1.xml', xml.replace('<w:hdr ', `<w:hdr xmlns:req="${uri}" `));
      return archive.save();
    };
    const header: Part = {
      id: 'rIdH', kind: 'header', target: 'header1.xml',
      contentXml: '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">' +
        '<mc:Choice Requires="req"><w:p><w:r><w:t>Alice</w:t></w:r></w:p></mc:Choice>' +
        '<mc:Fallback><w:p><w:r><w:t>Bob</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>',
    };
    const body = sectionEnd('Section one.', ref('header', 'rIdH') + LAYOUT) + paragraph('Section two.');
    const original = await withRequiredNamespace(await packageWith(body, LAYOUT, [header]), 'http://schemas.microsoft.com/office/word/2010/wordml');
    const revised = await withRequiredNamespace(await packageWith(body, ref('header', 'rIdH') + LAYOUT, [header]), 'urn:review:unsupported');

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
      { scope: 'header', kind: 'added', sectionIndex: 1, role: 'default' },
    ]));
  });

  test('a section whose mc:Choice required prefix is rebound on the document element stays listed beside a tracked page-size change', async () => {
    // The w:sectPrChange snapshot restores the page size, but the prefix the
    // section's mc:Choice requires is declared on w:document, outside the
    // snapshot: Reject All keeps the revised binding and the revised margin
    // (Codex round 16).
    const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
    const margin = (top: number): string =>
      `<w:pgMar w:top="${top}" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>`;
    const build = async (width: number, uri: string): Promise<Buffer> => {
      const choice = `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice Requires="req">${margin(1440)}</mc:Choice>` +
        `<mc:Fallback>${margin(5000)}</mc:Fallback></mc:AlternateContent>`;
      const archive = await DocxArchive.load(await packageWith(
        sectionEnd('One', `<w:pgSz w:w="${width}" w:h="15840"/>${choice}`) + paragraph('Two'), LAYOUT, []));
      archive.setDocumentXml((await archive.getDocumentXml()).replace('<w:document ', `<w:document xmlns:req="${uri}" `));
      return archive.save();
    };
    const original = await build(12240, 'http://schemas.microsoft.com/office/word/2010/wordml');
    const revised = await build(11906, 'urn:review:unsupported');

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([{ scope: 'section', kind: 'changed', sectionIndex: 0 }]));
  });

  test('a numbering picture bullet whose relationship target swaps stays listed when only its reference allocation differs', async () => {
    // numbering.xml names its picture by relationship id; swapping the two
    // targets in numbering.xml.rels changes the bullet without changing any
    // part's bytes (Codex round 11).
    const VML = 'urn:schemas-microsoft-com:vml';
    const withBullets = async (buffer: Buffer, first: string, second: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(buffer);
      archive.setFile('word/media/red.png', Buffer.from('red'));
      archive.setFile('word/media/blue.png', Buffer.from('blue'));
      archive.setFile('word/numbering.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:v="${VML}">` +
        '<w:numPicBullet w:numPicBulletId="0"><w:pict><v:shape style="width:9pt;height:9pt"><v:imagedata r:id="rIdA"/></v:shape></w:pict></w:numPicBullet>' +
        '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlPicBulletId w:val="0"/></w:lvl></w:abstractNum>' +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>');
      archive.setFile('word/_rels/numbering.xml.rels',
        `<Relationships xmlns="${PKG_NS}"><Relationship Id="rIdA" Type="${R_NS}/image" Target="media/${first}.png"/>` +
        `<Relationship Id="rIdB" Type="${R_NS}/image" Target="media/${second}.png"/></Relationships>`);
      const rels = (await archive.getFile('word/_rels/document.xml.rels'))!;
      archive.setFile('word/_rels/document.xml.rels', rels.replace('</Relationships>',
        `<Relationship Id="rIdNumbering" Type="${R_NS}/numbering" Target="numbering.xml"/></Relationships>`));
      const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
      archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>',
        (contentTypes.includes('Extension="png"') ? '' : '<Default Extension="png" ContentType="image/png"/>') +
        (contentTypes.includes('/word/numbering.xml') ? '' : '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>') +
        '</Types>'));
      return archive.save();
    };
    const header: Part = {
      id: 'rIdH', kind: 'header', target: 'header1.xml',
      contentXml: '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Logo</w:t></w:r></w:p>',
    };
    const body = sectionEnd('Section one.', ref('header', 'rIdH') + LAYOUT) + paragraph('Section two.');
    const original = await withBullets(await packageWith(body, LAYOUT, [header]), 'red', 'blue');
    const revised = await withBullets(await packageWith(body, ref('header', 'rIdH') + LAYOUT, [header]), 'blue', 'red');

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

    expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
      { scope: 'header', kind: 'added', sectionIndex: 1, role: 'default' },
    ]));
  });

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
