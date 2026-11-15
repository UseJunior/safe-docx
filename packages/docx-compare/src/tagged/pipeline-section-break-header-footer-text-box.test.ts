/**
 * A section break added or removed beside a header or footer that holds a
 * text box. The break is recorded on paragraph marks, as for any section
 * break (#1144): the paragraph that gains the paragraph-level `w:sectPr`
 * carries an inserted mark, and the empty boundary paragraph that keeps a
 * removed one carries a deleted mark. The header or footer's
 * own content (text beside the box, a table row, the box's text) is tracked in
 * the part; a resized box is listed with the `drawing` scope only.
 *
 * Section ordinals no longer line up once the section count changes, so a
 * header/footer story cannot be paired by the slots its section ordinals name.
 * It is paired through the section alignment Reject All and Accept All
 * produce instead: the body-level `w:sectPr` stays the last section on both
 * sides, and a part is paired with the original story that every aligned page
 * showing it showed. Each case holds every page of every section, after
 * Accept All and after Reject All, with the docx-compare and the docx-core
 * appliers, to the revised and the original document.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @see https://github.com/UseJunior/safe-docx/issues/1487
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
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

const TEST_FEATURE = 'Section Break Beside A Header Or Footer Text Box';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.18' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
  );

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NAMESPACES = {
  v: 'urn:schemas-microsoft-com:vml',
  o: 'urn:schemas-microsoft-com:office:office',
  w10: 'urn:schemas-microsoft-com:office:word',
  r: R_NS,
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
};
const DECLARATIONS = Object.entries(NAMESPACES).map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`).join('');
/** The body document's extra namespaces: `buildDocxFromBodyXml` declares `w14` and `mc` itself. */
const { w14: _w14, mc: _mc, ...BODY_NAMESPACES } = NAMESPACES;
const BODY_NAMESPACE_OPTIONS = { namespaces: BODY_NAMESPACES, ignorablePrefixes: ['wps'] };
// Each case compares, applies twice per applier and runs the schema gate.
const LOAD_SENSITIVE_TIMEOUT_MS = 60_000;
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-15T00:00:00.000Z') };
const PAGE_SETUP =
  '<w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

type Kind = 'header' | 'footer';
type BoxFlavour = 'VML' | 'DrawingML';

const text = (value: string): string => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
const paragraph = (content: string): string => `<w:p>${content}</w:p>`;
const cell = (content: string): string =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${paragraph(content)}</w:tc>`;
const row = (...cells: string[]): string => `<w:tr>${cells.map((value) => cell(text(value))).join('')}</w:tr>`;
const table = (...rows: string[]): string =>
  '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  `${rows.join('')}</w:tbl>`;
const COMPANY = row('Company', 'Acme Corp');
const ADDRESS = row('Address', '1 Main Street');

/** A text box anchored in its own paragraph, holding one paragraph of `boxText`. */
function textBox(flavour: BoxFlavour, boxText: string, wide: boolean): string {
  const content = paragraph(text(boxText));
  if (flavour === 'VML') {
    return paragraph(
      '<w:r><w:pict><v:shape id="box1" o:spid="_x0000_s1026" type="#_x0000_t202"' +
      ` style="position:absolute;margin-left:300pt;margin-top:0;width:${wide ? 200 : 150}pt;height:50pt;z-index:1">` +
      `<v:textbox><w:txbxContent>${content}</w:txbxContent></v:textbox><w10:wrap type="square"/></v:shape></w:pict></w:r>`,
    );
  }
  const cx = wide ? 2540000 : 1905000;
  return paragraph(
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0"' +
    ' relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>3810000</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    `<wp:extent cx="${cx}" cy="635000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    '<wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="Text Box 1"/><wp:cNvGraphicFramePr/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="635000"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>',
  );
}

/** A header/footer story: a legend paragraph, a table, and a text box. */
interface Story {
  legend: string;
  rows: readonly string[];
  boxText: string;
  wide: boolean;
}
const BASE_STORY: Story = { legend: 'Legend draft', rows: [COMPANY], boxText: 'Confidential', wide: false };
const storyXml = (flavour: BoxFlavour, story: Story): string =>
  paragraph(text(story.legend)) + table(...story.rows) + textBox(flavour, story.boxText, story.wide);

