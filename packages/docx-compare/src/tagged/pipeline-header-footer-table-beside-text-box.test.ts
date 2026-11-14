/**
 * A header or footer that holds a text box is compared as two kinds of story:
 * the box's own content, and the part's ordinary content around it, which
 * carries the revised box on both sides so the box is compared exactly once.
 * A table row the part's table gains or loses beside the box is tracked with
 * whole-row revisions (`w:trPr/w:ins`, `w:trPr/w:del`), as in a part with no
 * box, while the box's own text is tracked inside the box.
 *
 * A cell added beside a cell-level content control in a table inside the box
 * has no native row replacement (the body table path refuses it too,
 * SDX-COMPTABLE-09). The box's story comparison must not publish it as a
 * `w:ins` wrapped around `w:tc`, which the schema forbids: the part is left
 * out of the redline whole, carried as the revised part, and listed.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @see https://github.com/UseJunior/safe-docx/issues/1469
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { DocxArchive, DocxDocument, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml, COMPLETE_PAGE_FIELD } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { compareDocumentsAtomizer, type TaggedCompareResult } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { UnsupportedTextBoxRevisionError } from './textBoxRevisionSafety.js';

const TEST_FEATURE = 'add-markdoc-header-footer-authoring';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.17' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.12' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
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
// Each case compares, applies twice per applier and runs the schema gate.
const LOAD_SENSITIVE_TIMEOUT_MS = 30_000;
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-14T00:00:00.000Z') };
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

type Kind = 'header' | 'footer';
type BoxFlavour = 'VML' | 'DrawingML';
const PART_PATH = (kind: Kind): string => `word/${kind}1.xml`;

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
const PHONE = row('Phone', '555 0100');
const PAGE_ROW = `<w:tr>${cell(text('Page'))}${cell(text('Page ') + COMPLETE_PAGE_FIELD)}</w:tr>`;
/** A row whose first cell sits in a cell-level content control. */
const controlRow = (...extraCells: string[]): string =>
  `<w:tr><w:sdt><w:sdtPr><w:alias w:val="Client"/></w:sdtPr><w:sdtContent>${cell(text('Client'))}</w:sdtContent></w:sdt>`
  + `${cell(text('Acme'))}${extraCells.map((value) => cell(text(value))).join('')}</w:tr>`;

/** A text box anchored in its own paragraph, holding `content` (block-level story content). */
function textBox(flavour: BoxFlavour, content: string, id = 1): string {
  if (flavour === 'VML') {
    return paragraph(
      `<w:r><w:pict><v:shape id="box${id}" o:spid="_x0000_s${1025 + id}" type="#_x0000_t202"` +
      ' style="position:absolute;margin-left:300pt;margin-top:0;width:150pt;height:50pt;z-index:1">' +
      `<v:textbox><w:txbxContent>${content}</w:txbxContent></v:textbox><w10:wrap type="square"/></v:shape></w:pict></w:r>`,
    );
  }
  return paragraph(
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0"' +
    ' relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>3810000</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="1905000" cy="635000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="Text Box 1"/><wp:cNvGraphicFramePr/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="635000"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>',
  );
}

