/**
 * A header or footer that gains or loses a text box. The box is tracked
 * whole in its header/footer part: its anchor run sits in a `w:ins` (or a
 * `w:del`), and every paragraph of its story carries the same mark, the way
 * the body tracks an inserted or deleted box (#1031). Accept All shows the
 * revised part and Reject All the original part.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.4
 * @see https://github.com/UseJunior/safe-docx/issues/1384
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
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { UnsupportedTextBoxRevisionError } from './textBoxRevisionSafety.js';

const TEST_FEATURE = 'Header/Footer Text-Box Lifecycle';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 4, section: '14.9.1.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.3' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.4' },
  );

const W_NS = OOXML.W_NS;
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
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
} as const;
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-12T00:00:00.000Z') };
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);
// Multi-story round trips: well inside 5s alone, slower under a parallel suite.
const LOAD_SENSITIVE_TIMEOUT_MS = 30_000;

/** A story line: plain text, or `{ link }` for a hyperlink through relationship `rIdLink`. */
type Line = string | { link: string };

const story = (lines: readonly Line[]): string =>
  `<w:txbxContent>` +
  lines.map((line, index) =>
    `<w:p w14:paraId="2000000${index + 1}" w14:textId="2000000${index + 1}">` +
    (typeof line === 'string'
      ? `<w:r><w:t xml:space="preserve">${line}</w:t></w:r>`
      : `<w:hyperlink r:id="rIdLink"><w:r><w:t xml:space="preserve">${line.link}</w:t></w:r></w:hyperlink>`) +
    `</w:p>`).join('') +
  `</w:txbxContent>`;

/** A VML text box (a `w:pict`). */
function vmlBox(lines: readonly Line[], shapeId = 'box1'): string {
  return (
    `<w:r><w:pict><v:shape id="${shapeId}" o:spid="_x0000_s1026" type="#_x0000_t202"` +
    ` style="position:absolute;margin-left:10pt;margin-top:0;width:200pt;height:50pt;z-index:1">` +
    `<v:textbox>${story(lines)}</v:textbox><w10:wrap type="square"/></v:shape></w:pict></w:r>`
  );
}

/** A DrawingML text box with no VML fallback (a `w:drawing`). */
function drawingMlBox(lines: readonly Line[], name = 'Text Box 1'): string {
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0"` +
    ` relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="column"><wp:posOffset>127000</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="2540000" cy="635000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="${name}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2540000" cy="635000"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>` +
    `<wps:txbx>${story(lines)}</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>` +
    `</wp:anchor></w:drawing></w:r>`
  );
}

/** Word's own text box: DrawingML in `mc:Choice`, the same box in VML in `mc:Fallback`. */
function twinnedBox(lines: readonly Line[]): string {
  const inner = (run: string): string => run.slice('<w:r>'.length, -'</w:r>'.length);
  return (
    `<w:r><mc:AlternateContent><mc:Choice Requires="wps">${inner(drawingMlBox(lines))}</mc:Choice>` +
    `<mc:Fallback>${inner(vmlBox(lines))}</mc:Fallback></mc:AlternateContent></w:r>`
  );
}

const textRun = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (text: string): string => `<w:p>${textRun(text)}</w:p>`;

type Kind = 'header' | 'footer';
type Role = 'default' | 'first' | 'even';

interface StoryPart {
  kind: Kind;
  role: Role;
  /** The part's body: its paragraphs. */
  content: string;
  /** The external target of the part's `rIdLink` hyperlink relationship. */
  link?: string;
}

const partTarget = ({ kind, role }: Pick<StoryPart, 'kind' | 'role'>): string => `${kind}-${role}.xml`;
const partPath = (slot: Pick<StoryPart, 'kind' | 'role'>): string => `word/${partTarget(slot)}`;
const declarations = Object.entries(NAMESPACES).map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`).join('');

function storyPartXml({ kind, content }: StoryPart): string {
  const root = kind === 'header' ? 'hdr' : 'ftr';
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:${root} xmlns:w="${W_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"` +
    ` xmlns:mc="${MC_NS}"${declarations} mc:Ignorable="w14 wps">${content}</w:${root}>`
  );
}