type StoryChange = 'text beside the box' | 'a table row' | 'a box resize' | 'the box text';
const STORY_CHANGES: Record<StoryChange, Partial<Story>> = {
  'text beside the box': { legend: 'Legend final' },
  'a table row': { rows: [COMPANY, ADDRESS] },
  'a box resize': { wide: true },
  'the box text': { boxText: 'Confidential draft' },
};

interface PartSpec { id: string; kind: Kind; target: string; xml: string }

/**
 * A package whose body holds `sections` sections: a paragraph-level
 * `w:sectPr` on the first `sections - 1` paragraphs and the body-level one.
 * `references[i]` names the parts section `i` references explicitly.
 */
async function sectionedPackage(
  bodyTexts: readonly string[],
  references: ReadonlyArray<readonly PartSpec[]>,
  parts: readonly PartSpec[],
): Promise<Buffer> {
  const reference = (part: PartSpec): string => `<w:${part.kind}Reference w:type="default" r:id="${part.id}"/>`;
  const sectPr = (index: number): string =>
    `<w:sectPr>${(references[index] ?? []).map(reference).join('')}${PAGE_SETUP}</w:sectPr>`;
  const last = references.length - 1;
  const body = bodyTexts.map((value, index) =>
    index < last ? `<w:p><w:pPr>${sectPr(index)}</w:pPr>${text(value)}</w:p>` : paragraph(text(value))).join('');
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(body, [], BODY_NAMESPACE_OPTIONS));
  const documentXml = await archive.getDocumentXml();
  const at = documentXml.lastIndexOf('<w:sectPr/>');
  archive.setDocumentXml(documentXml.slice(0, at) + sectPr(last) + documentXml.slice(at + '<w:sectPr/>'.length));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      parts.map((part) => `<Relationship Id="${part.id}" Type="${R_NS}/${part.kind}" Target="${part.target}"/>`).join('') +
      '</Relationships>',
  );
  for (const part of parts) {
    const root = part.kind === 'header' ? 'w:hdr' : 'w:ftr';
    archive.setFile(
      `word/${part.target}`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${root} xmlns:w="${W_NS}"${DECLARATIONS}` +
        ` mc:Ignorable="w14 wps">${part.xml}</${root}>`,
    );
  }
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>', parts.map((part) =>
    `<Override PartName="/word/${part.target}"` +
      ` ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${part.kind}+xml"/>`,
  ).join('') + '</Types>'));
  return archive.save();
}

const isW = (node: Node | null, ...names: string[]): node is Element =>
  node !== null && node.nodeType === 1 && (node as Element).namespaceURI === W_NS
  && names.includes((node as Element).localName);
const elementChildren = (element: Element): Element[] =>
  Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1);

function insideTextBox(element: Element, stopAt: Element): boolean {
  for (let node = element.parentNode; node && node !== stopAt; node = node.parentNode) {
    if (isW(node, 'txbxContent')) return true;
  }
  return false;
}

/** A paragraph's own text, leaving out the text of any box anchored in it. */
function paragraphText(p: Element): string {
  let value = '';
  for (const element of Array.from(p.getElementsByTagNameNS(W_NS, 't'))) {
    if (!insideTextBox(element, p)) value += element.textContent ?? '';
  }
  return value;
}

/** A block-level story, block by block: a paragraph as its text, a table row by row. */
function blocksView(container: Element): string[] {
  return elementChildren(container).flatMap((block) => {
    if (isW(block, 'p')) return [`p:${paragraphText(block)}`];
    if (isW(block, 'tbl')) {
      return ['tbl:' + elementChildren(block).filter((child) => isW(child, 'tr')).map((tr) =>
        elementChildren(tr).filter((child) => isW(child, 'tc'))
          .map((tc) => elementChildren(tc).filter((part) => isW(part, 'p')).map(paragraphText).join('/')).join('|'),
      ).join(' ; ')];
    }
    return [];
  });
}

/** What a header/footer part shows: its own blocks, then each stored box copy's blocks. */
function partView(xml: string): string {
  const root = parseXml(xml).documentElement;
  return JSON.stringify({
    blocks: blocksView(root),
    boxes: Array.from(root.getElementsByTagNameNS(W_NS, 'txbxContent')).map(blocksView),
  });
}

type Projection = (xml: string) => string;
const identity: Projection = (xml) => xml;

