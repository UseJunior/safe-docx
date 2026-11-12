/**
 * A text box stored only as DrawingML (`wps:txbx` with no VML fallback), or
 * stored one way in the original and another way in the revised document: VML
 * only, DrawingML only, or both inside `mc:AlternateContent` the way a newer
 * Word saves it. The box's text change is tracked inside the box, and every
 * stored copy carries the same tracked text, so Word (which reads the
 * `mc:Choice` DrawingML copy) and an older reader (which reads the
 * `mc:Fallback` VML copy) show the same redline. A box that only changed how it
 * is stored — a re-save by a newer Word — shows no revision at all.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 1 § 20.4.2.38
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.22
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @see https://github.com/UseJunior/safe-docx/issues/1383
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
import { canonicalNode } from './opaquePassthrough.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { UnsupportedTextBoxRevisionError } from './textBoxRevisionSafety.js';

const TEST_FEATURE = 'Text-Box Storage Shape Changes';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 4, section: '14.9.1.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '20.4.2.38' },
    { spec: 'ECMA-376', edition: 5, part: 4, section: '19.1.2.22' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' },
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

const story = (text: string): string =>
  `<w:txbxContent><w:p w14:paraId="20000001" w14:textId="20000001">` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:txbxContent>`;

/** The VML spelling of the box (a `w:pict`), `width` in points. */
function vmlPict(text: string, width = '200pt'): string {
  return (
    `<w:pict><v:shape id="box1" o:spid="_x0000_s1026" type="#_x0000_t202"` +
    ` style="position:absolute;margin-left:10pt;margin-top:0;width:${width};height:50pt;z-index:1">` +
    `<v:textbox>${story(text)}</v:textbox><w10:wrap type="square"/></v:shape></w:pict>`
  );
}

/** The DrawingML spelling of the box (a `w:drawing`), `width` in EMU. */
function drawingMl(text: string, width = '2540000'): string {
  return (
    `<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0"` +
    ` relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="column"><wp:posOffset>127000</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${width}" cy="635000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="Text Box 1"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="635000"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>` +
    `<wps:txbx>${story(text)}</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>` +
    `</wp:anchor></w:drawing>`
  );
}

/** How a box is stored: the run holding it, given its text. */
type Storage = (text: string) => string;

/** A pre-2010 text box: VML only. */
const vmlOnly: Storage = (text) => `<w:r>${vmlPict(text)}</w:r>`;
/** A text box written with no VML fallback: DrawingML only. */
const drawingMlOnly: Storage = (text) => `<w:r>${drawingMl(text)}</w:r>`;
/** Word's own text box: DrawingML in `mc:Choice`, the same box in VML in `mc:Fallback`. */
const twinned = (drawingWidth?: string, vmlWidth?: string): Storage => (text) =>
  `<w:r><mc:AlternateContent><mc:Choice Requires="wps">${drawingMl(text, drawingWidth)}</mc:Choice>` +
  `<mc:Fallback>${vmlPict(text, vmlWidth)}</mc:Fallback></mc:AlternateContent></w:r>`;
const twin = twinned();

const paragraph = (text: string): string => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const anchored = (box: string): string => `<w:p>${box}<w:r><w:t xml:space="preserve">Notice block</w:t></w:r></w:p>`;

const ORIGINAL_BODY = 'The parties agree as follows.';
const REVISED_BODY = 'The parties hereby agree as follows.';

function bodyPackage(box: string, bodyText = ORIGINAL_BODY): Promise<Buffer> {
  return buildDocxFromBodyXml(paragraph(bodyText) + anchored(box), [], {
    namespaces: NAMESPACES,
    ignorablePrefixes: ['wps'],
  });
}

async function footerPackage(box: string, bodyText = ORIGINAL_BODY): Promise<Buffer> {
  const archive = await DocxArchive.load(await bodyPackage('', bodyText));
  archive.setDocumentXml((await archive.getDocumentXml()).replace(
    '<w:sectPr/>',
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>',
  ));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      `<Relationship Id="rIdFooter" Type="${R_NS}/footer" Target="footer1.xml"/></Relationships>`,
  );
  const declarations = Object.entries(NAMESPACES).map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`).join('');
  archive.setFile(
    'word/footer1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:ftr xmlns:w="${W_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"` +
      ` xmlns:mc="${MC_NS}"${declarations}` +
      ` mc:Ignorable="w14 wps"><w:p>${box}</w:p></w:ftr>`,
  );
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace(
    '</Types>',
    '<Override PartName="/word/footer1.xml"' +
      ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
  ));
  return archive.save();
}

