/**
 * A text box whose drawing (size, position or wrap) changes. WordprocessingML
 * defines revision markup for run, paragraph, section, table and numbering
 * properties only, so the drawing geometry of a VML shape (`style`,
 * `w10:wrap`) or a DrawingML `wp:anchor`/`wp:inline` (`wp:extent`,
 * `wp:positionH`/`wp:positionV`, `wp:wrap*`) cannot be tracked. When the
 * text in the box changed too, the text is tracked inside the box, the
 * redline carries the revised drawing, and the drawing is listed once in
 * `unrepresentedChanges` with the `drawing` scope. Reject All therefore shows
 * the original text in the revised drawing. A body drawing whose text did not
 * change keeps its native redline (the box tracked as replaced).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.22
 * @conformance ECMA-376 edition 5, Part 1 § 20.4.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/1382
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
import { formatUnrepresentedChangeWarnings } from '../unrepresented-change-warnings.js';
import { canonicalNode } from './opaquePassthrough.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const TEST_FEATURE = 'Text-Box Drawing Shape Changes';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' },
    { spec: 'ECMA-376', edition: 5, part: 4, section: '14.9.1.1' },
    { spec: 'ECMA-376', edition: 5, part: 4, section: '19.1.2.22' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '20.4.2.38' },
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
} as const;
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-11T00:00:00.000Z') };
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);
// Multi-story round trips: well inside 5s alone, slower under a parallel suite.
const LOAD_SENSITIVE_TIMEOUT_MS = 30_000;

interface Shape {
  /** VML `style` width, or DrawingML extent `cx`. */
  width?: string;
  /** DrawingML `wp:positionH` offset, or VML `margin-left`. */
  left?: string;
  /** `w10:wrap/@type`, or the DrawingML `wp:wrap*` element. */
  wrap?: string;
}

const story = (text: string): string =>
  `<w:txbxContent><w:p w14:paraId="20000001" w14:textId="20000001">` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:txbxContent>`;

/** A VML text box (`w:pict`), as a run. */
function vmlBox(text: string, { width = '200pt', left = '10pt', wrap = 'square' }: Shape = {}): string {
  return (
    `<w:r><w:pict><v:shape id="box1" o:spid="_x0000_s1026" type="#_x0000_t202"` +
    ` style="position:absolute;margin-left:${left};margin-top:0;width:${width};height:50pt;z-index:1">` +
    `<v:textbox>${story(text)}</v:textbox><w10:wrap type="${wrap}"/></v:shape></w:pict></w:r>`
  );
}

/** The `w:drawing` of a DrawingML text box anchored (or inline) in its paragraph. */
function drawingMlBox(
  text: string,
  { width = '2540000', left = '127000', wrap = 'wrapSquare' }: Shape = {},
  placement: 'anchor' | 'inline' = 'anchor',
): string {
  const graphic =
    `<wp:docPr id="1" name="Text Box 1"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="635000"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>` +
    `<wps:txbx>${story(text)}</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>`;
  if (placement === 'inline') {
    return `<w:drawing><wp:inline><wp:extent cx="${width}" cy="635000"/>${graphic}</wp:inline></w:drawing>`;
  }
  const wrapElement = wrap === 'wrapSquare' ? '<wp:wrapSquare wrapText="bothSides"/>' : `<wp:${wrap}/>`;
  return (
    `<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0"` +
    ` relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="column"><wp:posOffset>${left}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${width}" cy="635000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    wrapElement + graphic + `</wp:anchor></w:drawing>`
  );
}

/** Word's own text box: DrawingML in `mc:Choice`, the same box in VML in `mc:Fallback`. */
function twinBox(
  text: string,
  drawing: Shape = {},
  vml: Shape = {},
  placement: 'anchor' | 'inline' = 'anchor',
): string {
  const fallback = vmlBox(text, vml).slice('<w:r>'.length, -'</w:r>'.length);
  return (
    `<w:r><mc:AlternateContent><mc:Choice Requires="wps">${drawingMlBox(text, drawing, placement)}</mc:Choice>` +
    `<mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent></w:r>`
  );
}

const paragraph = (text: string): string => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const anchored = (box: string): string => `<w:p>${box}<w:r><w:t xml:space="preserve">Notice block</w:t></w:r></w:p>`;

/**
 * One w:drawing holding the text box's wp:anchor and a second wp:anchor with
 * a plain rectangle, inside a Word twin whose VML fallback has the box only.
 */
function twoAnchors(text: string, rectangleWidth: string): string {
  const box = drawingMlBox(text);
  const rectangle = drawingMlBox('', { width: rectangleWidth })
    .replace(/<wps:txbx>[\s\S]*?<\/wps:txbx>/u, '')
    .replace('<wps:cNvSpPr txBox="1"/>', '<wps:cNvSpPr/>')
    .replace('id="1" name="Text Box 1"', 'id="2" name="Rectangle 2"');
  const drawing = box.replace('</w:drawing>', rectangle.slice('<w:drawing>'.length));
  const fallback = vmlBox(text).slice('<w:r>'.length, -'</w:r>'.length);
  return `<w:r><mc:AlternateContent><mc:Choice Requires="wps">${drawing}</mc:Choice>` +
    `<mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent></w:r>`;
}

/**
 * Two VML boxes sharing one `v:shapetype` template, defined in the first
 * box's drawing; only the first box's text is a parameter.
 */
function sharedTemplateBoxes(text: string, templatePath: string): string {
  const first = vmlBox(text)
    .replace('<v:shape ', `<v:shapetype id="shared" coordsize="21600,21600" path="${templatePath}"/><v:shape `)
    .replace('type="#_x0000_t202"', 'type="#shared"');
  const second = vmlBox('Second box')
    .replace('id="box1"', 'id="box2"')
    .replace('o:spid="_x0000_s1026"', 'o:spid="_x0000_s1027"')
    .replace('type="#_x0000_t202"', 'type="#shared"');
  return first + second;
}

const RECTANGLE_PATH = 'm0,0l21600,0,21600,21600,0,21600xe';
const TRIANGLE_PATH = 'm10800,0l21600,21600,0,21600xe';

function bodyPackage(box: string, bodyText = 'The parties agree as follows.'): Promise<Buffer> {
  return buildDocxFromBodyXml(paragraph(bodyText) + anchored(box), [], {
    namespaces: NAMESPACES,
    ignorablePrefixes: ['wps'],
  });
}

async function footerPackage(box: string, bodyText = 'The parties agree as follows.'): Promise<Buffer> {
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
      ` xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"${declarations}` +
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