/** `<section>:<kind>:<page>=<view>` for every first, odd and even page; `-` for a blank story. */
async function shownPages(buffer: Buffer, project: Projection = identity): Promise<string[]> {
  const archive = await DocxArchive.load(buffer);
  const bindings = resolveEffectiveStoryBindings({
    documentXml: project(await archive.getDocumentXml()),
    relationshipsXml: await archive.getFile('word/_rels/document.xml.rels'),
    settingsXml: await archive.getFile('word/settings.xml'),
  });
  expect(bindings.ok).toBe(true);
  const shown: string[] = [];
  for (const { page, slot } of pageStorySlots(bindings)) {
    const xml = slot.targetPath ? await archive.getFile(slot.targetPath) : null;
    const projected = xml === null ? null : project(xml);
    shown.push(`${slot.sectionOrdinal}:${slot.kind}:${page}=${
      projected === null || isBlankStoryPart(projected) ? '-' : partView(projected)}`);
  }
  return shown;
}

async function appliedByDocxCore(buffer: Buffer, mode: 'accept' | 'reject'): Promise<Buffer> {
  const document = await DocxDocument.load(buffer);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return (await document.toBuffer()).buffer;
}

const bodyText = async (buffer: Buffer, project: Projection = identity): Promise<string> =>
  extractRoundTripComparisonText(project(await (await DocxArchive.load(buffer)).getDocumentXml()));

const liveSectionCount = async (buffer: Buffer, project: Projection = identity): Promise<number> =>
  Array.from(parseXml(project(await (await DocxArchive.load(buffer)).getDocumentXml()))
    .getElementsByTagNameNS(W_NS, 'sectPr')).filter((sectPr) => !isW(sectPr.parentNode, 'sectPrChange')).length;

/**
 * The gate validates `word/document.xml`; each header/footer part's blocks
 * (CT_HdrFtr holds the same block-level content as a body) are validated as a
 * document body of their own.
 */
