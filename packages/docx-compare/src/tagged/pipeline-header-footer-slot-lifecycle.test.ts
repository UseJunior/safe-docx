/**
 * A header or footer attached to, dropped from, or newly owned by a section
 * that both documents keep is tracked as the slot's content, not left in
 * `unrepresentedChanges`.
 *
 * A section with no reference of a type shows the previous section's story,
 * or a blank one in the first section (§17.10.5, §17.10.2), and
 * `w:sectPrChange` cannot hold references (§17.13.5.32, #944). Each case
 * checks what every first, odd and even page of every section shows after
 * Accept All and Reject All, with docx-compare's appliers and with docx-core's
 * `acceptChanges`/`rejectChanges`, against the revised and the original
 * document, plus body text and the emitted-document schema gate.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @see https://github.com/UseJunior/safe-docx/issues/1394
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
import { compareDocumentsAtomizer, type TaggedCompareResult } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import {
  isBlankStoryPart,
  pageStorySlots,
  resolveEffectiveStoryBindings,
} from './effectiveStoryBindings.js';
import { reportSlotChangesAgainstInputs, type NormalizedStorySlot } from './storySlotNormalization.js';

const TEST_FEATURE = 'track-header-footer-slot-lifecycle';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' },
  );

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-13T00:00:00.000Z') };
const PAGE_SETUP =
  '<w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

type Kind = 'header' | 'footer';
type Role = 'default' | 'first' | 'even';
interface Part { id: string; kind: Kind; target: string; xml: string }

const paragraph = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const ref = (kind: Kind, id: string, role: Role = 'default'): string =>
  `<w:${kind}Reference w:type="${role}" r:id="${id}"/>`;
const sectionEnd = (text: string, references: string): string =>
  `<w:p><w:pPr><w:sectPr>${references}${PAGE_SETUP}</w:sectPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const vmlBox = (text: string): string =>
  '<w:p><w:r><w:pict><v:shape id="box1" style="width:200pt;height:40pt"><v:textbox><w:txbxContent>' +
  `${paragraph(text)}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
const story = (id: string, kind: Kind, target: string, contentXml: string): Part => {
  const root = kind === 'header' ? 'w:hdr' : 'w:ftr';
  return {
    id,
    kind,
    target,
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${root} xmlns:w="${W_NS}" ` +
      `xmlns:v="urn:schemas-microsoft-com:vml">${contentXml}</${root}>`,
  };
};

async function packageWith(body: string, finalSectPr: string, parts: Part[]): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(body, [], { namespaces: { r: R_NS } }));
  archive.setDocumentXml((await archive.getDocumentXml())
    .replace('<w:sectPr/>', `<w:sectPr>${finalSectPr.replace('<w:titlePg/>', '')}${PAGE_SETUP}` +
      `${finalSectPr.includes('<w:titlePg/>') ? '<w:titlePg/>' : ''}</w:sectPr>`));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      parts.map((entry) => `<Relationship Id="${entry.id}" Type="${R_NS}/${entry.kind}" Target="${entry.target}"/>`).join('') +
      `</Relationships>`,
  );
  for (const entry of parts) archive.setFile(`word/${entry.target}`, entry.xml);
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>', parts.map((entry) =>
    `<Override PartName="/word/${entry.target}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${entry.kind}+xml"/>`,
  ).join('') + '</Types>'));
  return archive.save();
}

type Projection = (xml: string) => string;

/**
 * What each first, odd and even page of each section shows:
 * `<section>:<kind>:<page>=<text>`, `-` for a blank story or none.
 */
async function shownPages(buffer: Buffer, project: Projection = (xml) => xml): Promise<string[]> {
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
      : Array.from(parseXml(projected).getElementsByTagNameNS(W_NS, 'p'))
        .filter((element) => (element.parentNode as Element).localName !== 'txbxContent')
        .map((element) => Array.from(element.getElementsByTagNameNS(W_NS, 't'))
          .map((textElement) => textElement.textContent ?? '').join(''))
        .filter((line) => line !== '').join(' / ');
    shown.push(`${slot.sectionOrdinal}:${slot.kind}:${page}=${text}`);
  }
  return shown;
}