/**
 * One section whose header/footer parts are `parts`; a first-page part turns
 * on `w:titlePg`, an even-page part turns on `w:evenAndOddHeaders`.
 */
async function storyPackage(parts: readonly StoryPart[], bodyText: string): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(paragraph(bodyText), [], {
    namespaces: NAMESPACES,
    ignorablePrefixes: ['wps'],
  }));
  const references = parts.map((part, index) =>
    `<w:${part.kind}Reference w:type="${part.role}" r:id="rIdStory${index}"/>`).join('');
  const titlePage = parts.some((part) => part.role === 'first') ? '<w:titlePg/>' : '';
  archive.setDocumentXml((await archive.getDocumentXml()).replace(
    '<w:sectPr/>',
    `<w:sectPr>${references}${titlePage}</w:sectPr>`,
  ));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      parts.map((part, index) =>
        `<Relationship Id="rIdStory${index}" Type="${R_NS}/${part.kind}" Target="${partTarget(part)}"/>`).join('') +
      `<Relationship Id="rIdSettings" Type="${R_NS}/settings" Target="settings.xml"/></Relationships>`,
  );
  for (const part of parts) {
    archive.setFile(partPath(part), storyPartXml(part));
    if (part.link) {
      archive.setFile(
        `word/_rels/${partTarget(part)}.rels`,
        `<Relationships xmlns="${PKG_NS}"><Relationship Id="rIdLink" Type="${R_NS}/hyperlink"` +
          ` Target="${part.link}" TargetMode="External"/></Relationships>`,
      );
    }
  }
  const evenAndOdd = parts.some((part) => part.role === 'even') ? '<w:evenAndOddHeaders/>' : '';
  archive.setFile(
    'word/settings.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:settings xmlns:w="${W_NS}">${evenAndOdd}</w:settings>`,
  );
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>', parts.map((part) =>
    `<Override PartName="/${partPath(part)}"` +
    ` ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${part.kind}+xml"/>`,
  ).join('') +
    '<Override PartName="/word/settings.xml"' +
    ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'));
  return archive.save();
}

async function partXml(buffer: Buffer, path: string): Promise<string> {
  return (await (await DocxArchive.load(buffer)).getFile(path))!;
}

function ancestor(element: Element, namespace: string, names: readonly string[]): Element | undefined {
  for (let node = element.parentNode; node?.nodeType === 1; node = node.parentNode) {
    const candidate = node as Element;
    if (candidate.namespaceURI === namespace && names.includes(candidate.localName)) return candidate;
  }
  return undefined;
}

const textOf = (root: Element): string =>
  Array.from(root.getElementsByTagNameNS(W_NS, 't')).map((text) => text.textContent ?? '').join('');

/**
 * What a reader sees in a part: the text outside boxes, paragraph by
 * paragraph, and the text of each visual box (every stored copy of a box
 * reading the same).
 */
interface ReaderView {
  paragraphs: string[];
  boxes: string[];
}

function readerView(xml: string): ReaderView {
  const document = parseXml(xml);
  const paragraphs = Array.from(document.getElementsByTagNameNS(W_NS, 'p'))
    .filter((element) => !ancestor(element, W_NS, ['txbxContent']))
    .map((element) => Array.from(element.getElementsByTagNameNS(W_NS, 't'))
      .filter((text) => !ancestor(text, W_NS, ['txbxContent']))
      .map((text) => text.textContent ?? '').join(''));
  const roots = new Map<Element, Element[]>();
  for (const copy of Array.from(document.getElementsByTagNameNS(W_NS, 'txbxContent'))) {
    const root = ancestor(copy, MC_NS, ['AlternateContent']) ?? ancestor(copy, W_NS, ['drawing', 'pict'])!;
    roots.set(root, [...(roots.get(root) ?? []), copy]);
  }
  const boxes = [...roots.values()].map((copies) => {
    const texts = [...new Set(copies.map(textOf))];
    expect(texts, 'every stored copy of one box reads the same').toHaveLength(1);
    return texts[0]!;
  });
  return { paragraphs, boxes };
}