async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1487-'));
  try {
    const archive = await DocxArchive.load(buffer);
    const paths = [join(directory, 'compared.docx')];
    await writeFile(paths[0]!, buffer);
    for (const path of archive.listFiles().filter((name) => /^word\/(header|footer)\d+\.xml$/u.test(name))) {
      const xml = (await archive.getFile(path))!;
      const out = join(directory, path.replace('word/', ''));
      await writeFile(out, xml
        .replace(/<w:(hdr|ftr)(\s[^>]*)?>/u, (_match, _root, attributes = '') => `<w:document${attributes}><w:body>`)
        .replace(/<\/w:(hdr|ftr)>\s*$/u, '</w:body></w:document>'));
      paths.push(out);
    }
    const check = spawnSync(process.execPath, [schemaScript, ...paths], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Section breaks the body records on paragraph marks: a paragraph-level
 * `w:sectPr` whose paragraph mark is inserted (an added break) or deleted (a
 * removed break, kept on its empty boundary paragraph).
 */
function sectionBreakRevisions(documentXml: string): { added: number; removed: number } {
  const document = parseXml(documentXml);
  let added = 0;
  let removed = 0;
  for (const pPr of Array.from(document.getElementsByTagNameNS(W_NS, 'pPr'))) {
    if (!isW(pPr.parentNode, 'p') || !elementChildren(pPr).some((child) => isW(child, 'sectPr'))) continue;
    const mark = elementChildren(pPr).find((child) => isW(child, 'rPr'));
    const markRevisions = mark ? elementChildren(mark) : [];
    if (markRevisions.some((child) => isW(child, 'ins'))) added += 1;
    if (markRevisions.some((child) => isW(child, 'del'))) removed += 1;
  }
  return { added, removed };
}

/** Revision markup in header/footer parts: run-level `w:ins`/`w:del` and whole-row markers. */
async function storyRevisionCount(buffer: Buffer): Promise<number> {
  const archive = await DocxArchive.load(buffer);
  let count = 0;
  for (const path of archive.listFiles().filter((name) => /^word\/(header|footer)\d+\.xml$/u.test(name))) {
    const document = parseXml((await archive.getFile(path))!);
    count += Array.from(document.getElementsByTagNameNS(W_NS, '*'))
      .filter((element) => isW(element, 'ins', 'del')).length;
  }
  return count;
}

async function expectRoundTrip(
  { then }: Pick<AllureBddContext, 'then'>,
  original: Buffer,
  revised: Buffer,
  result: TaggedCompareResult,
): Promise<void> {
  await then('every page shows the revised headers and footers after Accept All and the original ones after Reject All, with both appliers', async () => {
    const [expectedAccepted, expectedRejected] = await Promise.all([shownPages(revised), shownPages(original)]);
    expect(await shownPages(result.document, acceptAllChanges)).toEqual(expectedAccepted);
    expect(await shownPages(result.document, rejectAllChanges)).toEqual(expectedRejected);
    expect(await shownPages(await appliedByDocxCore(result.document, 'accept'))).toEqual(expectedAccepted);
    expect(await shownPages(await appliedByDocxCore(result.document, 'reject'))).toEqual(expectedRejected);
  });
  await then('the body text and the section count round-trip with both appliers', async () => {
    expect(await bodyText(result.document, acceptAllChanges)).toBe(await bodyText(revised));
    expect(await bodyText(result.document, rejectAllChanges)).toBe(await bodyText(original));
    expect(await bodyText(await appliedByDocxCore(result.document, 'accept'))).toBe(await bodyText(revised));
    expect(await bodyText(await appliedByDocxCore(result.document, 'reject'))).toBe(await bodyText(original));
    expect(await liveSectionCount(result.document, acceptAllChanges)).toBe(await liveSectionCount(revised));
    expect(await liveSectionCount(result.document, rejectAllChanges)).toBe(await liveSectionCount(original));
    expect(await liveSectionCount(await appliedByDocxCore(result.document, 'accept'))).toBe(await liveSectionCount(revised));
    expect(await liveSectionCount(await appliedByDocxCore(result.document, 'reject'))).toBe(await liveSectionCount(original));
  });
  await then('the compared package passes the emitted-document schema gate', () => assertSchema(result.document));
}

/** The drawing entries a resize lists; nothing else may be listed. */
function expectListedOnlyDrawings(result: TaggedCompareResult, resized: boolean): void {
  if (!resized) {
    expect(result.unrepresentedChanges).toBeUndefined();
    return;
  }
  expect(result.unrepresentedChanges?.length ?? 0).toBeGreaterThan(0);
  for (const change of result.unrepresentedChanges ?? []) expect(change.scope).toBe('drawing');
}

/**
 * How the two-section side names its header/footer: on both breaks, only on
 * the paragraph-level break (the body-level section inherits it), or only on
 * the body-level break (the new first section shows none).
 */
type ReferenceShape = 'restated' | 'inherited' | 'body-level only';
const REFERENCE_SHAPES: readonly ReferenceShape[] = ['restated', 'inherited', 'body-level only'];
const twoSectionReferences = (shape: ReferenceShape, part: PartSpec): PartSpec[][] =>
  shape === 'restated' ? [[part], [part]] : shape === 'inherited' ? [[part], []] : [[], [part]];

describe('a section break added or removed while a header or footer text box story changes (#1487)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  for (const direction of ['added', 'removed'] as const) {
    for (const kind of ['header', 'footer'] as const) {
      for (const flavour of ['VML', 'DrawingML'] as const) {
        for (const [changeName, change] of Object.entries(STORY_CHANGES) as Array<[StoryChange, Partial<Story>]>) {
          for (const shape of REFERENCE_SHAPES) {
            test(`tracks ${changeName} in a ${kind} with a ${flavour} box when a section break is ${direction} (${shape} references)`, async ({ given, when, then }: AllureBddContext) => {
              const resized = change.wide === true;
              const [original, revised] = await given(`one section and two sections sharing a ${kind} that holds a ${flavour} text box; the revision changes ${changeName}`, async () => {
                const part = (story: Story): PartSpec => ({ id: 'rIdStory', kind, target: `${kind}1.xml`, xml: storyXml(flavour, story) });
                const before = part(BASE_STORY);
                const after = part({ ...BASE_STORY, ...change });
                const one = (spec: PartSpec, closing: string): Promise<Buffer> =>
                  sectionedPackage(['Opening clause.', closing], [[spec]], [spec]);
                const two = (spec: PartSpec, closing: string): Promise<Buffer> =>
                  sectionedPackage(['Opening clause.', closing], twoSectionReferences(shape, spec), [spec]);
                return direction === 'added'
                  ? Promise.all([one(before, 'Closing clause draft.'), two(after, 'Closing clause final.')])
                  : Promise.all([two(before, 'Closing clause draft.'), one(after, 'Closing clause final.')]);
              });
              const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
              await then('the break is a paragraph-mark revision and only a resized box is listed', async () => {
                const documentXml = await (await DocxArchive.load(result.document)).getDocumentXml();
                expect(sectionBreakRevisions(documentXml)).toEqual(direction === 'added' ? { added: 1, removed: 0 } : { added: 0, removed: 1 });
                expectListedOnlyDrawings(result, resized);
                if (!resized) expect(await storyRevisionCount(result.document)).toBeGreaterThan(0);
              });
              await expectRoundTrip({ then }, original, revised, result);
            });
          }
        }
      }
    }
  }
});