const BODY = 'word/document.xml';
const FOOTER = 'word/footer1.xml';

async function partXml(buffer: Buffer, partPath: string): Promise<string> {
  return (await (await DocxArchive.load(buffer)).getFile(partPath))!;
}

function ancestor(element: Element, namespace: string, names: readonly string[], stopAt?: string): Element | undefined {
  for (let node = element.parentNode; node?.nodeType === 1; node = node.parentNode) {
    const candidate = node as Element;
    if (stopAt && candidate.namespaceURI === W_NS && candidate.localName === stopAt) return undefined;
    if (candidate.namespaceURI === namespace && names.includes(candidate.localName)) return candidate;
  }
  return undefined;
}

/** The plain text of an element's `w:t` descendants. */
const textOf = (root: Element): string =>
  Array.from(root.getElementsByTagNameNS(W_NS, 't')).map((text) => text.textContent ?? '').join('');

/**
 * What a reader sees in a part: the text outside boxes, the text of each
 * visual box (asserting that every stored copy of it reads the same), and how
 * each box is stored and drawn.
 */
interface ReaderView {
  text: string;
  boxes: string[];
  storage: string[];
}

function readerView(xml: string): ReaderView {
  const document = parseXml(xml);
  const copies = Array.from(document.getElementsByTagNameNS(W_NS, 'txbxContent'));
  const roots = new Map<Element, Element[]>();
  for (const copy of copies) {
    const root = ancestor(copy, MC_NS, ['AlternateContent']) ?? ancestor(copy, W_NS, ['drawing', 'pict'])!;
    roots.set(root, [...(roots.get(root) ?? []), copy]);
  }
  const boxes = [...roots.values()].map((stored) => {
    const texts = [...new Set(stored.map(textOf))];
    expect(texts, 'every stored copy of one box reads the same').toHaveLength(1);
    return texts[0]!;
  });
  const storage = [...roots.keys()].map((root) => {
    const clone = root.cloneNode(true) as Element;
    for (const box of Array.from(clone.getElementsByTagNameNS(W_NS, 'txbxContent'))) {
      while (box.firstChild) box.removeChild(box.firstChild);
    }
    return canonicalNode(clone);
  });
  const text = Array.from(document.getElementsByTagNameNS(W_NS, 't'))
    .filter((element) => !ancestor(element, W_NS, ['txbxContent']))
    .map((element) => element.textContent ?? '')
    .join('');
  return { text, boxes, storage };
}

/** The text deleted and inserted inside each stored copy of a box. */
function trackedCopyText(xml: string): Array<{ deleted: string; inserted: string }> {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'txbxContent')).map((box) => ({
    deleted: Array.from(box.getElementsByTagNameNS(W_NS, 'delText')).map((text) => text.textContent).join(''),
    inserted: Array.from(box.getElementsByTagNameNS(W_NS, 't'))
      .filter((text) => ancestor(text, W_NS, ['ins'], 'txbxContent'))
      .map((text) => text.textContent)
      .join(''),
  }));
}

/** Revision elements anywhere in a part. */
function revisionCount(xml: string): number {
  return Array.from(parseXml(xml).getElementsByTagName('*'))
    .filter((element) => element.namespaceURI === W_NS && ['ins', 'del', 'moveFrom', 'moveTo'].includes(element.localName))
    .length;
}

/** No drawing container or `mc:AlternateContent` in `xml` sits inside a revision wrapper. */
function storageUntracked(xml: string): boolean {
  return Array.from(parseXml(xml).getElementsByTagName('*'))
    .filter((element) =>
      (element.namespaceURI === W_NS && ['drawing', 'pict'].includes(element.localName)) ||
      (element.namespaceURI === MC_NS && element.localName === 'AlternateContent'))
    .every((element) => !ancestor(element, W_NS, ['ins', 'del', 'moveFrom', 'moveTo']));
}