/**
 * How each box is tracked: the revision wrapper around its drawing (`ins`,
 * `del` or none) and, for each paragraph of its story, the mark on that
 * paragraph's mark run properties (`ins`, `del` or none) and the wrappers of
 * its runs.
 */
interface TrackedBox {
  anchor: string;
  paragraphs: Array<{ mark: string; runs: string[] }>;
}

function wrapperOf(element: Element, stopAt: Element): string {
  for (let node = element.parentNode; node && node !== stopAt; node = node.parentNode) {
    const candidate = node as Element;
    if (candidate.nodeType === 1 && candidate.namespaceURI === W_NS && ['ins', 'del'].includes(candidate.localName)) {
      return candidate.localName;
    }
  }
  return 'none';
}

function trackedBoxes(xml: string): TrackedBox[] {
  const document = parseXml(xml);
  return Array.from(document.getElementsByTagNameNS(W_NS, 'txbxContent')).map((box) => {
    const run = ancestor(box, W_NS, ['r'])!;
    const paragraphs = Array.from(box.getElementsByTagNameNS(W_NS, 'p')).map((paragraphElement) => {
      const markProperties = Array.from(paragraphElement.getElementsByTagNameNS(W_NS, 'rPr'))
        .find((properties) => (properties.parentNode as Element).localName === 'pPr');
      const mark = markProperties
        ? Array.from(markProperties.childNodes)
          .filter((node): node is Element => node.nodeType === 1)
          .find((node) => node.namespaceURI === W_NS && ['ins', 'del'].includes(node.localName))?.localName ?? 'none'
        : 'none';
      const runs = Array.from(paragraphElement.getElementsByTagNameNS(W_NS, 'r'))
        .map((runElement) => wrapperOf(runElement, paragraphElement));
      return { mark, runs };
    });
    return { anchor: wrapperOf(run, document.documentElement), paragraphs };
  });
}