async function partXml(buffer: Buffer, partPath: string): Promise<string> {
  return (await (await DocxArchive.load(buffer)).getFile(partPath))!;
}

function isWithin(element: Element, names: readonly string[], stopAt?: string): boolean {
  for (let node = element.parentNode; node?.nodeType === 1; node = node.parentNode) {
    const ancestor = node as Element;
    if (ancestor.namespaceURI !== W_NS) continue;
    if (stopAt && ancestor.localName === stopAt) return false;
    if (names.includes(ancestor.localName)) return true;
  }
  return false;
}

/** What a reader sees: the text outside and inside boxes, and every drawing's geometry. */
interface ReaderView {
  text: string;
  boxes: string[];
  drawings: string[];
}

function readerView(xml: string): ReaderView {
  const document = parseXml(xml);
  const texts = (root: Element | Document, insideBoxes: boolean): string =>
    Array.from(root.getElementsByTagNameNS(W_NS, 't'))
      .filter((text) => insideBoxes || !isWithin(text, ['txbxContent']))
      .map((text) => text.textContent ?? '')
      .join('');
  const drawings = Array.from(document.getElementsByTagName('*'))
    .filter((element) =>
      element.namespaceURI === W_NS && ['drawing', 'pict', 'object'].includes(element.localName))
    .map((container) => {
      const clone = container.cloneNode(true) as Element;
      for (const box of Array.from(clone.getElementsByTagNameNS(W_NS, 'txbxContent'))) {
        while (box.firstChild) box.removeChild(box.firstChild);
      }
      return canonicalNode(clone);
    });
  return {
    text: texts(document, false),
    boxes: Array.from(document.getElementsByTagNameNS(W_NS, 'txbxContent')).map((box) => texts(box, true)),
    drawings,
  };
}

async function docxCorePart(buffer: Buffer, mode: 'accept' | 'reject', partPath: string): Promise<string> {
  const document = await DocxDocument.load(buffer);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return partXml((await document.toBuffer()).buffer, partPath);
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1382-'));
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
 * Accept All reproduces the revised part and Reject All the original part's
 * text in the revised drawings, through both acceptors; the output passes the
 * emitted-document schema gate.
 */
async function assertDocumentedProjections(
  original: Buffer,
  revised: Buffer,
  compared: Buffer,
  partPath: string,
): Promise<void> {
  const originalView = readerView(await partXml(original, partPath));
  const revisedView = readerView(await partXml(revised, partPath));
  expect(originalView.drawings).not.toEqual(revisedView.drawings);
  const rejectedView = { ...originalView, drawings: revisedView.drawings };
  const output = await partXml(compared, partPath);
  expect(readerView(acceptAllChanges(output))).toEqual(revisedView);
  expect(readerView(rejectAllChanges(output))).toEqual(rejectedView);
  expect(readerView(await docxCorePart(compared, 'accept', partPath))).toEqual(revisedView);
  expect(readerView(await docxCorePart(compared, 'reject', partPath))).toEqual(rejectedView);
  await assertSchema(compared);
}

/** The text deleted and inserted inside each box of `xml`. */
function trackedBoxText(xml: string): Array<{ deleted: string; inserted: string }> {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'txbxContent')).map((box) => ({
    deleted: Array.from(box.getElementsByTagNameNS(W_NS, 'delText')).map((text) => text.textContent).join(''),
    inserted: Array.from(box.getElementsByTagNameNS(W_NS, 't'))
      .filter((text) => isWithin(text, ['ins'], 'txbxContent'))
      .map((text) => text.textContent)
      .join(''),
  }));
}