describe('a section break beside a header or footer text box whose part is shared or new (#1487)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  const FOOTER = (target: string, story: Story, id = 'rIdStory'): PartSpec =>
    ({ id, kind: 'footer', target, xml: storyXml('DrawingML', story) });
  const EDITED: Story = { ...BASE_STORY, legend: 'Legend final' };

  test('compares a footer shared by two sections once when a third section inherits it', async ({ given, when, then }: AllureBddContext) => {
    const [original, revised] = await given('two sections naming one footer; the revision adds an inheriting break and edits the text beside the box', () => {
      const before = FOOTER('footer1.xml', BASE_STORY);
      const after = FOOTER('footer1.xml', EDITED);
      return Promise.all([
        sectionedPackage(['First.', 'Second draft.'], [[before], [before]], [before]),
        sectionedPackage(['First.', 'Middle.', 'Second final.'], [[after], [], [after]], [after]),
      ]);
    });
    const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    await then('the shared footer carries one deletion and one insertion, not one pair per section', async () => {
      expect(result.unrepresentedChanges).toBeUndefined();
      const document = parseXml((await (await DocxArchive.load(result.document)).getFile('word/footer1.xml'))!);
      const outsideBox = (name: string): number => Array.from(document.getElementsByTagNameNS(W_NS, name))
        .filter((element) => !insideTextBox(element, document.documentElement)).length;
      expect([outsideBox('ins'), outsideBox('del')]).toEqual([1, 1]);
      expect(sectionBreakRevisions(await (await DocxArchive.load(result.document)).getDocumentXml())).toEqual({ added: 1, removed: 0 });
    });
    await expectRoundTrip({ then }, original, revised, result);
  });

  for (const direction of ['added', 'removed'] as const) {
    for (const newPartHoldsBox of [false, true]) {
      const newPartName = newPartHoldsBox ? 'a new footer with its own text box' : 'a new plain footer';
      test(`tracks the changed footer when the ${direction} break's section has ${newPartName}`, async ({ given, when, then }: AllureBddContext) => {
        const [original, revised] = await given(`one footer holding a text box; the ${direction} break's section names ${newPartName}`, () => {
          const cover: PartSpec = newPartHoldsBox
            ? FOOTER('footer2.xml', { ...BASE_STORY, legend: 'Cover legend', boxText: 'Cover box' }, 'rIdCover')
            : { id: 'rIdCover', kind: 'footer', target: 'footer2.xml', xml: paragraph(text('Cover footer')) };
          const one = (story: Story, closing: string): Promise<Buffer> => {
            const spec = FOOTER('footer1.xml', story);
            return sectionedPackage(['Opening clause.', closing], [[spec]], [spec]);
          };
          const two = (story: Story, closing: string): Promise<Buffer> => {
            const spec = FOOTER('footer1.xml', story);
            return sectionedPackage(['Opening clause.', closing], [[cover], [spec]], [spec, cover]);
          };
          return direction === 'added'
            ? Promise.all([one(BASE_STORY, 'Closing clause draft.'), two(EDITED, 'Closing clause final.')])
            : Promise.all([two(BASE_STORY, 'Closing clause draft.'), one(EDITED, 'Closing clause final.')]);
        });
        const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
        await then('nothing is left unrepresented', () => {
          expect(result.unrepresentedChanges).toBeUndefined();
        });
        await expectRoundTrip({ then }, original, revised, result);
      });
    }
  }
});