async function docxCorePart(buffer: Buffer, mode: 'accept' | 'reject', path: string): Promise<string> {
  const document = await DocxDocument.load(buffer);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return partXml((await document.toBuffer()).buffer, path);
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1384-'));
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
 * Accept All is the revised part and Reject All the original part, through
 * the comparison acceptor and docx-core; the body's ordinary edit projects the
 * same way; the output passes the emitted-document schema gate.
 */
async function assertProjections(
  original: Buffer,
  revised: Buffer,
  compared: Buffer,
  paths: readonly string[],
): Promise<void> {
  for (const path of [...paths, 'word/document.xml']) {
    const originalView = readerView(await partXml(original, path));
    const revisedView = readerView(await partXml(revised, path));
    const output = await partXml(compared, path);
    expect(readerView(acceptAllChanges(output)), `${path} accept (comparison acceptor)`).toEqual(revisedView);
    expect(readerView(rejectAllChanges(output)), `${path} reject (comparison acceptor)`).toEqual(originalView);
    expect(readerView(await docxCorePart(compared, 'accept', path)), `${path} accept (docx-core)`).toEqual(revisedView);
    expect(readerView(await docxCorePart(compared, 'reject', path)), `${path} reject (docx-core)`).toEqual(originalView);
  }
  await assertSchema(compared);
}

const ORIGINAL_BODY = 'The parties agree as follows.';
const REVISED_BODY = 'The parties hereby agree as follows.';
const BOX = ['Draft - confidential', 'Do not circulate'] as const;

const insertedMarks: TrackedBox = {
  anchor: 'ins',
  paragraphs: BOX.map(() => ({ mark: 'ins', runs: ['ins'] })),
};
const deletedMarks: TrackedBox = {
  anchor: 'del',
  paragraphs: BOX.map(() => ({ mark: 'del', runs: ['del'] })),
};

const SLOTS: ReadonlyArray<Pick<StoryPart, 'kind' | 'role'>> = [
  { kind: 'footer', role: 'default' },
  { kind: 'header', role: 'default' },
  { kind: 'header', role: 'first' },
  { kind: 'footer', role: 'first' },
  { kind: 'header', role: 'even' },
  { kind: 'footer', role: 'even' },
];

/** The default part every package keeps alongside a first or even slot. */
function companions(slot: Pick<StoryPart, 'kind' | 'role'>): StoryPart[] {
  return slot.role === 'default' ? [] : [{ kind: slot.kind, role: 'default', content: paragraph(`Default ${slot.kind}`) }];
}

describe('a header or footer that gains or loses a text box (#1384)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  for (const slot of SLOTS) {
    const label = `${slot.role} ${slot.kind}`;
    const text = `Page ${slot.kind}`;
    const withoutBox: StoryPart = { ...slot, content: paragraph(text) };
    const withBox: StoryPart = { ...slot, content: `<w:p>${vmlBox(BOX)}${textRun(text)}</w:p>` };

    test(`tracks a text box inserted into the ${label} as an insertion`, async ({
      given, when, then, and,
    }: AllureBddContext) => {
      const original = await given(`a ${label} reading ${text}`, () =>
        storyPackage([...companions(slot), withoutBox], ORIGINAL_BODY));
      const revised = await given('the same part with a VML text box added, and a body edit', () =>
        storyPackage([...companions(slot), withBox], REVISED_BODY));
      const result = await when('the documents are compared', () =>
        compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      const output = await partXml(result.document, partPath(slot));

      await then('the anchor run and every paragraph of the box are tracked as inserted', () => {
        expect(trackedBoxes(output)).toEqual([insertedMarks]);
        expect(result.unrepresentedChanges).toBeUndefined();
      });
      await and('Accept All is the revised document and Reject All the original', () =>
        assertProjections(original, revised, result.document, [partPath(slot)]));
    });

    test(`tracks a text box deleted from the ${label} as a deletion`, async ({
      given, when, then, and,
    }: AllureBddContext) => {
      const original = await given(`a ${label} holding a VML text box`, () =>
        storyPackage([...companions(slot), withBox], ORIGINAL_BODY));
      const revised = await given('the same part with the box removed, and a body edit', () =>
        storyPackage([...companions(slot), withoutBox], REVISED_BODY));
      const result = await when('the documents are compared', () =>
        compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      const output = await partXml(result.document, partPath(slot));

      await then('the anchor run and every paragraph of the box are tracked as deleted', () => {
        expect(trackedBoxes(output)).toEqual([deletedMarks]);
        expect(result.unrepresentedChanges).toBeUndefined();
      });
      await and('Accept All is the revised document and Reject All the original', () =>
        assertProjections(original, revised, result.document, [partPath(slot)]));
    });
  }

  test('tracks a twinned box inserted into the default footer and a box deleted from the first-page header in one comparison', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const footer = { kind: 'footer', role: 'default' } as const;
    const header = { kind: 'header', role: 'first' } as const;
    const original = await given('a plain default footer and a first-page header holding a box', () => storyPackage([
      { ...footer, content: paragraph('Page footer') },
      { kind: 'header', role: 'default', content: paragraph('Default header') },
      { ...header, content: `<w:p>${drawingMlBox(BOX)}${textRun('Cover')}</w:p>` },
    ], ORIGINAL_BODY));
    const revised = await given('the footer gains a twinned box, the header loses its box, and the body is edited', () => storyPackage([
      { ...footer, content: `${paragraph('Page footer')}<w:p>${twinnedBox(BOX)}</w:p>` },
      { kind: 'header', role: 'default', content: paragraph('Default header') },
      { ...header, content: paragraph('Cover') },
    ], REVISED_BODY));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('both stored copies of the footer box are inserted and the header box is deleted', async () => {
      expect(trackedBoxes(await partXml(result.document, partPath(footer)))).toEqual([insertedMarks, insertedMarks]);
      expect(trackedBoxes(await partXml(result.document, partPath(header)))).toEqual([deletedMarks]);
      expect(result.unrepresentedChanges).toBeUndefined();
    });
    await and('Accept All is the revised document and Reject All the original', () =>
      assertProjections(original, revised, result.document, [partPath(footer), partPath(header)]));
  });

  for (const direction of ['inserted', 'deleted'] as const) {
    test(`tracks a box ${direction} beside a footer box whose text changed, and the footer text edit`, async ({
      given, when, then, and,
    }: AllureBddContext) => {
      const slot = { kind: 'footer', role: 'default' } as const;
      const kept = (text: string): string => vmlBox([`Notice to: ${text}`], 'kept');
      const lifecycleBox = vmlBox(BOX, 'added');
      const withLifecycle = (text: string, footerText: string): StoryPart => ({
        ...slot,
        content: `<w:p>${kept(text)}${textRun(footerText)}</w:p><w:p>${lifecycleBox}</w:p>`,
      });
      const withoutLifecycle = (text: string, footerText: string): StoryPart => ({
        ...slot,
        content: `<w:p>${kept(text)}${textRun(footerText)}</w:p>`,
      });
      const original = await given('a footer with a box', () => storyPackage([
        direction === 'inserted' ? withoutLifecycle('Old address', 'Page footer') : withLifecycle('Old address', 'Page footer'),
      ], ORIGINAL_BODY));
      const revised = await given(`the box edited, the footer text edited, and a second box ${direction}`, () => storyPackage([
        direction === 'inserted' ? withLifecycle('New address', 'Revised footer') : withoutLifecycle('New address', 'Revised footer'),
      ], REVISED_BODY));
      const result = await when('the documents are compared', () =>
        compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      const output = await partXml(result.document, partPath(slot));

      await then('the edited box carries its edit inside, and the other box its lifecycle', () => {
        const boxes = trackedBoxes(output);
        expect(boxes).toHaveLength(2);
        expect(boxes[0]!.anchor).toBe('none');
        expect(boxes[1]).toEqual(direction === 'inserted' ? insertedMarks : deletedMarks);
        const keptBox = parseXml(output).getElementsByTagNameNS(W_NS, 'txbxContent').item(0)!;
        expect(Array.from(keptBox.getElementsByTagNameNS(W_NS, 'delText')).map((text) => text.textContent).join(''))
          .toBe('Old');
        expect(result.unrepresentedChanges).toBeUndefined();
      });
      await and('Accept All is the revised document and Reject All the original', () =>
        assertProjections(original, revised, result.document, [partPath(slot)]));
    });
  }

  for (const direction of ['inserted', 'deleted'] as const) {
    test(`keeps the hyperlink of a ${direction} footer box resolvable in both projections`, async ({
      given, when, then,
    }: AllureBddContext) => {
      const slot = { kind: 'footer', role: 'default' } as const;
      const link = 'https://example.com/notices';
      const withBox: StoryPart = {
        ...slot,
        content: `<w:p>${vmlBox(['Notices', { link: 'example.com/notices' }])}${textRun('Page footer')}</w:p>`,
        link,
      };
      const withoutBox: StoryPart = { ...slot, content: paragraph('Page footer') };
      const original = await given('a footer', () =>
        storyPackage([direction === 'inserted' ? withoutBox : withBox], ORIGINAL_BODY));
      const revised = await given(`the footer with a linked box ${direction}`, () =>
        storyPackage([direction === 'inserted' ? withBox : withoutBox], REVISED_BODY));
      const result = await when('the documents are compared', () =>
        compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

      await then('the projection that shows the box resolves its link through the footer relationships', async () => {
        const shown = direction === 'inserted' ? 'accept' : 'reject';
        const document = await DocxDocument.load(result.document);
        if (shown === 'accept') await document.acceptChanges();
        else await document.rejectChanges();
        const archive = await DocxArchive.load((await document.toBuffer()).buffer);
        const footerXml = (await archive.getFile(partPath(slot)))!;
        const relationships = parseXml((await archive.getFile(`word/_rels/${partTarget(slot)}.rels`))!);
        const targets = new Map(Array.from(relationships.getElementsByTagNameNS(PKG_NS, 'Relationship'))
          .map((relationship) => [relationship.getAttribute('Id'), relationship.getAttribute('Target')]));
        const hyperlinks = Array.from(parseXml(footerXml).getElementsByTagNameNS(W_NS, 'hyperlink'));
        expect(hyperlinks.map((hyperlink) => targets.get(hyperlink.getAttributeNS(R_NS, 'id')))).toEqual([link]);
        await assertProjections(original, revised, result.document, [partPath(slot)]);
      });
    });
  }

  test('refuses a footer box inserted with a footnote reference in its story, naming the box', async ({
    given, when, then,
  }: AllureBddContext) => {
    const slot = { kind: 'footer', role: 'default' } as const;
    const original = await given('a plain footer', () =>
      storyPackage([{ ...slot, content: paragraph('Page footer') }], ORIGINAL_BODY));
    const noteBox = vmlBox(['See note']).replace(
      '<w:t xml:space="preserve">See note</w:t></w:r>',
      '<w:t xml:space="preserve">See note</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r>',
    );
    const revised = await given('the footer with a box whose story cites a footnote', () =>
      storyPackage([{ ...slot, content: `<w:p>${noteBox}${textRun('Page footer')}</w:p>` }], ORIGINAL_BODY));
    const failure = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS).then(() => undefined, (error: unknown) => error));

    await then('the comparison names the inserted box and why', () => {
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect((failure as UnsupportedTextBoxRevisionError).changes).toEqual([
        expect.objectContaining({
          index: 0,
          partPath: partPath(slot),
          reason: 'inserted ancillary text box: nested w:footnoteReference is not supported in this story slice',
        }),
      ]);
    });
  });
});