/** No drawing container in `xml` sits inside a revision wrapper. */
function drawingsUntracked(xml: string): boolean {
  return Array.from(parseXml(xml).getElementsByTagName('*'))
    .filter((element) => element.namespaceURI === W_NS && ['drawing', 'pict'].includes(element.localName))
    .every((container) => !isWithin(container, ['ins', 'del', 'moveFrom', 'moveTo']));
}

describe('text-box drawing shape changes (#1382)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  test('tracks the text of a resized VML box and lists its drawing once', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const original = await given('a VML box 200pt wide reading "Notice to: Old address"', () =>
      bodyPackage(vmlBox('Notice to: Old address')));
    const revised = await given('the box widened to 260pt with the address edited', () =>
      bodyPackage(vmlBox('Notice to: New address', { width: '260pt' })));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    const output = await partXml(result.document, 'word/document.xml');

    await then('the address edit is tracked inside the box, which carries the revised shape', () => {
      expect(trackedBoxText(output)).toEqual([{ deleted: 'Old', inserted: 'New' }]);
      expect(drawingsUntracked(output)).toBe(true);
      expect(readerView(output).drawings).toEqual(
        readerView(acceptAllChanges(output)).drawings,
      );
    });
    await and('exactly one drawing entry names the box', () => {
      expect(result.unrepresentedChanges).toEqual([{
        scope: 'drawing',
        kind: 'changed',
        sectionIndex: 0,
        drawing: { story: 'body', partPath: 'word/document.xml', index: 0, element: 'pict', name: 'box1' },
      }]);
      expect(formatUnrepresentedChangeWarnings(result.unrepresentedChanges)).toEqual([
        'Unrepresented change: changed drawing (text box or picture size, position or wrap) "box1" ' +
          '(w:pict, text box #1) in the main story in section 1 (sectionIndex 0) has no tracked-change ' +
          'markup in the redline; the redline shows the revised shape, which Reject All keeps. ' +
          'Review that part manually.',
      ]);
    });
    await and('Accept All is the revised document and Reject All the original text in the revised shape', () =>
      assertDocumentedProjections(original, revised, result.document, 'word/document.xml'));
  });

  test('tracks the text of a VML box whose position and wrap change', async ({
    given, when, then,
  }: AllureBddContext) => {
    const original = await given('a VML box', () => bodyPackage(vmlBox('Notice to: Old address')));
    const revised = await given('the box moved, rewrapped and edited, with a body edit', () =>
      bodyPackage(
        vmlBox('Notice to: New address', { left: '90pt', wrap: 'tight' }),
        'The parties hereby agree as follows.',
      ));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('both edits are tracked and the drawing is listed once', async () => {
      expect(result.unrepresentedChanges?.map((change) => change.scope)).toEqual(['drawing']);
      await assertDocumentedProjections(original, revised, result.document, 'word/document.xml');
    });
  });

  for (const [label, drawing, placement] of [
    ['extent', { width: '3302000' }, 'anchor'],
    ['horizontal position', { left: '1143000' }, 'anchor'],
    ['wrap', { wrap: 'wrapTopAndBottom' }, 'anchor'],
    ['inline extent', { width: '3302000' }, 'inline'],
  ] as const) {
    test(`tracks the text of a Word text box whose DrawingML ${label} changes`, async ({
      given, when, then, and,
    }: AllureBddContext) => {
      const original = await given('a Word text box (DrawingML with a VML fallback)', () =>
        bodyPackage(twinBox('Notice to: Old address', {}, {}, placement)));
      const revised = await given(`the same box with its ${label} changed and its text edited`, () =>
        bodyPackage(twinBox('Notice to: New address', drawing, { width: '260pt' }, placement)));
      const result = await when('the documents are compared', () =>
        compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      const output = await partXml(result.document, 'word/document.xml');

      await then('the edit is tracked in both stored copies, and the drawings are not', () => {
        expect(trackedBoxText(output)).toEqual([
          { deleted: 'Old', inserted: 'New' },
          { deleted: 'Old', inserted: 'New' },
        ]);
        expect(drawingsUntracked(output)).toBe(true);
      });
      await and('the one visual box is listed once, by its DrawingML name', () => {
        expect(result.unrepresentedChanges).toEqual([{
          scope: 'drawing',
          kind: 'changed',
          sectionIndex: 0,
          drawing: { story: 'body', partPath: 'word/document.xml', index: 0, element: 'drawing', name: 'Text Box 1' },
        }]);
      });
      await and('the projections are the documented ones', () =>
        assertDocumentedProjections(original, revised, result.document, 'word/document.xml'));
    });
  }

  test('tracks the text of a box whose drawing differs only in editing-session ids, listing nothing', async ({
    given, when, then,
  }: AllureBddContext) => {
    // Word rewrites wp14:anchorId/wp14:editId and o:spid without changing
    // what a reader sees. The revised drawing is carried so the text is still
    // tracked inside the box, but there is no shape change to list.
    const withSessionIds = (box: string, anchorId: string, spid: string): string =>
      box.replace('<wp:anchor ', `<wp:anchor wp14:anchorId="${anchorId}" wp14:editId="${anchorId}" `)
        .replace('o:spid="_x0000_s1026"', `o:spid="${spid}"`);
    const namespaces = { ...NAMESPACES, wp14: 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing' };
    const build = (box: string): Promise<Buffer> => buildDocxFromBodyXml(
      paragraph('The parties agree as follows.') + anchored(box),
      [],
      { namespaces, ignorablePrefixes: ['wps', 'wp14'] },
    );
    const original = await given('a Word text box', () =>
      build(withSessionIds(twinBox('Notice to: Old address'), '1A2B3C4D', '_x0000_s1026')));
    const revised = await given('the box edited, with new editing-session ids', () =>
      build(withSessionIds(twinBox('Notice to: New address'), '5E6F7A8B', '_x0000_s1040')));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    const output = await partXml(result.document, 'word/document.xml');

    await then('the edit is tracked inside the box and nothing is listed', async () => {
      expect(trackedBoxText(output)).toEqual([
        { deleted: 'Old', inserted: 'New' },
        { deleted: 'Old', inserted: 'New' },
      ]);
      expect(drawingsUntracked(output)).toBe(true);
      expect(result.unrepresentedChanges).toBeUndefined();
      const originalView = readerView(await partXml(original, 'word/document.xml'));
      const revisedView = readerView(await partXml(revised, 'word/document.xml'));
      expect(readerView(acceptAllChanges(output))).toEqual(revisedView);
      expect(readerView(rejectAllChanges(output))).toEqual({ ...originalView, drawings: revisedView.drawings });
      await assertSchema(result.document);
    });
  });

  test('control: a resized body box with unchanged text keeps its native redline', async ({
    given, when, then,
  }: AllureBddContext) => {
    // No text to track inside the box: the outer comparison tracks the old
    // drawing as deleted and the new one as inserted, so Reject All restores
    // the original shape and nothing is listed. Pictures resize the same way.
    for (const [original, revised] of [
      [vmlBox('Notice to: Old address'), vmlBox('Notice to: Old address', { width: '260pt' })],
      [twinBox('Notice to: Old address'), twinBox('Notice to: Old address', { width: '3302000' }, { width: '260pt' })],
    ]) {
      const originalPackage = await given('a body text box', () => bodyPackage(original!));
      const revisedPackage = await given('the same box resized only', () => bodyPackage(revised!));
      const result = await when('the documents are compared', () =>
        compareDocumentsAtomizer(originalPackage, revisedPackage, COMPARE_OPTIONS));
      await then('the replaced box is redlined exactly and nothing is listed', async () => {
        const output = await partXml(result.document, 'word/document.xml');
        expect(result.unrepresentedChanges).toBeUndefined();
        expect(drawingsUntracked(output)).toBe(false);
        const originalView = readerView(await partXml(originalPackage, 'word/document.xml'));
        const revisedView = readerView(await partXml(revisedPackage, 'word/document.xml'));
        expect(readerView(acceptAllChanges(output))).toEqual(revisedView);
        expect(readerView(rejectAllChanges(output))).toEqual(originalView);
        expect(readerView(await docxCorePart(result.document, 'accept', 'word/document.xml'))).toEqual(revisedView);
        expect(readerView(await docxCorePart(result.document, 'reject', 'word/document.xml'))).toEqual(originalView);
        await assertSchema(result.document);
      });
    }
  });

  test('control: a drawing naming a relationship the original lacks stays a native replacement', async ({
    given, when, then,
  }: AllureBddContext) => {
    // The original side cannot carry a drawing whose relationship id it does
    // not declare, so the box is not aligned: the outer comparison replaces
    // the whole box natively, and the drawing is not listed.
    const original = await given('a VML box', () => bodyPackage(vmlBox('Notice to: Old address')));
    const revised = await given('the box resized, edited and filled from a new relationship', async () => {
      const archive = await DocxArchive.load(await bodyPackage(
        vmlBox('Notice to: New address', { width: '260pt' })
          .replace('<w10:wrap', '<v:fill r:id="rIdFill" type="frame"/><w10:wrap'),
      ));
      archive.setFile(
        'word/_rels/document.xml.rels',
        `<Relationships xmlns="${PKG_NS}"><Relationship Id="rIdFill"` +
          ` Type="${R_NS}/image" Target="https://example.com/fill.png" TargetMode="External"/></Relationships>`,
      );
      return archive.save();
    });
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the box is tracked as replaced and nothing is listed', async () => {
      const output = await partXml(result.document, 'word/document.xml');
      expect(result.unrepresentedChanges).toBeUndefined();
      expect(drawingsUntracked(output)).toBe(false);
      expect(readerView(acceptAllChanges(output)).boxes).toEqual(['Notice to: New address']);
      expect(readerView(rejectAllChanges(output)).boxes).toEqual(['Notice to: Old address']);
      expect(readerView(rejectAllChanges(output)).drawings).toEqual(
        readerView(await partXml(original, 'word/document.xml')).drawings,
      );
    });
  });

  test('control: a grouped box keeps its native replacement, so a sibling resize is not hidden', async ({
    given, when, then,
  }: AllureBddContext) => {
    // A VML group draws several boxes in one w:pict. Carrying the revised
    // group around box A would also carry box B's resize, which a note naming
    // A would not disclose; the group stays a native replacement instead.
    const member = (id: string, text: string, width: string): string =>
      `<v:shape id="${id}" style="width:${width};height:50pt"><v:textbox>${story(text)}</v:textbox></v:shape>`;
    const group = (a: string, b: string): string =>
      `<w:r><w:pict><v:group id="group1" style="width:400pt;height:100pt" coordsize="400,100">${a}${b}</v:group></w:pict></w:r>`;
    const rectangle = (width: string): string => `<v:rect id="b" style="width:${width};height:50pt"/>`;
    for (const [originalGroup, revisedGroup] of [
      // Box B resized only, beside edited and widened box A.
      [group(member('a', 'Old A', '200pt'), member('b', 'Same B', '200pt')),
        group(member('a', 'New A', '260pt'), member('b', 'Same B', '300pt'))],
      // A plain rectangle resized beside a box whose text alone changed.
      [group(member('a', 'Old A', '200pt'), rectangle('100pt')),
        group(member('a', 'New A', '200pt'), rectangle('180pt'))],
    ]) {
      const original = await given('a group holding a box and another shape', () => bodyPackage(originalGroup!));
      const revised = await given('the box edited and the other shape resized', () => bodyPackage(revisedGroup!));
      const result = await when('the documents are compared', () =>
        compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

      await then('the group is tracked as replaced and Reject All restores every shape', async () => {
        const output = await partXml(result.document, 'word/document.xml');
        expect(result.unrepresentedChanges).toBeUndefined();
        expect(drawingsUntracked(output)).toBe(false);
        const originalView = readerView(await partXml(original, 'word/document.xml'));
        const revisedView = readerView(await partXml(revised, 'word/document.xml'));
        expect(readerView(acceptAllChanges(output))).toEqual(revisedView);
        expect(readerView(rejectAllChanges(output))).toEqual(originalView);
        expect(readerView(await docxCorePart(result.document, 'reject', 'word/document.xml'))).toEqual(originalView);
        await assertSchema(result.document);
      });
    }
  });

  test('control: a DrawingML drawing with a second anchored shape keeps its native replacement', async ({
    given, when, then,
  }: AllureBddContext) => {
    // Only the rectangle in the drawing's second wp:anchor is resized.
    // Carrying the revised drawing would hide that resize behind a note
    // naming the box.
    const original = await given('a drawing with a text box and a rectangle', () =>
      bodyPackage(twoAnchors('Notice to: Old address', '1270000')));
    const revised = await given('the box edited and the rectangle resized', () =>
      bodyPackage(twoAnchors('Notice to: New address', '2540000')));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the drawing is tracked as replaced and Reject All restores the rectangle', async () => {
      const output = await partXml(result.document, 'word/document.xml');
      expect(result.unrepresentedChanges).toBeUndefined();
      const originalView = readerView(await partXml(original, 'word/document.xml'));
      expect(readerView(rejectAllChanges(output))).toEqual(originalView);
      expect(readerView(await docxCorePart(result.document, 'reject', 'word/document.xml'))).toEqual(originalView);
      expect(readerView(acceptAllChanges(output))).toEqual(readerView(await partXml(revised, 'word/document.xml')));
    });
  });

  test('control: a changed shape template another box shares keeps its native replacement', async ({
    given, when, then,
  }: AllureBddContext) => {
    // The template in the edited box's drawing also shapes the second box.
    // Carrying it would reshape that box behind a note naming the first.
    const original = await given('two boxes sharing a rectangle template', () =>
      bodyPackage(sharedTemplateBoxes('Notice to: Old address', RECTANGLE_PATH)));
    const revised = await given('the first box edited and the template made a triangle', () =>
      bodyPackage(sharedTemplateBoxes('Notice to: New address', TRIANGLE_PATH)));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the drawing is tracked as replaced and Reject All restores the template', async () => {
      const output = await partXml(result.document, 'word/document.xml');
      expect(result.unrepresentedChanges).toBeUndefined();
      const templatePaths = (xml: string): string[] =>
        Array.from(parseXml(xml).getElementsByTagNameNS(NAMESPACES.v, 'shapetype'))
          .map((template) => template.getAttribute('path') ?? '');
      expect(templatePaths(rejectAllChanges(output))).toEqual([RECTANGLE_PATH]);
      expect(templatePaths(await docxCorePart(result.document, 'reject', 'word/document.xml')))
        .toEqual([RECTANGLE_PATH]);
      expect(templatePaths(acceptAllChanges(output))).toEqual([TRIANGLE_PATH]);
    });
  });

  test('tracks a nested box whose drawing and text change inside an edited box', async ({
    given, when, then,
  }: AllureBddContext) => {
    const outer = (outerText: string, inner: string): string =>
      `<w:r><w:pict><v:shape id="outer1" o:spid="_x0000_s1030" style="width:300pt;height:120pt">` +
      `<v:textbox><w:txbxContent><w:p><w:r><w:t xml:space="preserve">${outerText}</w:t></w:r>${inner}</w:p>` +
      `</w:txbxContent></v:textbox></v:shape></w:pict></w:r>`;
    const original = await given('a box holding a nested box', () =>
      bodyPackage(outer('Outer old', vmlBox('Inner old'))));
    const revised = await given('both texts edited and the nested box resized', () =>
      bodyPackage(outer('Outer new', vmlBox('Inner new', { width: '150pt' }))));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    const output = await partXml(result.document, 'word/document.xml');

    await then('both stories are tracked and only the nested drawing is listed', () => {
      expect(trackedBoxText(output)[1]).toEqual({ deleted: 'old', inserted: 'new' });
      expect(drawingsUntracked(output)).toBe(true);
      expect(result.unrepresentedChanges).toEqual([expect.objectContaining({
        scope: 'drawing',
        drawing: expect.objectContaining({ index: 1, element: 'pict', name: 'box1' }),
      })]);
      expect(readerView(acceptAllChanges(output)).boxes).toEqual(['Outer newInner new', 'Inner new']);
      expect(readerView(rejectAllChanges(output)).boxes).toEqual(['Outer oldInner old', 'Inner old']);
    });
  });

  for (const [label, original, revised] of [
    ['VML', vmlBox('Footer notice: Old'), vmlBox('Footer notice: New', { width: '260pt' })],
    [
      'Word (DrawingML with VML fallback)',
      twinBox('Footer notice: Old'),
      twinBox('Footer notice: New', { width: '3302000', wrap: 'wrapTopAndBottom' }, { width: '260pt' }),
    ],
  ] as const) {
    test(`tracks the text of a resized ${label} footer box and lists the drawing, not the footer`, async ({
      given, when, then, and,
    }: AllureBddContext) => {
      const originalPackage = await given(`a ${label} footer text box`, () => footerPackage(original));
      const revisedPackage = await given('the footer box resized and edited, plus a body edit', () =>
        footerPackage(revised, 'The parties hereby agree as follows.'));
      const result = await when('the documents are compared', () =>
        compareDocumentsAtomizer(originalPackage, revisedPackage, COMPARE_OPTIONS));
      const footer = await partXml(result.document, 'word/footer1.xml');

      await then('the footer edit is tracked inside the box and the drawing is untracked', () => {
        for (const box of trackedBoxText(footer)) expect(box).toEqual({ deleted: 'Old', inserted: 'New' });
        expect(drawingsUntracked(footer)).toBe(true);
      });
      await and('one drawing entry replaces the footer entry', () => {
        expect(result.unrepresentedChanges).toEqual([expect.objectContaining({
          scope: 'drawing',
          kind: 'changed',
          sectionIndex: 0,
          role: 'default',
          drawing: expect.objectContaining({ story: 'footer', partPath: 'word/footer1.xml', index: 0 }),
        })]);
      });
      await and('the footer and body projections are the documented ones', async () => {
        await assertDocumentedProjections(originalPackage, revisedPackage, result.document, 'word/footer1.xml');
        const body = await partXml(result.document, 'word/document.xml');
        expect(readerView(acceptAllChanges(body)).text).toBe('The parties hereby agree as follows.Notice block');
        expect(readerView(rejectAllChanges(body)).text).toBe('The parties agree as follows.Notice block');
      });
    });
  }

  test('lists a footer drawing-only change beside an unrelated header change without refusing', async ({
    given, when, then,
  }: AllureBddContext) => {
    // The header holds a plain VML rectangle (no text box) that is resized:
    // a header change the redline does not carry, listed as before. The
    // footer drawing entry must not pull the whole-package projection check
    // in and refuse the comparison over it.
    const withHeader = async (footerBox: string, rectWidth: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(await footerPackage(footerBox));
      archive.setDocumentXml((await archive.getDocumentXml()).replace(
        '<w:sectPr>',
        '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/>',
      ));
      archive.setFile('word/_rels/document.xml.rels', (await archive.getFile('word/_rels/document.xml.rels'))!.replace(
        '</Relationships>',
        `<Relationship Id="rIdHeader" Type="${R_NS}/header" Target="header1.xml"/></Relationships>`,
      ));
      archive.setFile(
        'word/header1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W_NS}" xmlns:v="${NAMESPACES.v}">` +
          `<w:p><w:r><w:pict><v:rect id="rect1" style="width:${rectWidth};height:50pt"/></w:pict></w:r></w:p></w:hdr>`,
      );
      archive.setFile('[Content_Types].xml', (await archive.getFile('[Content_Types].xml'))!.replace(
        '</Types>',
        '<Override PartName="/word/header1.xml"' +
          ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>',
      ));
      return archive.save();
    };
    const original = await given('a footer box and a header rectangle', () =>
      withHeader(vmlBox('Footer notice'), '100pt'));
    const revised = await given('the footer box and the header rectangle both resized', () =>
      withHeader(vmlBox('Footer notice', { width: '260pt' }), '150pt'));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the footer drawing and the header are each listed once', () => {
      expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
        expect.objectContaining({ scope: 'header', kind: 'changed', sectionIndex: 0, role: 'default' }),
        expect.objectContaining({
          scope: 'drawing',
          drawing: expect.objectContaining({ story: 'footer', partPath: 'word/footer1.xml' }),
        }),
      ]));
      expect(result.unrepresentedChanges).toHaveLength(2);
    });
  });

  test('keeps the footer entry when a footer group resizes a shape beside its edited box', async ({
    given, when, then,
  }: AllureBddContext) => {
    // The drawing entry names the box; the resized rectangle beside it is
    // geometry that entry does not describe, so the footer stays listed too.
    const group = (text: string, rectWidth: string): string =>
      `<w:r><w:pict><v:group id="group1" style="width:400pt;height:100pt" coordsize="400,100">` +
      `<v:shape id="a" style="width:200pt;height:50pt"><v:textbox>${story(text)}</v:textbox></v:shape>` +
      `<v:rect id="b" style="width:${rectWidth};height:50pt"/></v:group></w:pict></w:r>`;
    const original = await given('a footer group of a box and a rectangle', () =>
      footerPackage(group('Footer notice: Old', '100pt')));
    const revised = await given('the box edited and the rectangle resized', () =>
      footerPackage(group('Footer notice: New', '180pt')));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the drawing and the footer are both listed, and the edit is tracked', async () => {
      expect(result.unrepresentedChanges?.map((change) => change.scope).sort()).toEqual(['drawing', 'footer']);
      expect(trackedBoxText(await partXml(result.document, 'word/footer1.xml')))
        .toEqual([{ deleted: 'Old', inserted: 'New' }]);
    });
  });

  test('tracks an ordinary footer edit beside a group that resizes a shape, keeping the footer entry', async ({
    given, when, then,
  }: AllureBddContext) => {
    // The ordinary text is compared against the original with the group's
    // drawing aligned (#1448); the resized rectangle is still geometry the
    // drawing entry does not describe, so the footer stays listed.
    const footer = (prefix: 'Old' | 'New', rectWidth: string): string =>
      `<w:r><w:pict><v:group id="group1" style="width:400pt;height:100pt" coordsize="400,100">` +
      `<v:shape id="a" style="width:200pt;height:50pt"><v:textbox>${story(`Footer notice: ${prefix}`)}</v:textbox></v:shape>` +
      `<v:rect id="b" style="width:${rectWidth};height:50pt"/></v:group></w:pict></w:r>` +
      `<w:r><w:t xml:space="preserve">${prefix} ordinary</w:t></w:r>`;
    const original = await given('a footer group of a box and a rectangle, and ordinary text', () =>
      footerPackage(footer('Old', '100pt')));
    const revised = await given('the box and the ordinary text edited, the rectangle resized', () =>
      footerPackage(footer('New', '180pt')));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('both edits are tracked, and the drawing and the footer are listed', async () => {
      expect(result.unrepresentedChanges?.map((change) => change.scope).sort()).toEqual(['drawing', 'footer']);
      expect(trackedBoxText(await partXml(result.document, 'word/footer1.xml')))
        .toEqual([{ deleted: 'Old', inserted: 'New' }]);
      await assertDocumentedProjections(original, revised, result.document, 'word/footer1.xml');
    });
  });

  test('keeps the footer entry when a footer drawing resizes a second anchored shape', async ({
    given, when, then,
  }: AllureBddContext) => {
    const original = await given('a footer drawing with a text box and a rectangle', () =>
      footerPackage(twoAnchors('Footer notice: Old', '1270000')));
    const revised = await given('the box edited and the rectangle resized', () =>
      footerPackage(twoAnchors('Footer notice: New', '2540000')));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the footer stays listed', () => {
      expect(result.unrepresentedChanges?.map((change) => change.scope)).toContain('footer');
    });
  });

  test('keeps the footer entry when a footer box changes a shape template another box shares', async ({
    given, when, then,
  }: AllureBddContext) => {
    const original = await given('two footer boxes sharing a rectangle template', () =>
      footerPackage(sharedTemplateBoxes('Footer notice: Old', RECTANGLE_PATH)));
    const revised = await given('the first box edited and the template made a triangle', () =>
      footerPackage(sharedTemplateBoxes('Footer notice: New', TRIANGLE_PATH)));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the footer stays listed', () => {
      expect(result.unrepresentedChanges?.map((change) => change.scope)).toContain('footer');
    });
  });

  test('lists a footer box whose drawing alone changes', async ({
    given, when, then,
  }: AllureBddContext) => {
    // A footer story is spliced into the revised footer, which cannot track a
    // replaced drawing; the drawing entry names the box instead of the
    // generic footer entry.
    const original = await given('a VML footer box', () => footerPackage(vmlBox('Footer notice')));
    const revised = await given('the footer box resized only', () =>
      footerPackage(vmlBox('Footer notice', { width: '260pt', wrap: 'none' })));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('exactly one drawing entry is reported and the footer reads as revised', async () => {
      expect(result.unrepresentedChanges).toEqual([{
        scope: 'drawing',
        kind: 'changed',
        sectionIndex: 0,
        role: 'default',
        drawing: { story: 'footer', partPath: 'word/footer1.xml', index: 0, element: 'pict', name: 'box1' },
      }]);
      expect(formatUnrepresentedChangeWarnings(result.unrepresentedChanges)[0]).toContain(
        'changed drawing (text box or picture size, position or wrap) "box1" (w:pict, text box #1) ' +
          'in the default footer (word/footer1.xml)',
      );
      await assertDocumentedProjections(original, revised, result.document, 'word/footer1.xml');
    });
  });
});