/** One section whose default header or footer part holds `storyContent`. */
async function storyPackage(bodyText: string, kind: Kind, storyContent: string): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(paragraph(text(bodyText)), [], {
    namespaces: NAMESPACES,
    ignorablePrefixes: ['w14', 'wps'],
  }));
  archive.setDocumentXml((await archive.getDocumentXml())
    .replace('<w:sectPr/>', `<w:sectPr><w:${kind}Reference w:type="default" r:id="rIdStory"/></w:sectPr>`));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}"><Relationship Id="rIdStory" Type="${R_NS}/${kind}" Target="${kind}1.xml"/></Relationships>`,
  );
  const root = kind === 'header' ? 'w:hdr' : 'w:ftr';
  archive.setFile(
    PART_PATH(kind),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${root} xmlns:w="${W_NS}"${DECLARATIONS}` +
      ` mc:Ignorable="w14 wps">${storyContent}</${root}>`,
  );
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace(
    '</Types>',
    `<Override PartName="/${PART_PATH(kind)}"` +
      ` ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/></Types>`,
  ));
  return archive.save();
}

const isW = (node: Node | null, ...names: string[]): node is Element =>
  node !== null && node.nodeType === 1 && (node as Element).namespaceURI === W_NS
  && names.includes((node as Element).localName);
const elementChildren = (element: Element): Element[] =>
  Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1);

/** Whether `element` sits inside a text box below `stopAt`. */
function insideTextBox(element: Element, stopAt: Element): boolean {
  for (let node = element.parentNode; node && node !== stopAt; node = node.parentNode) {
    if (isW(node, 'txbxContent')) return true;
  }
  return false;
}

/** A paragraph's own text, leaving out the text of any box anchored in it. */
function paragraphText(p: Element): string {
  let value = '';
  for (const element of Array.from(p.getElementsByTagNameNS(W_NS, '*'))) {
    if (insideTextBox(element, p)) continue;
    if (element.localName === 't') value += element.textContent ?? '';
    else if (element.localName === 'instrText') value += `{${(element.textContent ?? '').trim()}}`;
  }
  return value;
}

/**
 * What a block-level story shows, block by block: a paragraph as its text, a
 * table as its rows and each row as its cells' paragraph texts, reaching
 * through a cell-level content control, so a lost, duplicated or misplaced
 * row or cell reads differently.
 */
function blocksView(container: Element): string[] {
  const cells = (tr: Element): Element[] => elementChildren(tr).flatMap((child) => {
    if (isW(child, 'tc')) return [child];
    if (isW(child, 'sdt')) {
      return elementChildren(child).filter((part) => isW(part, 'sdtContent'))
        .flatMap((content) => elementChildren(content).filter((part) => isW(part, 'tc')));
    }
    return [];
  });
  return elementChildren(container).flatMap((block) => {
    if (isW(block, 'p')) return [`p:${paragraphText(block)}`];
    if (isW(block, 'tbl')) {
      return ['tbl:' + elementChildren(block).filter((child) => isW(child, 'tr')).map((tr) =>
        cells(tr).map((tc) => elementChildren(tc).filter((part) => isW(part, 'p')).map(paragraphText).join('/')).join('|'),
      ).join(' ; ')];
    }
    return [];
  });
}

/** What a header/footer part shows: its own blocks, then each box's blocks (every stored copy). */
function partView(xml: string): { blocks: string[]; boxes: string[][] } {
  const root = parseXml(xml).documentElement;
  return {
    blocks: blocksView(root),
    boxes: Array.from(root.getElementsByTagNameNS(W_NS, 'txbxContent')).map(blocksView),
  };
}

type Projection = 'accept' | 'reject';

/** The part as docx-compare's applier or docx-core's shows it after a projection. */
async function projectedPart(
  buffer: Buffer,
  kind: Kind,
  projection: Projection | 'none',
  applier: 'ast' | 'core',
): Promise<ReturnType<typeof partView>> {
  let archive = await DocxArchive.load(buffer);
  if (applier === 'core' && projection !== 'none') {
    const document = await DocxDocument.load(buffer);
    if (projection === 'accept') await document.acceptChanges();
    else await document.rejectChanges();
    archive = await DocxArchive.load((await document.toBuffer()).buffer);
  }
  const xml = (await archive.getFile(PART_PATH(kind)))!;
  const project = projection === 'none' || applier === 'core'
    ? (value: string) => value
    : projection === 'accept' ? acceptAllChanges : rejectAllChanges;
  return partView(project(xml));
}

const bodyText = async (buffer: Buffer, project: (xml: string) => string = (xml) => xml): Promise<string> =>
  extractRoundTripComparisonText(project(await (await DocxArchive.load(buffer)).getDocumentXml()));

/**
 * The gate validates `word/document.xml`; the header/footer part's blocks
 * (CT_HdrFtr holds the same block-level content as a body) are validated as
 * a document body of their own.
 */
async function assertSchema(buffer: Buffer, kind: Kind): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1469-'));
  try {
    const paths = [join(directory, 'compared.docx'), join(directory, `${kind}.xml`)];
    await writeFile(paths[0]!, buffer);
    const xml = (await (await DocxArchive.load(buffer)).getFile(PART_PATH(kind)))!;
    await writeFile(paths[1]!, xml
      .replace(/<w:(hdr|ftr)(\s[^>]*)?>/u, (_match, _root, attributes = '') => `<w:document${attributes}><w:body>`)
      .replace(/<\/w:(hdr|ftr)>\s*$/u, '</w:body></w:document>'));
    const check = spawnSync(process.execPath, [schemaScript, ...paths], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** The part's whole-row revision markers, and any revision wrapper holding a row or cell. */
async function rowRevisions(buffer: Buffer, kind: Kind): Promise<{ inserted: number; deleted: number; wrappedCells: number }> {
  const document = parseXml((await (await DocxArchive.load(buffer)).getFile(PART_PATH(kind)))!);
  const markers = Array.from(document.getElementsByTagNameNS(W_NS, 'trPr')).flatMap(elementChildren);
  const wrappedCells = Array.from(document.getElementsByTagNameNS(W_NS, '*'))
    .filter((element) => isW(element, 'ins', 'del', 'moveFrom', 'moveTo'))
    .filter((wrapper) => elementChildren(wrapper).some((child) => isW(child, 'tr', 'tc'))).length;
  return {
    inserted: markers.filter((marker) => isW(marker, 'ins')).length,
    deleted: markers.filter((marker) => isW(marker, 'del')).length,
    wrappedCells,
  };
}

/** Revision wrappers on run content inside the part's text boxes. */
async function boxRunRevisions(buffer: Buffer, kind: Kind): Promise<number> {
  const document = parseXml((await (await DocxArchive.load(buffer)).getFile(PART_PATH(kind)))!);
  return Array.from(document.getElementsByTagNameNS(W_NS, 'txbxContent'))
    .flatMap((box) => Array.from(box.getElementsByTagNameNS(W_NS, '*')))
    .filter((element) => isW(element, 'ins', 'del') && !isW(element.parentNode, 'rPr', 'trPr')).length;
}

async function expectProjections(
  { then }: Pick<AllureBddContext, 'then'>,
  kind: Kind,
  original: Buffer,
  revised: Buffer,
  result: TaggedCompareResult,
): Promise<void> {
  await then(`the ${kind} shows the revised table and box after Accept All and the original after Reject All, with both appliers`, async () => {
    const expectedAccepted = await projectedPart(revised, kind, 'none', 'ast');
    const expectedRejected = await projectedPart(original, kind, 'none', 'ast');
    expect(expectedAccepted).not.toEqual(expectedRejected);
    for (const applier of ['ast', 'core'] as const) {
      expect(await projectedPart(result.document, kind, 'accept', applier), applier).toEqual(expectedAccepted);
      expect(await projectedPart(result.document, kind, 'reject', applier), applier).toEqual(expectedRejected);
    }
  });
  await then('body text round-trips', async () => {
    expect(await bodyText(result.document, acceptAllChanges)).toBe(await bodyText(revised));
    expect(await bodyText(result.document, rejectAllChanges)).toBe(await bodyText(original));
  });
  await then('the compared package passes the emitted-document schema gate', () => assertSchema(result.document, kind));
}

interface BesideBoxCase {
  readonly name: string;
  readonly original: { rows: readonly string[]; box: string };
  readonly revised: { rows: readonly string[]; box: string };
  readonly markers: { inserted: number; deleted: number };
}

const BESIDE_BOX_CASES: readonly BesideBoxCase[] = [
  {
    name: 'a row inserted beside a box whose text changes',
    original: { rows: [COMPANY, ADDRESS], box: 'Draft for review' },
    revised: { rows: [COMPANY, PHONE, ADDRESS], box: 'Final for signature' },
    markers: { inserted: 1, deleted: 0 },
  },
  {
    name: 'a row deleted beside a box whose text changes',
    original: { rows: [COMPANY, ADDRESS, PHONE], box: 'Draft for review' },
    revised: { rows: [COMPANY, PHONE], box: 'Final for signature' },
    markers: { inserted: 0, deleted: 1 },
  },
  {
    name: 'a row inserted beside an unchanged box',
    original: { rows: [COMPANY], box: 'Confidential' },
    revised: { rows: [COMPANY, ADDRESS], box: 'Confidential' },
    markers: { inserted: 1, deleted: 0 },
  },
  {
    name: 'a row holding a PAGE field inserted beside a box whose text changes',
    original: { rows: [COMPANY], box: 'Draft for review' },
    revised: { rows: [COMPANY, PAGE_ROW], box: 'Final for signature' },
    markers: { inserted: 1, deleted: 0 },
  },
];

const besideBoxStory = (flavour: BoxFlavour, side: BesideBoxCase['original']): string =>
  table(...side.rows) + textBox(flavour, paragraph(text(side.box)));

describe('a header or footer table row inserted or deleted beside a text box (#1469)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  for (const kind of ['header', 'footer'] as const) {
    for (const flavour of ['VML', 'DrawingML'] as const) {
      for (const besideCase of BESIDE_BOX_CASES) {
        test.openspec('[SDX-CMP-STORY-07] Header and footer table rows are tracked as whole-row revisions')(
          `tracks ${besideCase.name} in a ${kind} with a ${flavour} text box`,
          async ({ given, when, then }: AllureBddContext) => {
            const [original, revised] = await given(`a default ${kind} table beside a ${flavour} text box; the revision has ${besideCase.name}, beside a body edit`, () =>
              Promise.all([
                storyPackage('Body draft', kind, besideBoxStory(flavour, besideCase.original)),
                storyPackage('Body final', kind, besideBoxStory(flavour, besideCase.revised)),
              ]));
            const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
            await then(`nothing is left unrepresented and the ${kind} carries the whole-row markers, none around a cell`, async () => {
              expect(result.unrepresentedChanges).toBeUndefined();
              expect(await rowRevisions(result.document, kind)).toEqual({ ...besideCase.markers, wrappedCells: 0 });
            });
            await then('a changed box text is tracked inside the box', async () => {
              const changed = besideCase.original.box !== besideCase.revised.box;
              expect((await boxRunRevisions(result.document, kind)) > 0).toBe(changed);
            });
            await expectProjections({ then }, kind, original, revised, result);
          },
        );
      }
    }
  }
});

/**
 * A part compared whole around a text box it gains or loses (#1384) holds its
 * table rows to the same whole-row revisions.
 */
describe('a header or footer table row inserted beside a text box the part gains or loses (#1469)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  for (const kind of ['header', 'footer'] as const) {
    for (const lifecycle of ['gains', 'loses'] as const) {
      test.openspec('[SDX-CMP-STORY-07] Header and footer table rows are tracked as whole-row revisions')(
        `tracks a row inserted beside a kept text box in a ${kind} that ${lifecycle} another DrawingML text box`,
        async ({ given, when, then }: AllureBddContext) => {
          // A kept box stays in the part, so the part's own scaffold still holds a text box.
          const kept = textBox('DrawingML', paragraph(text('Confidential')));
          const added = textBox('DrawingML', paragraph(text('Draft')), 2);
          const [withoutBox, withBox] = [table(COMPANY) + kept, table(COMPANY) + kept + added];
          const [original, revised] = await given(`a default ${kind} table beside a kept text box that gains a row while the ${kind} ${lifecycle} another text box, beside a body edit`, () =>
            Promise.all([
              storyPackage('Body draft', kind, lifecycle === 'gains' ? withoutBox : withBox),
              storyPackage('Body final', kind, (lifecycle === 'gains' ? withBox : withoutBox)
                .replace(COMPANY, COMPANY + ADDRESS)),
            ]));
          const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
          await then(`nothing is left unrepresented and the ${kind} carries one inserted-row marker`, async () => {
            expect(result.unrepresentedChanges).toBeUndefined();
            expect(await rowRevisions(result.document, kind)).toEqual({ inserted: 1, deleted: 0, wrappedCells: 0 });
          });
          await expectProjections({ then }, kind, original, revised, result);
        },
      );
    }
  }
});

describe('a cell added beside a cell-level content control in a header or footer text box (#1469)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  for (const kind of ['header', 'footer'] as const) {
    for (const flavour of ['VML', 'DrawingML'] as const) {
      for (const besideOrdinaryEdit of [false, true]) {
        const name = besideOrdinaryEdit ? ' beside an edit to the part\'s own text' : '';
        test.openspec('[SDX-CMP-STORY-05] Unsupported topology remains unrepresented')(
          `lists the ${kind} instead of wrapping a cell in w:ins, in a ${flavour} text box${name}`,
          async ({ given, when, then }: AllureBddContext) => {
            const part = (cells: string[], ownText: string): string =>
              paragraph(text(ownText)) + textBox(flavour, table(controlRow(...cells)) + paragraph(text('Box')));
            const [original, revised] = await given(`a ${flavour} text box table whose row gains a cell beside a cell-level content control, beside a body edit`, () =>
              Promise.all([
                storyPackage('Body draft', kind, part([], 'Draft')),
                storyPackage('Body final', kind, part(['Corp'], besideOrdinaryEdit ? 'Final' : 'Draft')),
              ]));
            const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
            await then(`the default ${kind} is listed once and carried as the revised part, with no revision around a cell`, async () => {
              expect(result.unrepresentedChanges).toEqual([
                { scope: kind, kind: 'changed', sectionIndex: 0, role: 'default' },
              ]);
              expect(await rowRevisions(result.document, kind)).toEqual({ inserted: 0, deleted: 0, wrappedCells: 0 });
              for (const applier of ['ast', 'core'] as const) {
                for (const projection of ['accept', 'reject'] as const) {
                  expect(await projectedPart(result.document, kind, projection, applier), `${projection} ${applier}`)
                    .toEqual(await projectedPart(revised, kind, 'none', 'ast'));
                }
              }
            });
            await then('the body edit is tracked', async () => {
              expect(await bodyText(result.document, acceptAllChanges)).toBe(await bodyText(revised));
              expect(await bodyText(result.document, rejectAllChanges)).toBe(await bodyText(original));
            });
            await then('the compared package passes the emitted-document schema gate', () => assertSchema(result.document, kind));
          },
        );
      }
    }
  }
});

/**
 * A body text box has no part to leave out: the same change is refused with a
 * typed error, as the body table path refuses it (SDX-COMPTABLE-09), instead
 * of publishing a cell wrapped in `w:ins`.
 */
describe('a cell added beside a cell-level content control in a body text box (#1469)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  test.openspec('[SDX-CMP-STORY-05] Unsupported topology remains unrepresented')(
    'refuses with a typed error instead of wrapping a cell in w:ins',
    async ({ given, when, then }: AllureBddContext) => {
      const body = (cells: string[]): string =>
        paragraph(text('Body')) + textBox('DrawingML', table(controlRow(...cells)) + paragraph(text('Box')));
      const [original, revised] = await given('a body text box table whose row gains a cell beside a cell-level content control', () =>
        Promise.all([
          buildDocxFromBodyXml(body([]), [], { namespaces: NAMESPACES, ignorablePrefixes: ['w14', 'wps'] }),
          buildDocxFromBodyXml(body(['Corp']), [], { namespaces: NAMESPACES, ignorablePrefixes: ['w14', 'wps'] }),
        ]));
      const comparison = await when('the pair is compared', () =>
        compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS).then(
          () => undefined,
          (error: unknown) => error,
        ));
      await then('the comparison is refused with a typed text-box error', () => {
        expect(comparison).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      });
    },
  );
});

/**
 * The default header and footer of an ODT export (LibreOffice keeps them in
 * `styles.xml` master pages) as their table rows' text and their text
 * frames' text, in document order.
 */
async function odtStoryView(odt: Buffer): Promise<Record<string, { rows: string[]; frames: string[] }>> {
  const zip = await JSZip.loadAsync(odt);
  const styles = parseXml(await zip.file('styles.xml')!.async('string'));
  const STYLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
  const TABLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const DRAW_NS = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
  const stories: Record<string, { rows: string[]; frames: string[] }> = {};
  for (const localName of ['header', 'footer']) {
    const story = styles.getElementsByTagNameNS(STYLE_NS, localName)[0];
    stories[localName] = {
      rows: story
        ? Array.from(story.getElementsByTagNameNS(TABLE_NS, 'table-row')).map((tableRow) => tableRow.textContent ?? '')
        : [],
      frames: story
        ? Array.from(story.getElementsByTagNameNS(DRAW_NS, 'text-box')).map((box) => box.textContent ?? '')
        : [],
    };
  }
  return stories;
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice.
const reader = process.env.SAFE_DOCX_HEADER_FOOTER_TABLE_ROWS_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice accepts and rejects a header or footer table row beside a text box as compared (#1469)', () => {
  for (const [kind, besideCase] of [['header', BESIDE_BOX_CASES[0]!], ['footer', BESIDE_BOX_CASES[1]!]] as const) {
    test(`shows the revised rows and box after Accept All and the original after Reject All for ${besideCase.name} in a ${kind}`, async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const original = await storyPackage('Body draft', kind, besideBoxStory('DrawingML', besideCase.original));
      const revised = await storyPackage('Body final', kind, besideBoxStory('DrawingML', besideCase.revised));
      const { document } = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
      const packages: Buffer[] = [];
      await runLibreOfficeOracle(
        [
          { op: 'identity' as const, docx: original, saveAs: 'odt' as const },
          { op: 'identity' as const, docx: revised, saveAs: 'odt' as const },
          { op: 'accept' as const, docx: document, saveAs: 'odt' as const },
          { op: 'reject' as const, docx: document, saveAs: 'odt' as const },
        ],
        undefined,
        (index: number, bytes: Buffer) => { packages[index] = bytes; },
      );
      const [originalView, revisedView, accepted, rejected] = await Promise.all(packages.map(odtStoryView));
      expect(originalView![kind]!.rows).toHaveLength(besideCase.original.rows.length);
      expect(revisedView![kind]!.rows).toHaveLength(besideCase.revised.rows.length);
      expect(originalView![kind]!.frames).toEqual([besideCase.original.box]);
      expect(revisedView![kind]!.frames).toEqual([besideCase.revised.box]);
      expect(accepted).toEqual(revisedView);
      expect(rejected).toEqual(originalView);
    }, 600_000);
  }
});