/** The text of each LibreOffice text frame holding the box, in an ODT export (header/footer frames live in styles.xml). */
async function odtBoxTexts(odt: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(odt);
  const DRAW_NS = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
  const texts: string[] = [];
  for (const file of ['content.xml', 'styles.xml']) {
    const xml = await zip.file(file)?.async('string');
    if (!xml) continue;
    const document = parseXml(xml);
    for (const frame of [
      ...Array.from(document.getElementsByTagNameNS(DRAW_NS, 'frame')),
      ...Array.from(document.getElementsByTagNameNS(DRAW_NS, 'custom-shape')),
    ]) {
      const text = frame.textContent ?? '';
      if (text.includes(BOX[0])) texts.push(text);
    }
  }
  return texts;
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice.
const reader = process.env.SAFE_DOCX_HEADER_FOOTER_TEXT_BOX_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice accepts and rejects a header/footer text-box lifecycle (#1384)', () => {
  test('a box inserted into or deleted from a footer or first-page header', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const cases: Array<{ label: string; original: Buffer; revised: Buffer; compared: Buffer }> = [];
    for (const slot of [{ kind: 'footer', role: 'default' }, { kind: 'header', role: 'first' }] as const) {
      const text = `Page ${slot.kind}`;
      const withoutBox: StoryPart = { ...slot, content: paragraph(text) };
      const withBox: StoryPart = { ...slot, content: `<w:p>${vmlBox(BOX)}${textRun(text)}</w:p>` };
      for (const [direction, from, to] of [['inserted', withoutBox, withBox], ['deleted', withBox, withoutBox]] as const) {
        const original = await storyPackage([...companions(slot), from], ORIGINAL_BODY);
        const revised = await storyPackage([...companions(slot), to], REVISED_BODY);
        const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
        cases.push({ label: `${slot.role} ${slot.kind} box ${direction}`, original, revised, compared: result.document });
      }
    }
    const packages: Buffer[] = [];
    await runLibreOfficeOracle(
      cases.flatMap(({ original, revised, compared }) => [
        { op: 'identity' as const, docx: original, saveAs: 'odt' as const },
        { op: 'identity' as const, docx: revised, saveAs: 'odt' as const },
        { op: 'accept' as const, docx: compared, saveAs: 'odt' as const },
        { op: 'reject' as const, docx: compared, saveAs: 'odt' as const },
      ]),
      undefined,
      (index: number, bytes: Buffer) => { packages[index] = bytes; },
    );
    for (const [index, { label }] of cases.entries()) {
      const [original, revised, accepted, rejected] = await Promise.all(
        packages.slice(index * 4, index * 4 + 4).map(odtBoxTexts),
      );
      console.log(`[#1384] ${label}: original=${JSON.stringify(original)} revised=${JSON.stringify(revised)}` +
        ` accepted=${JSON.stringify(accepted)} rejected=${JSON.stringify(rejected)}`);
      expect(original!.length + revised!.length, label).toBe(1);
      expect(accepted, `${label} accept`).toEqual(revised);
      expect(rejected, `${label} reject`).toEqual(original);
    }
  }, 600_000);
});