async function docxCorePart(buffer: Buffer, mode: 'accept' | 'reject', partPath: string): Promise<string> {
  const document = await DocxDocument.load(buffer);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return partXml((await document.toBuffer()).buffer, partPath);
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1383-'));
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
 * Accept All is the revised part and Reject All the original part's text in
 * the revised storage, through both acceptors; the output passes the
 * emitted-document schema gate.
 */
async function assertProjections(
  original: Buffer,
  revised: Buffer,
  compared: Buffer,
  partPath: string,
): Promise<void> {
  const originalView = readerView(await partXml(original, partPath));
  const revisedView = readerView(await partXml(revised, partPath));
  const rejectedView = { ...originalView, storage: revisedView.storage };
  const output = await partXml(compared, partPath);
  expect(readerView(acceptAllChanges(output))).toEqual(revisedView);
  expect(readerView(rejectAllChanges(output))).toEqual(rejectedView);
  expect(readerView(await docxCorePart(compared, 'accept', partPath))).toEqual(revisedView);
  expect(readerView(await docxCorePart(compared, 'reject', partPath))).toEqual(rejectedView);
  await assertSchema(compared);
}

/**
 * The `drawing` entry a carried storage change lists: the drawing Word
 * renders, the DrawingML one when the revised side stores it.
 */
function listedDrawing(
  revisedStorage: Storage,
  story: 'body' | 'footer',
): Array<Record<string, unknown>> {
  const element = revisedStorage === vmlOnly
    ? { element: 'pict', name: 'box1' }
    : { element: 'drawing', name: 'Text Box 1' };
  return [{
    scope: 'drawing',
    kind: 'changed',
    sectionIndex: 0,
    ...(story === 'footer' ? { role: 'default' } : {}),
    drawing: { story, partPath: story === 'body' ? BODY : FOOTER, index: 0, ...element },
  }];
}

const STORAGE_CHANGES: ReadonlyArray<readonly [label: string, original: Storage, revised: Storage]> = [
  ['VML only, re-saved twinned in mc:AlternateContent', vmlOnly, twin],
  ['twinned in mc:AlternateContent, saved back as VML only', twin, vmlOnly],
  ['DrawingML only, re-saved twinned in mc:AlternateContent', drawingMlOnly, twin],
];

describe('text boxes stored as DrawingML only or differently in the two documents (#1383)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  test('tracks the text of a DrawingML-only body box inside the box', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const original = await given('a DrawingML text box with no VML fallback', () =>
      bodyPackage(drawingMlOnly('Notice to: Old address')));
    const revised = await given('the same box with its text edited', () =>
      bodyPackage(drawingMlOnly('Notice to: New address')));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    const output = await partXml(result.document, BODY);

    await then('the edit is tracked inside the box and the drawing is not', () => {
      expect(trackedCopyText(output)).toEqual([{ deleted: 'Old', inserted: 'New' }]);
      expect(storageUntracked(output)).toBe(true);
      expect(result.unrepresentedChanges).toBeUndefined();
    });
    await and('Accept All is the revised document and Reject All the original, exactly', async () => {
      const originalView = readerView(await partXml(original, BODY));
      expect(readerView(rejectAllChanges(output))).toEqual(originalView);
      expect(readerView(await docxCorePart(result.document, 'reject', BODY))).toEqual(originalView);
      await assertProjections(original, revised, result.document, BODY);
    });
  });

  for (const [label, originalStorage, revisedStorage] of STORAGE_CHANGES) {
    test(`tracks the text of a body box stored ${label} in every stored copy`, async ({
      given, when, then, and,
    }: AllureBddContext) => {
      const original = await given('the box as the original stores it', () =>
        bodyPackage(originalStorage('Notice to: Old address')));
      const revised = await given('the box stored the other way, its text and the body edited', () =>
        bodyPackage(revisedStorage('Notice to: New address'), REVISED_BODY));
      const result = await when('the documents are compared', () =>
        compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      const output = await partXml(result.document, BODY);
      const revisedCopies = parseXml(await partXml(revised, BODY)).getElementsByTagNameNS(W_NS, 'txbxContent').length;

      await then('every stored copy carries the same tracked edit, in the revised storage', () => {
        expect(trackedCopyText(output)).toEqual(
          Array.from({ length: revisedCopies }, () => ({ deleted: 'Old', inserted: 'New' })),
        );
        expect(storageUntracked(output)).toBe(true);
      });
      await and('the added or dropped spelling is listed as a drawing change, once', () => {
        expect(result.unrepresentedChanges).toEqual(listedDrawing(revisedStorage, 'body'));
      });
      await and('Accept All is the revised document; Reject All the original text in the revised storage', () =>
        assertProjections(original, revised, result.document, BODY));
    });

    test(`shows no revision for a body box only re-stored ${label}`, async ({
      given, when, then,
    }: AllureBddContext) => {
      // A newer Word re-saving an older document rewrites how the box is
      // stored without changing what the box says. There is no text for a
      // reviewer to accept or reject; the spelling one side alone stores
      // cannot be shown to draw the same box, so it is listed, not hidden.
      const original = await given('the box as the original stores it', () =>
        bodyPackage(originalStorage('Notice to: Same address')));
      const revised = await given('the same box and text, stored the other way', () =>
        bodyPackage(revisedStorage('Notice to: Same address')));
      const result = await when('the documents are compared', () =>
        compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

      await then('the redline is the revised document with no revision and the drawing listed', async () => {
        const output = await partXml(result.document, BODY);
        expect(revisionCount(output)).toBe(0);
        expect(result.unrepresentedChanges).toEqual(listedDrawing(revisedStorage, 'body'));
        await assertProjections(original, revised, result.document, BODY);
      });
    });
  }

  test('lists the drawing of a re-stored box whose shape and text both changed', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const original = await given('a VML-only box 200pt wide', () =>
      bodyPackage(vmlOnly('Notice to: Old address')));
    const revised = await given('the box twinned, widened in both spellings and edited', () =>
      bodyPackage(twinned('3302000', '260pt')('Notice to: New address')));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    const output = await partXml(result.document, BODY);

    await then('the edit is tracked in both stored copies', () => {
      expect(trackedCopyText(output)).toEqual([
        { deleted: 'Old', inserted: 'New' },
        { deleted: 'Old', inserted: 'New' },
      ]);
      expect(storageUntracked(output)).toBe(true);
    });
    await and('the one visual box is listed once, by the drawing Word renders', () => {
      expect(result.unrepresentedChanges).toEqual([{
        scope: 'drawing',
        kind: 'changed',
        sectionIndex: 0,
        drawing: { story: 'body', partPath: BODY, index: 0, element: 'drawing', name: 'Text Box 1' },
      }]);
    });
    await and('the projections are the documented ones', () =>
      assertProjections(original, revised, result.document, BODY));
  });

  test('control: a re-stored, resized body box with unchanged text keeps its native redline', async ({
    given, when, then,
  }: AllureBddContext) => {
    // As for any box whose drawing alone changed (#1382), the outer
    // comparison tracks the old box as deleted and the new one as inserted,
    // so Reject All restores the original storage and shape exactly.
    const original = await given('a VML-only box', () => bodyPackage(vmlOnly('Notice to: Same address')));
    const revised = await given('the box twinned and widened, its text unchanged', () =>
      bodyPackage(twinned('3302000', '260pt')('Notice to: Same address')));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the box is tracked as replaced and nothing is listed', async () => {
      const output = await partXml(result.document, BODY);
      expect(result.unrepresentedChanges).toBeUndefined();
      expect(storageUntracked(output)).toBe(false);
      const originalView = readerView(await partXml(original, BODY));
      const revisedView = readerView(await partXml(revised, BODY));
      expect(readerView(acceptAllChanges(output))).toEqual(revisedView);
      expect(readerView(rejectAllChanges(output))).toEqual(originalView);
      expect(readerView(await docxCorePart(result.document, 'accept', BODY))).toEqual(revisedView);
      expect(readerView(await docxCorePart(result.document, 'reject', BODY))).toEqual(originalView);
      await assertSchema(result.document);
    });
  });

  test('control: a DrawingML-only box replaced by a VML-only box with no shared identity is a native replacement', async ({
    given, when, then,
  }: AllureBddContext) => {
    // No spelling is stored on both sides, so nothing says the two are one
    // box: the outer comparison tracks one box deleted and the other inserted.
    const original = await given('a DrawingML-only box', () => bodyPackage(drawingMlOnly('Notice to: Old address')));
    const revised = await given('a VML-only box', () => bodyPackage(vmlOnly('Notice to: New address')));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the box is tracked as replaced, exactly reversible', async () => {
      const output = await partXml(result.document, BODY);
      expect(storageUntracked(output)).toBe(false);
      const originalView = readerView(await partXml(original, BODY));
      const revisedView = readerView(await partXml(revised, BODY));
      expect(readerView(acceptAllChanges(output))).toEqual(revisedView);
      expect(readerView(rejectAllChanges(output))).toEqual(originalView);
      expect(readerView(await docxCorePart(result.document, 'accept', BODY))).toEqual(revisedView);
      expect(readerView(await docxCorePart(result.document, 'reject', BODY))).toEqual(originalView);
      await assertSchema(result.document);
    });
  });

  test('control: a twin whose two copies disagree is not re-stored, so Reject All keeps both', async ({
    given, when, then,
  }: AllureBddContext) => {
    // Word reads the mc:Choice and an older reader the mc:Fallback. When the
    // two say different things, carrying one copy's story into the other
    // spelling would change what one reader saw, so the box stays a native
    // replacement in the body and is refused in a footer.
    const disagreeing = '<w:r><mc:AlternateContent><mc:Choice Requires="wps">' + drawingMl('Notice to: Choice address') +
      '</mc:Choice><mc:Fallback>' + vmlPict('Notice to: Fallback address') + '</mc:Fallback></mc:AlternateContent></w:r>';
    const original = await given('a twin whose Choice and Fallback texts differ', () => bodyPackage(disagreeing));
    const revised = await given('the box saved back as VML only, edited', () => bodyPackage(vmlOnly('Notice to: New address')));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    const footerFailure = await when('the same pair is compared in a footer', async () =>
      compareDocumentsAtomizer(await footerPackage(disagreeing), await footerPackage(vmlOnly('Notice to: New address')), COMPARE_OPTIONS)
        .then(() => undefined, (error: unknown) => error));

    await then('the body box is replaced natively and Reject All restores both copies', async () => {
      const output = await partXml(result.document, BODY);
      expect(storageUntracked(output)).toBe(false);
      const copies = (xml: string): string[] =>
        Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'txbxContent')).map(textOf);
      expect(copies(rejectAllChanges(output))).toEqual(['Notice to: Choice address', 'Notice to: Fallback address']);
      expect(copies(acceptAllChanges(output))).toEqual(['Notice to: New address']);
      await assertSchema(result.document);
      expect(footerFailure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
    });
  });

  test('treats a twin whose DrawingML and VML spellings draw different sizes as a drawing change', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    // Word renders the 260pt mc:Choice; saved back as VML only, it renders
    // the 200pt spelling. The VML both documents store is unchanged, but the
    // drawing Word shows is not, so the change is never silent: the dropped
    // spelling is listed whether or not the text changed.
    const lopsided = twinned('3302000', '200pt');
    const sameText = await given('the twin saved back as VML only, text unchanged', async () => ({
      original: await bodyPackage(lopsided('Notice to: Same address')),
      revised: await bodyPackage(vmlOnly('Notice to: Same address')),
    }));
    const edited = await given('the twin saved back as VML only, text edited', async () => ({
      original: await bodyPackage(lopsided('Notice to: Old address')),
      revised: await bodyPackage(vmlOnly('Notice to: New address')),
    }));
    const sameResult = await when('the unedited pair is compared', () =>
      compareDocumentsAtomizer(sameText.original, sameText.revised, COMPARE_OPTIONS));
    const editedResult = await when('the edited pair is compared', () =>
      compareDocumentsAtomizer(edited.original, edited.revised, COMPARE_OPTIONS));
    const footerResult = await when('the edited pair is compared in a footer', async () => {
      const original = await footerPackage(lopsided('Footer notice: Old'));
      const revised = await footerPackage(vmlOnly('Footer notice: New'));
      return { original, revised, result: await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS) };
    });

    await then('the unedited body box shows no revision and its drawing is listed', async () => {
      const output = await partXml(sameResult.document, BODY);
      expect(revisionCount(output)).toBe(0);
      expect(sameResult.unrepresentedChanges).toEqual(listedDrawing(vmlOnly, 'body'));
      await assertProjections(sameText.original, sameText.revised, sameResult.document, BODY);
    });
    await and('the edited box is tracked in place and its drawing listed, in the body and in a footer', async () => {
      expect(trackedCopyText(await partXml(editedResult.document, BODY))).toEqual([{ deleted: 'Old', inserted: 'New' }]);
      expect(editedResult.unrepresentedChanges).toEqual([{
        scope: 'drawing',
        kind: 'changed',
        sectionIndex: 0,
        drawing: { story: 'body', partPath: BODY, index: 0, element: 'pict', name: 'box1' },
      }]);
      await assertProjections(edited.original, edited.revised, editedResult.document, BODY);
      expect(footerResult.result.unrepresentedChanges?.map((change) => change.scope)).toEqual(['drawing']);
      await assertProjections(footerResult.original, footerResult.revised, footerResult.result.document, FOOTER);
    });
  });

  test('lists the drawing of a re-stored twin whose DrawingML spelling places or paints the box differently', async ({
    when, then,
  }: AllureBddContext) => {
    // The size and offsets both spellings write can agree while the DrawingML
    // one draws a different box: `simplePos="1"` places it by `wp:simplePos`,
    // `behindDoc` sends it behind the text, `a:xfrm/@rot` turns it. No rule
    // maps every such property onto VML, so a spelling only one side stores
    // is always listed, never taken for a faithful re-save.
    const variants: ReadonlyArray<readonly [string, (xml: string) => string]> = [
      ['placed by wp:simplePos', (xml) => xml.replace('simplePos="0"', 'simplePos="1"')
        .replace('<wp:simplePos x="0" y="0"/>', '<wp:simplePos x="3810000" y="1905000"/>')],
      ['sent behind the text', (xml) => xml.replace('behindDoc="0"', 'behindDoc="1"')],
      ['rotated', (xml) => xml.replace('<a:xfrm>', '<a:xfrm rot="5400000">')],
    ];
    const results = await when('a VML-only box is compared with each re-stored twin, text unchanged', () =>
      Promise.all(variants.map(async ([label, vary]) => {
        const original = await bodyPackage(vmlOnly('Notice to: Same address'));
        const revised = await bodyPackage(vary(twin('Notice to: Same address')));
        const footerOriginal = await footerPackage(vmlOnly('Footer notice'));
        const footerRevised = await footerPackage(vary(twin('Footer notice')));
        return {
          label,
          body: await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS),
          footer: await compareDocumentsAtomizer(footerOriginal, footerRevised, COMPARE_OPTIONS),
        };
      })));

    await then('each one lists the drawing, in the body and in a footer', () => {
      for (const { label, body, footer } of results) {
        expect(body.unrepresentedChanges, label).toEqual(listedDrawing(twin, 'body'));
        expect(footer.unrepresentedChanges, label).toEqual(listedDrawing(twin, 'footer'));
      }
    });
  });

  test('control: a box whose drawing defines a template another box names is not re-stored', async ({
    given, when, then,
  }: AllureBddContext) => {
    // The original's first box defines the v:shapetype both boxes name. The
    // revised document twins the first box and moves the definition into the
    // second box's drawing. Carrying the first box's revised storage would
    // leave Reject All with no definition for the second box, so the first box
    // stays a native replacement.
    const template = '<v:shapetype id="shared" coordsize="21600,21600" path="m,l,21600r21600,l21600,xe"/>';
    const box = (text: string, id: string, withTemplate: boolean): string =>
      vmlPict(text).replace('<v:shape ', `${withTemplate ? template : ''}<v:shape `)
        .replace('id="box1"', `id="${id}"`).replace('type="#_x0000_t202"', 'type="#shared"');
    const original = await given('two VML boxes, the first defining their shared template', () =>
      bodyPackage(`<w:r>${box('Notice to: Old address', 'box1', true)}</w:r><w:r>${box('Second box', 'box2', false)}</w:r>`));
    const revised = await given('the first box twinned and edited, the template moved to the second', () =>
      bodyPackage(
        `<w:r><mc:AlternateContent><mc:Choice Requires="wps">${drawingMl('Notice to: New address').replace('id="1" name="Text Box 1"', 'id="1" name="box1"')}</mc:Choice>` +
          `<mc:Fallback>${box('Notice to: New address', 'box1', false)}</mc:Fallback></mc:AlternateContent></w:r>` +
          `<w:r>${box('Second box', 'box2', true)}</w:r>`,
      ));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('Reject All keeps the template definition the second box names', async () => {
      const rejected = parseXml(rejectAllChanges(await partXml(result.document, BODY)));
      expect(Array.from(rejected.getElementsByTagNameNS(NAMESPACES.v, 'shapetype'))
        .map((element) => element.getAttribute('id'))).toEqual(['shared']);
      const coreRejected = parseXml(await docxCorePart(result.document, 'reject', BODY));
      expect(coreRejected.getElementsByTagNameNS(NAMESPACES.v, 'shapetype')).toHaveLength(1);
      expect(readerView(rejectAllChanges(await partXml(result.document, BODY))).boxes)
        .toEqual(['Notice to: Old address', 'Second box']);
    });
  });

  test('tracks the text of a DrawingML-only footer box inside the box', async ({
    given, when, then,
  }: AllureBddContext) => {
    const original = await given('a DrawingML-only footer box', () =>
      footerPackage(drawingMlOnly('Footer notice: Old')));
    const revised = await given('the footer box edited, with a body edit', () =>
      footerPackage(drawingMlOnly('Footer notice: New'), REVISED_BODY));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the edit is tracked inside the footer box and nothing is listed', async () => {
      const output = await partXml(result.document, FOOTER);
      expect(trackedCopyText(output)).toEqual([{ deleted: 'Old', inserted: 'New' }]);
      expect(storageUntracked(output)).toBe(true);
      expect(result.unrepresentedChanges).toBeUndefined();
      await assertProjections(original, revised, result.document, FOOTER);
      await assertProjections(original, revised, result.document, BODY);
    });
  });

  for (const [label, originalStorage, revisedStorage] of STORAGE_CHANGES) {
    test(`tracks the text of a footer box stored ${label} in every stored copy`, async ({
      given, when, then, and,
    }: AllureBddContext) => {
      const original = await given('the footer box as the original stores it', () =>
        footerPackage(originalStorage('Footer notice: Old')));
      const revised = await given('the footer box stored the other way and edited', () =>
        footerPackage(revisedStorage('Footer notice: New')));
      const result = await when('the documents are compared', () =>
        compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      const output = await partXml(result.document, FOOTER);
      const revisedCopies = parseXml(await partXml(revised, FOOTER)).getElementsByTagNameNS(W_NS, 'txbxContent').length;

      await then('every stored copy carries the same tracked edit', () => {
        expect(trackedCopyText(output)).toEqual(
          Array.from({ length: revisedCopies }, () => ({ deleted: 'Old', inserted: 'New' })),
        );
        expect(storageUntracked(output)).toBe(true);
      });
      await and('the footer is not listed; the added or dropped spelling is, as a drawing', () => {
        expect(result.unrepresentedChanges).toEqual(listedDrawing(revisedStorage, 'footer'));
      });
      await and('Accept All is the revised footer; Reject All the original text in the revised storage', () =>
        assertProjections(original, revised, result.document, FOOTER));
    });
  }

  test('shows no revision for a footer box only re-stored twinned', async ({
    given, when, then,
  }: AllureBddContext) => {
    const original = await given('a VML-only footer box', () => footerPackage(vmlOnly('Footer notice')));
    const revised = await given('the same footer box twinned', () => footerPackage(twin('Footer notice')));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the footer carries no revision and only the added spelling is listed', async () => {
      expect(revisionCount(await partXml(result.document, FOOTER))).toBe(0);
      expect(result.unrepresentedChanges).toEqual(listedDrawing(twin, 'footer'));
      await assertProjections(original, revised, result.document, FOOTER);
    });
  });

  test('lists the drawing of a re-stored, resized footer box once', async ({
    given, when, then,
  }: AllureBddContext) => {
    const original = await given('a VML-only footer box', () => footerPackage(vmlOnly('Footer notice: Old')));
    const revised = await given('the footer box twinned, widened and edited', () =>
      footerPackage(twinned('3302000', '260pt')('Footer notice: New')));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the drawing is listed in place of the footer, and the text is tracked', async () => {
      expect(result.unrepresentedChanges).toEqual([{
        scope: 'drawing',
        kind: 'changed',
        sectionIndex: 0,
        role: 'default',
        drawing: { story: 'footer', partPath: FOOTER, index: 0, element: 'drawing', name: 'Text Box 1' },
      }]);
      expect(trackedCopyText(await partXml(result.document, FOOTER))).toEqual([
        { deleted: 'Old', inserted: 'New' },
        { deleted: 'Old', inserted: 'New' },
      ]);
      await assertProjections(original, revised, result.document, FOOTER);
    });
  });

  test('control: a footer box with no spelling in common is still refused', async ({
    given, when, then,
  }: AllureBddContext) => {
    // A header or footer cannot track a box as replaced (#1384), and a
    // DrawingML-only box against a VML-only box shares no identity.
    const original = await given('a DrawingML-only footer box', () => footerPackage(drawingMlOnly('Footer notice: Old')));
    const revised = await given('a VML-only footer box', () => footerPackage(vmlOnly('Footer notice: New')));
    const failure = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS).then(() => undefined, (error: unknown) => error));

    await then('the comparison names the different drawing', () => {
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect((failure as UnsupportedTextBoxRevisionError).changes).toEqual([
        expect.objectContaining({
          index: 0,
          partPath: FOOTER,
          reason: 'the ancillary text-box scaffold names a different drawing (its anchor identity changed)',
        }),
      ]);
    });
  });
});