describe('a section break beside a retained or a final section whose footer holds a text box (#1487)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  const FOOTER = (id: string, target: string, legend: string, boxText = 'Confidential'): PartSpec =>
    ({ id, kind: 'footer', target, xml: storyXml('DrawingML', { ...BASE_STORY, legend, boxText }) });
  const LEADING = FOOTER('rIdA', 'footer1.xml', 'Legend draft');
  const LEADING_EDITED = FOOTER('rIdA', 'footer1.xml', 'Legend final');
  const FINAL = FOOTER('rIdC', 'footer2.xml', 'Final section footer', 'Final section box');

  for (const direction of ['added', 'removed'] as const) {
    test(`tracks the edited footer of a retained first section when an inheriting section after it is ${direction}`, async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('a first section and a final section with footers of their own; the revision edits the text beside the first footer box', () => {
        const two = (leading: PartSpec): Promise<Buffer> =>
          sectionedPackage(['First.', 'Last.'], [[leading], [FINAL]], [leading, FINAL]);
        const three = (leading: PartSpec): Promise<Buffer> =>
          sectionedPackage(['First.', 'Inserted middle.', 'Last.'], [[leading], [], [FINAL]], [leading, FINAL]);
        return direction === 'added'
          ? Promise.all([two(LEADING), three(LEADING_EDITED)])
          : Promise.all([three(LEADING), two(LEADING_EDITED)]);
      });
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await then('the break is a paragraph-mark revision, the footer edit is tracked and nothing is listed', async () => {
        expect(result.unrepresentedChanges).toBeUndefined();
        expect(await storyRevisionCount(result.document)).toBeGreaterThan(0);
        expect(sectionBreakRevisions(await (await DocxArchive.load(result.document)).getDocumentXml()))
          .toEqual(direction === 'added' ? { added: 1, removed: 0 } : { added: 0, removed: 1 });
      });
      await expectRoundTrip({ then }, original, revised, result);
    });
  }

  test('tracks the boxed header of the last section when an inheriting section is added and a boxed footer shared by every section changes', async ({ given, when, then }: AllureBddContext) => {
    const [original, revised] = await given('three sections with plain, plain and boxed headers and one shared boxed footer; the revision adds an inheriting final section and edits the boxed header and the footer', () => {
      const plainHeader = (id: string, target: string, value: string): PartSpec =>
        ({ id, kind: 'header', target, xml: paragraph(text(value)) });
      const boxedHeader = (legend: string): PartSpec =>
        ({ id: 'rIdH5', kind: 'header', target: 'header5.xml', xml: storyXml('DrawingML', { ...BASE_STORY, legend, boxText: 'Header box' }) });
      const cover = plainHeader('rIdH1', 'header1.xml', 'Cover header');
      const middle = plainHeader('rIdH3', 'header3.xml', 'Middle header');
      const before = { header: boxedHeader('Header legend draft'), footer: LEADING };
      const after = { header: boxedHeader('Header legend final'), footer: LEADING_EDITED };
      return Promise.all([
        sectionedPackage(['First.', 'Second.', 'Third.'],
          [[cover, before.footer], [middle], [before.header]], [cover, middle, before.header, before.footer]),
        sectionedPackage(['First.', 'Second.', 'Third.', 'Added last.'],
          [[cover, after.footer], [middle], [after.header], []], [cover, middle, after.header, after.footer]),
      ]);
    });
    const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    await then('the break is a paragraph-mark revision and nothing is listed', async () => {
      expect(result.unrepresentedChanges).toBeUndefined();
      expect(sectionBreakRevisions(await (await DocxArchive.load(result.document)).getDocumentXml())).toEqual({ added: 1, removed: 0 });
    });
    await expectRoundTrip({ then }, original, revised, result);
  });

  for (const direction of ['added', 'removed'] as const) {
    test(`pairs a leading footer through the unequal run when its content matches a footer the final sections already pair (break ${direction})`, async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('a first and a final section with boxed footers and one shared boxed header that changes; the leading footer gains a row and takes the content of the old final footer, and the final footer changes its legend', () => {
        const footer = (id: string, legend: string, rows: readonly string[]): PartSpec =>
          ({ id: `rId${id}`, kind: 'footer', target: `footer${id}.xml`, xml: storyXml('DrawingML', { ...BASE_STORY, legend, rows: [...rows] }) });
        const header = (legend: string): PartSpec =>
          ({ id: 'rIdH', kind: 'header', target: 'header1.xml', xml: storyXml('DrawingML', { ...BASE_STORY, legend }) });
        const two = sectionedPackage(['First.', 'Last.'],
          [[footer('1', 'Leading', [COMPANY]), header('Header draft')], [footer('2', 'Shared legend', [COMPANY, ADDRESS])]],
          [footer('1', 'Leading', [COMPANY]), footer('2', 'Shared legend', [COMPANY, ADDRESS]), header('Header draft')]);
        const three = sectionedPackage(['First.', 'Middle.', 'Last.'],
          [[footer('1', 'Shared legend', [COMPANY, ADDRESS]), header('Header final')], [], [footer('2', 'Final legend', [COMPANY, ADDRESS])]],
          [footer('1', 'Shared legend', [COMPANY, ADDRESS]), footer('2', 'Final legend', [COMPANY, ADDRESS]), header('Header final')]);
        return direction === 'added' ? Promise.all([two, three]) : Promise.all([three, two]);
      });
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await then('the break is a paragraph-mark revision and nothing is listed', async () => {
        expect(result.unrepresentedChanges).toBeUndefined();
        expect(sectionBreakRevisions(await (await DocxArchive.load(result.document)).getDocumentXml()))
          .toEqual(direction === 'added' ? { added: 1, removed: 0 } : { added: 0, removed: 1 });
      });
      await expectRoundTrip({ then }, original, revised, result);
    });

    test(`pairs unchanged boxed headers that change sections when a boxed footer shared by every section changes (break ${direction})`, async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('two sections with boxed headers A and B and one shared boxed footer; the revision shows B, B again (inherited) and A, and edits the footer', () => {
        const header = (id: string, legend: string): PartSpec =>
          ({ id: `rIdH${id}`, kind: 'header', target: `header${id}.xml`, xml: storyXml('DrawingML', { ...BASE_STORY, legend, boxText: `${legend} box` }) });
        const a = header('1', 'Header A');
        const b = header('2', 'Header B');
        const two = sectionedPackage(['First.', 'Last.'], [[LEADING, a], [b]], [LEADING, a, b]);
        const three = sectionedPackage(['First.', 'Middle.', 'Last.'], [[LEADING_EDITED, b], [], [a]], [LEADING_EDITED, a, b]);
        return direction === 'added' ? Promise.all([two, three]) : Promise.all([three, two]);
      });
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await then('the break is a paragraph-mark revision and nothing is listed', async () => {
        expect(result.unrepresentedChanges).toBeUndefined();
        expect(sectionBreakRevisions(await (await DocxArchive.load(result.document)).getDocumentXml()))
          .toEqual(direction === 'added' ? { added: 1, removed: 0 } : { added: 0, removed: 1 });
      });
      await expectRoundTrip({ then }, original, revised, result);
    });
  }

  test('tracks the edited first footer when a final section with a footer of its own is added', async ({ given, when, then }: AllureBddContext) => {
    const [original, revised] = await given('one section; the revision edits its footer and adds a final section that names a new boxed footer', () => Promise.all([
      sectionedPackage(['First.'], [[LEADING]], [LEADING]),
      sectionedPackage(['First.', 'Added last.'], [[LEADING_EDITED], [FINAL]], [LEADING_EDITED, FINAL]),
    ]));
    const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    await then('nothing is left unrepresented', () => {
      expect(result.unrepresentedChanges).toBeUndefined();
    });
    await expectRoundTrip({ then }, original, revised, result);
  });

  test('keeps an unchanged first footer paired with itself when the final section and its footer are removed', async ({ given, when, then }: AllureBddContext) => {
    const [original, revised] = await given('two sections with boxed footers of their own; the revision removes the final section and keeps the first footer unchanged', () => Promise.all([
      sectionedPackage(['First.', 'Last.'], [[LEADING], [FINAL]], [LEADING, FINAL]),
      sectionedPackage(['First.'], [[LEADING]], [LEADING]),
    ]));
    const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    // The final section's pages show the revised body-level references after
    // Reject All too (a w:sectPrChange snapshot cannot carry them), so the
    // removed final footer cannot be shown again and stays listed. The
    // unchanged first footer must not be paired with the removed one, which
    // would show the removed story on the first section's pages instead.
    await then('the removed final footer is listed and the first footer stays the original story', async () => {
      expect(result.unrepresentedChanges).toEqual([{ scope: 'footer', kind: 'removed', sectionIndex: 1, role: 'default' }]);
      const expectedAccepted = await shownPages(revised);
      expect(await shownPages(result.document, acceptAllChanges)).toEqual(expectedAccepted);
      expect(await shownPages(await appliedByDocxCore(result.document, 'accept'))).toEqual(expectedAccepted);
      const firstSection = (pages: string[]): string[] => pages.filter((page) => page.startsWith('0:'));
      const expectedFirst = firstSection(await shownPages(original));
      expect(firstSection(await shownPages(result.document, rejectAllChanges))).toEqual(expectedFirst);
      expect(firstSection(await shownPages(await appliedByDocxCore(result.document, 'reject')))).toEqual(expectedFirst);
      expect(await bodyText(result.document, rejectAllChanges)).toBe(await bodyText(original));
      expect(await liveSectionCount(result.document, rejectAllChanges)).toBe(await liveSectionCount(original));
    });
    await then('the compared package passes the emitted-document schema gate', () => assertSchema(result.document));
  });
});