/**
 * The text a LibreOffice text frame shows, and its width, per frame of an ODT
 * export. Each source and projection passes through the same import and
 * export.
 */
async function odtFrames(odt: Buffer): Promise<Array<{ width: string; text: string }>> {
  const zip = await JSZip.loadAsync(odt);
  const content = parseXml(await zip.file('content.xml')!.async('string'));
  const DRAW_NS = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
  const SVG_NS = 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0';
  const frames = [
    ...Array.from(content.getElementsByTagNameNS(DRAW_NS, 'frame')),
    ...Array.from(content.getElementsByTagNameNS(DRAW_NS, 'custom-shape')),
  ];
  return frames
    .filter((frame) => (frame.textContent ?? '').includes('Notice to'))
    .map((frame) => ({ width: frame.getAttributeNS(SVG_NS, 'width') ?? '', text: frame.textContent ?? '' }));
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice.
const reader = process.env.SAFE_DOCX_TEXT_BOX_DRAWING_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice reads a resized, edited text box as documented (#1382)', () => {
  test('accepts to the revised text and shape, rejects to the original text in the revised shape', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const cases: Array<{ original: Buffer; revised: Buffer; compared: Buffer }> = [];
    for (const [original, revised] of [
      [vmlBox('Notice to: Old address'), vmlBox('Notice to: New address', { width: '260pt' })],
      [
        twinBox('Notice to: Old address'),
        twinBox('Notice to: New address', { width: '3302000' }, { width: '260pt' }),
      ],
    ]) {
      const originalPackage = await bodyPackage(original!);
      const revisedPackage = await bodyPackage(revised!);
      const result = await compareDocumentsAtomizer(originalPackage, revisedPackage, COMPARE_OPTIONS);
      cases.push({ original: originalPackage, revised: revisedPackage, compared: result.document });
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
    for (let index = 0; index < cases.length; index++) {
      const [original, revised, accepted, rejected] = await Promise.all(
        packages.slice(index * 4, index * 4 + 4).map(odtFrames),
      );
      expect(original).toHaveLength(1);
      expect(original![0]!.width).not.toBe(revised![0]!.width);
      expect(accepted).toEqual(revised);
      expect(rejected).toEqual([{ width: revised![0]!.width, text: original![0]!.text }]);
    }
  }, 600_000);
});