/** The text of each LibreOffice text frame in an ODT export, in reading order. */
async function odtFrameTexts(odt: Buffer): Promise<string[]> {
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
      if (text.includes('notice') || text.includes('Notice') || text.includes('copy')) texts.push(text);
    }
  }
  return texts;
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice.
const reader = process.env.SAFE_DOCX_TEXT_BOX_STORAGE_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice reads a re-stored, edited text box as the source text (#1383)', () => {
  test('accepts to the revised box text and rejects to the original, body and footer', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    // Which copy of a twin LibreOffice renders: Choice and Fallback disagree here.
    const probe = await bodyPackage(
      '<w:r><mc:AlternateContent><mc:Choice Requires="wps">' + drawingMl('choice copy') +
        '</mc:Choice><mc:Fallback>' + vmlPict('fallback copy') + '</mc:Fallback></mc:AlternateContent></w:r>',
    );
    const cases: Array<{ original: Buffer; revised: Buffer; compared: Buffer }> = [];
    for (const build of [bodyPackage, footerPackage]) {
      for (const [original, revised] of [
        [drawingMlOnly('Notice to: Old address'), drawingMlOnly('Notice to: New address')],
        ...STORAGE_CHANGES.map(([, from, to]) => [from('Notice to: Old address'), to('Notice to: New address')]),
      ]) {
        const originalPackage = await build(original!);
        const revisedPackage = await build(revised!, REVISED_BODY);
        const result = await compareDocumentsAtomizer(originalPackage, revisedPackage, COMPARE_OPTIONS);
        cases.push({ original: originalPackage, revised: revisedPackage, compared: result.document });
      }
    }
    const packages: Buffer[] = [];
    await runLibreOfficeOracle(
      [
        { op: 'identity' as const, docx: probe, saveAs: 'odt' as const },
        ...cases.flatMap(({ original, revised, compared }) => [
          { op: 'identity' as const, docx: original, saveAs: 'odt' as const },
          { op: 'identity' as const, docx: revised, saveAs: 'odt' as const },
          { op: 'accept' as const, docx: compared, saveAs: 'odt' as const },
          { op: 'reject' as const, docx: compared, saveAs: 'odt' as const },
        ]),
      ],
      undefined,
      (index: number, bytes: Buffer) => { packages[index] = bytes; },
    );
    console.log(`[#1383] LibreOffice renders the twin's: ${JSON.stringify(await odtFrameTexts(packages[0]!))}`);
    for (let index = 0; index < cases.length; index++) {
      const [original, revised, accepted, rejected] = await Promise.all(
        packages.slice(1 + index * 4, 1 + index * 4 + 4).map(odtFrameTexts),
      );
      expect(original).toHaveLength(1);
      expect(original).not.toEqual(revised);
      expect(accepted, `case ${index}`).toEqual(revised);
      expect(rejected, `case ${index}`).toEqual(original);
    }
  }, 600_000);
});