/**
 * What an ODT export shows: the body text (`content.xml`) and the distinct
 * header and footer texts (LibreOffice keeps them in `styles.xml` master
 * pages, one per page style a section uses).
 */
async function odtView(odt: Buffer): Promise<{ body: string; header: string[]; footer: string[] }> {
  const zip = await JSZip.loadAsync(odt);
  const OFFICE_NS = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
  const STYLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
  const content = parseXml(await zip.file('content.xml')!.async('string'));
  const styles = parseXml(await zip.file('styles.xml')!.async('string'));
  const stories = (localName: string): string[] => [...new Set(
    Array.from(styles.getElementsByTagNameNS(STYLE_NS, localName)).map((story) => story.textContent ?? ''),
  )].sort();
  return {
    body: Array.from(content.getElementsByTagNameNS(OFFICE_NS, 'text')).map((body) => body.textContent ?? '').join(''),
    header: stories('header'),
    footer: stories('footer'),
  };
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice. LibreOffice does not resolve a section break tracked
// on paragraph marks (#1465), so only the text it shows is held here: the
// body and the header/footer stories.
const reader = process.env.SAFE_DOCX_SECTION_BREAK_TEXT_BOX_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice reads a footer text-box redline across a section break (#1487)', () => {
  for (const direction of ['added', 'removed'] as const) {
    test(`accepts to the revised footer and rejects to the original one when a section break is ${direction}`, async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const part = (story: Story): PartSpec =>
        ({ id: 'rIdStory', kind: 'footer', target: 'footer1.xml', xml: storyXml('DrawingML', story) });
      const before = part(BASE_STORY);
      const after = part({ ...BASE_STORY, legend: 'Legend final', boxText: 'Confidential draft' });
      const one = (spec: PartSpec, closing: string): Promise<Buffer> =>
        sectionedPackage(['Opening clause.', closing], [[spec]], [spec]);
      const two = (spec: PartSpec, closing: string): Promise<Buffer> =>
        sectionedPackage(['Opening clause.', closing], [[spec], [spec]], [spec]);
      const [original, revised] = direction === 'added'
        ? await Promise.all([one(before, 'Closing clause draft.'), two(after, 'Closing clause final.')])
        : await Promise.all([two(before, 'Closing clause draft.'), one(after, 'Closing clause final.')]);
      const { document } = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
      const packages: Buffer[] = [];
      await runLibreOfficeOracle(
        [
          { op: 'reject' as const, docx: original, saveAs: 'odt' as const },
          { op: 'accept' as const, docx: revised, saveAs: 'odt' as const },
          { op: 'accept' as const, docx: document, saveAs: 'odt' as const },
          { op: 'reject' as const, docx: document, saveAs: 'odt' as const },
        ],
        undefined,
        (index: number, bytes: Buffer) => { packages[index] = bytes; },
      );
      const [originalRejected, revisedAccepted, accepted, rejected] = await Promise.all(packages.map(odtView));
      if (process.env.SAFE_DOCX_READER_EVIDENCE) console.log('LO-EVIDENCE', direction, JSON.stringify({ originalRejected, revisedAccepted, accepted, rejected }));
      expect(originalRejected!.footer.join()).toContain('Legend draft');
      expect(revisedAccepted!.footer.join()).toContain('Legend final');
      expect(accepted!.body).toBe(revisedAccepted!.body);
      expect(rejected!.body).toBe(originalRejected!.body);
      expect(accepted!.footer).toEqual(revisedAccepted!.footer);
      if (direction === 'added') {
        expect(rejected!.footer).toEqual(originalRejected!.footer);
      } else {
        // Rejecting a removed break restores a section LibreOffice gives a
        // page style of its own (#1465); that copy of the footer repeats the
        // box text. Every footer it shows is still the original story, with
        // none of the revised text.
        for (const footer of rejected!.footer) {
          expect(footer.startsWith(originalRejected!.footer[0]!)).toBe(true);
          expect(footer).not.toContain('Legend final');
          expect(footer).not.toContain('Confidential draft');
        }
      }
    }, 600_000);
  }
});