async function shownAfterDocxCore(buffer: Buffer, mode: 'accept' | 'reject'): Promise<string[]> {
  const document = await DocxDocument.load(buffer);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return shownPages((await document.toBuffer()).buffer);
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1394-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Tracked revisions in the story parts the compared package selects. */
async function storyRevisionCount(buffer: Buffer): Promise<number> {
  const archive = await DocxArchive.load(buffer);
  let count = 0;
  for (const path of archive.listFiles().filter((name) => /^word\/(header|footer)[^/]*\.xml$/u.test(name))) {
    const document = parseXml((await archive.getFile(path))!);
    count += document.getElementsByTagNameNS(W_NS, 'ins').length + document.getElementsByTagNameNS(W_NS, 'del').length;
  }
  return count;
}

/** Header/footer references nested in a `w:sectPrChange` snapshot (CT_SectPrBase forbids them). */
async function snapshotStoryReferences(buffer: Buffer): Promise<number> {
  const document = parseXml(await (await DocxArchive.load(buffer)).getDocumentXml());
  return Array.from(document.getElementsByTagNameNS(W_NS, 'sectPrChange')).reduce(
    (count, change) =>
      count +
      change.getElementsByTagNameNS(W_NS, 'headerReference').length +
      change.getElementsByTagNameNS(W_NS, 'footerReference').length,
    0,
  );
}

const bodyText = async (buffer: Buffer, project: Projection = (xml) => xml): Promise<string> =>
  extractRoundTripComparisonText(project(await (await DocxArchive.load(buffer)).getDocumentXml()));

/** Text inside the text boxes of every story part after a projection. */
async function textBoxText(buffer: Buffer, project: Projection): Promise<string> {
  const archive = await DocxArchive.load(buffer);
  const texts: string[] = [];
  for (const path of archive.listFiles().filter((name) => /^word\/(header|footer)[^/]*\.xml$/u.test(name)).sort()) {
    const document = parseXml(project((await archive.getFile(path))!));
    for (const content of Array.from(document.getElementsByTagNameNS(W_NS, 'txbxContent'))) {
      texts.push(Array.from(content.getElementsByTagNameNS(W_NS, 't')).map((element) => element.textContent).join(''));
    }
  }
  return texts.join(' / ');
}

async function expectSlotRedline(
  { then }: Pick<AllureBddContext, 'then'>,
  original: Buffer,
  revised: Buffer,
  result: TaggedCompareResult,
): Promise<void> {
  await then('the header/footer parts carry tracked revisions and no snapshot holds a reference', async () => {
    expect(await storyRevisionCount(result.document)).toBeGreaterThan(0);
    expect(await snapshotStoryReferences(result.document)).toBe(0);
  });
  await then('every page shows the revised story after Accept All and the original after Reject All, with both appliers', async () => {
    const expectedAccepted = await shownPages(revised, acceptAllChanges);
    const expectedRejected = await shownPages(original, rejectAllChanges);
    expect(await shownPages(result.document, acceptAllChanges)).toEqual(expectedAccepted);
    expect(await shownPages(result.document, rejectAllChanges)).toEqual(expectedRejected);
    expect(await shownAfterDocxCore(result.document, 'accept')).toEqual(expectedAccepted);
    expect(await shownAfterDocxCore(result.document, 'reject')).toEqual(expectedRejected);
  });
  await then('body text round-trips and nothing is left unrepresented', async () => {
    expect(await bodyText(result.document, acceptAllChanges)).toBe(await bodyText(revised));
    expect(await bodyText(result.document, rejectAllChanges)).toBe(await bodyText(original));
    expect(result.unrepresentedChanges).toBeUndefined();
  });
  await then('the compared package passes the emitted-document schema gate', () => assertSchema(result.document));
}

describe('header/footer attached to or dropped from a surviving section (#1394)', () => {
  test.openspec('[SDX-CMP-SLOTLIFE-01] A header or footer attached to a surviving section is tracked as inserted content')(
    'tracks a default footer added to a one-section document that had none',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('one section with no footer; the revision adds a default footer', () =>
        Promise.all([
          packageWith(paragraph('Body'), '', []),
          packageWith(paragraph('Body, revised'), ref('footer', 'rIdF'), [
            story('rIdF', 'footer', 'footer1.xml', paragraph('Confidential')),
          ]),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectSlotRedline({ then }, original, revised, result);
      await then('the footer text is a tracked insertion', async () => {
        const footer = (await (await DocxArchive.load(result.document)).getFile('word/footer1.xml'))!;
        expect(parseXml(footer).getElementsByTagNameNS(W_NS, 'ins').length).toBeGreaterThan(0);
        expect(extractRoundTripComparisonText(rejectAllChanges(footer)).trim()).toBe('');
        expect(extractRoundTripComparisonText(acceptAllChanges(footer))).toBe('Confidential');
      });
    },
  );

  test.openspec('[SDX-CMP-SLOTLIFE-01] A header or footer attached to a surviving section is tracked as inserted content')(
    'tracks a text-box footer added to a section that had none',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('one section with no footer; the revision adds a footer holding a VML text box', () =>
        Promise.all([
          packageWith(paragraph('Body'), '', []),
          packageWith(paragraph('Body, revised'), ref('footer', 'rIdF'), [
            story('rIdF', 'footer', 'footer1.xml', vmlBox('Boxed notice') + paragraph('Confidential')),
          ]),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectSlotRedline({ then }, original, revised, result);
      await then('the box text is inserted, so Reject All leaves no box text', async () => {
        expect(await textBoxText(result.document, acceptAllChanges)).toBe('Boxed notice');
        expect(await textBoxText(result.document, rejectAllChanges)).toBe('');
      });
    },
  );

  test.openspec('[SDX-CMP-SLOTLIFE-01] A header or footer attached to a surviving section is tracked as inserted content')(
    'tracks a header added to the first section that a later section inherits',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('two sections with no header; the revision gives the first section one', () =>
        Promise.all([
          packageWith(sectionEnd('One', '') + paragraph('Two'), '', []),
          packageWith(sectionEnd('One', ref('header', 'rIdH')) + paragraph('Two, revised'), '', [
            story('rIdH', 'header', 'header1.xml', paragraph('Draft')),
          ]),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectSlotRedline({ then }, original, revised, result);
    },
  );

  test.openspec('[SDX-CMP-SLOTLIFE-02] A header or footer dropped from a surviving section is tracked as deleted content')(
    'tracks a default footer dropped from a one-section document',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('one section with a default footer; the revision drops it', () =>
        Promise.all([
          packageWith(paragraph('Body'), ref('footer', 'rIdF'), [
            story('rIdF', 'footer', 'footer1.xml', paragraph('Confidential')),
          ]),
          packageWith(paragraph('Body, revised'), '', []),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectSlotRedline({ then }, original, revised, result);
    },
  );

  test.openspec('[SDX-CMP-SLOTLIFE-02] A header or footer dropped from a surviving section is tracked as deleted content')(
    'tracks a text-box footer dropped from a surviving section without wrapping its carrier',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('one section with a boxed footer; the revision drops it', () =>
        Promise.all([
          packageWith(paragraph('Body'), ref('footer', 'rIdF'), [
            story('rIdF', 'footer', 'footer1.xml', vmlBox('Boxed notice') + paragraph('Confidential')),
          ]),
          packageWith(paragraph('Body, revised'), '', []),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectSlotRedline({ then }, original, revised, result);
      await then('the box text is deleted, so Accept All leaves no box text', async () => {
        expect(await textBoxText(result.document, acceptAllChanges)).toBe('');
        expect(await textBoxText(result.document, rejectAllChanges)).toBe('Boxed notice');
      });
    },
  );

  test.openspec('[SDX-CMP-SLOTLIFE-02] A header or footer dropped from a surviving section is tracked as deleted content')(
    'tracks a first-page header dropped from a section that keeps its title page',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('a title-page section with a first-page header; the revision drops the header', () =>
        Promise.all([
          packageWith(paragraph('Body'), ref('header', 'rIdH', 'first') + '<w:titlePg/>', [
            story('rIdH', 'header', 'header1.xml', paragraph('Cover page header')),
          ]),
          packageWith(paragraph('Body, revised'), '<w:titlePg/>', []),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectSlotRedline({ then }, original, revised, result);
    },
  );

  test.openspec('[SDX-CMP-SLOTLIFE-03] A section that starts or stops inheriting a header or footer is tracked as replaced content')(
    'tracks a later section that drops its own footer and inherits the previous one',
    async ({ given, when, then }: AllureBddContext) => {
      const inherited = story('rIdA', 'footer', 'footer1.xml', paragraph('Inherited footer'));
      const [original, revised] = await given('two sections with their own footers; the revision drops the second', () =>
        Promise.all([
          packageWith(sectionEnd('One', ref('footer', 'rIdA')) + paragraph('Two'), ref('footer', 'rIdB'), [
            inherited,
            story('rIdB', 'footer', 'footer2.xml', paragraph('Own footer')),
          ]),
          packageWith(sectionEnd('One', ref('footer', 'rIdA')) + paragraph('Two, revised'), '', [inherited]),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectSlotRedline({ then }, original, revised, result);
    },
  );

  test.openspec('[SDX-CMP-SLOTLIFE-03] A section that starts or stops inheriting a header or footer is tracked as replaced content')(
    'tracks a later section that gets its own text-box footer in place of the inherited one',
    async ({ given, when, then }: AllureBddContext) => {
      const inherited = story('rIdA', 'footer', 'footer1.xml', paragraph('Inherited footer'));
      const [original, revised] = await given('two sections sharing one footer; the revision gives the second a boxed footer', () =>
        Promise.all([
          packageWith(sectionEnd('One', ref('footer', 'rIdA')) + paragraph('Two'), '', [inherited]),
          packageWith(sectionEnd('One', ref('footer', 'rIdA')) + paragraph('Two, revised'), ref('footer', 'rIdB'), [
            inherited,
            story('rIdB', 'footer', 'footer2.xml', vmlBox('Boxed notice') + paragraph('Own footer')),
          ]),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectSlotRedline({ then }, original, revised, result);
      await then('the box text is inserted', async () => {
        expect(await textBoxText(result.document, acceptAllChanges)).toBe('Boxed notice');
        expect(await textBoxText(result.document, rejectAllChanges)).toBe('');
      });
    },
  );

  test('a slot change the redline still cannot carry is reported against the documents as given', async ({
    given, when, then,
  }: AllureBddContext) => {
    const slots = await given('one slot made explicit on each side', (): NormalizedStorySlot[] => [
      { side: 'original', sectionOrdinal: 0, kind: 'header', role: 'first', partPath: 'word/header9.xml', copiedFrom: undefined },
      { side: 'revised', sectionOrdinal: 2, kind: 'footer', role: 'default', partPath: 'word/footer9.xml', copiedFrom: 'word/footer1.xml' },
    ]);
    const reported = await when('the comparison reports those slots and another as changed', () =>
      reportSlotChangesAgainstInputs([
        { scope: 'header', kind: 'changed', sectionIndex: 0, role: 'first' },
        { scope: 'footer', kind: 'changed', sectionIndex: 2, role: 'default' },
        { scope: 'footer', kind: 'changed', sectionIndex: 0, role: 'first' },
        { scope: 'section', kind: 'changed', sectionIndex: 0 },
      ] as const, slots));
    await then('the original-side slot reads as added, the revised-side one as removed, the rest unchanged', () => {
      expect(reported.map((change) => change.kind)).toEqual(['added', 'removed', 'changed', 'changed']);
    });
  });
});

const STYLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
const DRAW_NS = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';

/**
 * What LibreOffice's saved ODT shows in its page headers and footers: the
 * non-empty text of every header/footer, and how many shapes they draw.
 */
async function odtHeaderFooterView(bytes: Buffer): Promise<{ texts: string[]; shapes: number }> {
  const xml = await (await JSZip.loadAsync(bytes)).file('styles.xml')?.async('string');
  const texts: string[] = [];
  let shapes = 0;
  if (!xml) return { texts, shapes };
  const document = parseXml(xml);
  for (const name of ['header', 'header-first', 'footer', 'footer-first', 'header-left', 'footer-left']) {
    for (const element of Array.from(document.getElementsByTagNameNS(STYLE_NS, name))) {
      const text = (element.textContent ?? '').trim();
      if (text) texts.push(`${name}=${text}`);
      shapes += element.getElementsByTagNameNS(DRAW_NS, 'frame').length +
        element.getElementsByTagNameNS(DRAW_NS, 'custom-shape').length;
    }
  }
  return { texts: texts.sort(), shapes };
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice.
const reader = process.env.SAFE_DOCX_SLOT_LIFECYCLE_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice accepts and rejects a header/footer slot lifecycle (#1394)', () => {
  test('a plain or boxed footer attached to or dropped from a surviving section', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const plain = story('rIdF', 'footer', 'footer1.xml', paragraph('Confidential'));
    const boxed = story('rIdF', 'footer', 'footer1.xml', vmlBox('Boxed notice') + paragraph('Confidential'));
    const withFooter = (part: Part, text: string) => packageWith(paragraph(text), ref('footer', 'rIdF'), [part]);
    const withoutFooter = (text: string) => packageWith(paragraph(text), '', []);
    const cases: Array<{ label: string; original: Buffer; revised: Buffer }> = [
      { label: 'plain footer attached', original: await withoutFooter('Body'), revised: await withFooter(plain, 'Body, revised') },
      { label: 'plain footer dropped', original: await withFooter(plain, 'Body'), revised: await withoutFooter('Body, revised') },
      { label: 'boxed footer attached', original: await withoutFooter('Body'), revised: await withFooter(boxed, 'Body, revised') },
      { label: 'boxed footer dropped', original: await withFooter(boxed, 'Body'), revised: await withoutFooter('Body, revised') },
    ];
    const compared = await Promise.all(cases.map(({ original, revised }) =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)));
    // One LibreOffice launch per case keeps each macro run short on a loaded
    // host; a launch that saves nothing is an infrastructure failure, not a
    // verdict, and is retried once.
    const packages: Buffer[] = [];
    for (const [index, { original, revised }] of cases.entries()) {
      const jobs = [
        { op: 'identity' as const, docx: original, saveAs: 'odt' as const },
        { op: 'identity' as const, docx: revised, saveAs: 'odt' as const },
        { op: 'accept' as const, docx: compared[index]!.document, saveAs: 'odt' as const },
        { op: 'reject' as const, docx: compared[index]!.document, saveAs: 'odt' as const },
      ];
      const capture = (offset: number, bytes: Buffer) => { packages[index * 4 + offset] = bytes; };
      try {
        await runLibreOfficeOracle(jobs, undefined, capture);
      } catch (error) {
        if (!/produced no output/u.test(String(error))) throw error;
        await runLibreOfficeOracle(jobs, undefined, capture);
      }
    }
    for (const [index, { label }] of cases.entries()) {
      const [original, revised, accepted, rejected] = await Promise.all(
        packages.slice(index * 4, index * 4 + 4).map(odtHeaderFooterView),
      );
      console.log(`[#1394] ${label}: original=${JSON.stringify(original)} revised=${JSON.stringify(revised)}` +
        ` accepted=${JSON.stringify(accepted)} rejected=${JSON.stringify(rejected)}`);
      // Text is the verdict. LibreOffice keeps a VML shape whose anchor run is
      // tracked through both Accept and Reject, in the body as well as in a
      // header or footer, so its shape count is logged, not asserted.
      expect(accepted!.texts, `${label} accept`).toEqual(revised!.texts);
      expect(rejected!.texts, `${label} reject`).toEqual(original!.texts);
    }
  }, 600_000);
});
