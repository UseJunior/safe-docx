/**
 * A changed text box may hold a picture, an embedded object or another text
 * box. The text edit is tracked inside the box; the picture or object is
 * carried as an atomic leaf (a changed one is a tracked deletion plus
 * insertion of its run), and a nested box is compared as a story of its own.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.11
 * @conformance ECMA-376 edition 5, Part 1 § 20.4.2.38
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @see https://github.com/UseJunior/safe-docx/issues/1380
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
import { compareDocumentsAtomizer } from './pipeline.js';
import { UnsupportedTextBoxRevisionError } from './textBoxRevisionSafety.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'In-Place Reconstruction',
    story: 'Text-Box Atomic Leaves',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 4, section: '14.9.1.1' },
    { spec: 'ECMA-376', edition: 5, part: 4, section: '19.1.2.11' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '20.4.2.38' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
  );

const W_NS = OOXML.W_NS;
const VML_NS = 'urn:schemas-microsoft-com:vml';
const OFFICE_NS = 'urn:schemas-microsoft-com:office:office';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NAMESPACES = {
  v: VML_NS,
  o: OFFICE_NS,
  r: R_NS,
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: DRAWING_NS,
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
} as const;
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-11T00:00:00.000Z') };
/** A 1×1 PNG, so the picture relationship resolves to a real image part. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);
// Multi-story round trips: well inside 5s alone, slower under a parallel suite.
const LOAD_SENSITIVE_TIMEOUT_MS = 30_000;

const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

/** A VML picture; `relid` names the image through `o:relid` instead of `r:id`. */
function vmlPicture(
  { size = '20pt', relationshipId = 'rIdImage', relid = false } = {},
): string {
  const reference = relid ? `o:relid="${relationshipId}"` : `r:id="${relationshipId}"`;
  return (
    `<w:r><w:pict><v:shape id="picture1" style="width:${size};height:${size}">` +
    `<v:imagedata ${reference} o:title=""/></v:shape></w:pict></w:r>`
  );
}

/** An embedded OLE object with its VML preview image. */
const EMBEDDED_OBJECT =
  `<w:r><w:object w:dxaOrig="400" w:dyaOrig="400">` +
  `<v:shape id="object1" style="width:20pt;height:20pt"><v:imagedata r:id="rIdImage" o:title=""/></v:shape>` +
  `<o:OLEObject Type="Embed" ProgID="Package" ShapeID="object1" DrawAspect="Icon" ObjectID="_1" r:id="rIdObject"/>` +
  `</w:object></w:r>`;

function drawingPicture(cx = '100000'): string {
  return (
    `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cx}"/>` +
    `<wp:docPr id="7" name="Picture 7"/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="7" name="Picture 7"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rIdImage"/></pic:blipFill><pic:spPr/></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

/** A VML text box hosting `paragraphsXml`, in a run. */
function vmlTextBoxRun(paragraphsXml: string, shapeId: string, spid: string): string {
  return (
    `<w:r><w:pict><v:shape id="${shapeId}" o:spid="${spid}" style="width:200pt;height:80pt">` +
    `<v:textbox><w:txbxContent>${paragraphsXml}</w:txbxContent></v:textbox>` +
    `</v:shape></w:pict></w:r>`
  );
}

/** A nested VML text box with one paragraph, in a run. */
const nestedBox = (text: string): string =>
  vmlTextBoxRun(`<w:p>${run(text)}</w:p>`, 'nestedBox', '_x0000_s1099');

/** A body paragraph anchoring one VML text box whose single paragraph is `storyXml`. */
const bodyWithBox = (storyXml: string, bodyText = 'Body'): string =>
  `<w:p>${run(bodyText)}</w:p>` +
  `<w:p>${vmlTextBoxRun(
    `<w:p w14:paraId="20000001" w14:textId="20000001">${storyXml}</w:p>`,
    'box1',
    '_x0000_s1026',
  )}</w:p>`;

/** Word's own text box: DrawingML in `mc:Choice`, VML in `mc:Fallback`. */
const bodyWithTwinBox = (choiceStoryXml: string, fallbackStoryXml: string): string =>
  `<w:p>${run('Body')}</w:p>` +
  `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline>` +
  `<wp:extent cx="2000000" cy="500000"/><wp:docPr id="1" name="Box 1"/>` +
  `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
  `<wps:wsp><wps:txbx><w:txbxContent><w:p>${choiceStoryXml}</w:p></w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>` +
  `</a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice>` +
  `<mc:Fallback><w:pict><v:shape id="box1" o:spid="_x0000_s1026" style="width:200pt;height:80pt">` +
  `<v:textbox><w:txbxContent><w:p>${fallbackStoryXml}</w:p></w:txbxContent></v:textbox>` +
  `</v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;

/** A package holding `bodyXml` plus an image part (and an OLE part) it may reference. */
async function packageWith(
  bodyXml: string,
  imageTarget = 'media/image1.png',
  { image = Buffer.from(PNG, 'base64'), embedding = Buffer.from('ole') } = {},
): Promise<Buffer> {
  const archive = await DocxArchive.load(
    await buildDocxFromBodyXml(bodyXml, [], { namespaces: NAMESPACES, ignorablePrefixes: [] }),
  );
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      `<Relationship Id="rIdImage" Type="${R_NS}/image" Target="${imageTarget}"/>` +
      `<Relationship Id="rIdObject" Type="${R_NS}/oleObject" Target="embeddings/oleObject1.bin"/>` +
      `</Relationships>`,
  );
  archive.setFile(`word/${imageTarget}`, image);
  archive.setFile('word/embeddings/oleObject1.bin', embedding);
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace(
    '<Default Extension="xml"',
    '<Default Extension="png" ContentType="image/png"/>' +
      '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>' +
      '<Default Extension="xml"',
  ));
  return archive.save();
}

/** A package whose default footer holds `footerBodyXml`, with an image part beside it. */
async function packageWithFooter(footerBodyXml: string): Promise<Buffer> {
  const archive = await DocxArchive.load(
    await buildDocxFromBodyXml(`<w:p>${run('Body')}</w:p>`, [], { namespaces: NAMESPACES }),
  );
  archive.setDocumentXml((await archive.getDocumentXml()).replace(
    '<w:sectPr/>',
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>',
  ));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      `<Relationship Id="rIdFooter" Type="${R_NS}/footer" Target="footer1.xml"/></Relationships>`,
  );
  archive.setFile(
    'word/footer1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:ftr xmlns:w="${W_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"` +
      ` xmlns:r="${R_NS}" xmlns:v="${VML_NS}" xmlns:o="${OFFICE_NS}">${footerBodyXml}</w:ftr>`,
  );
  archive.setFile(
    'word/_rels/footer1.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      `<Relationship Id="rIdImage" Type="${R_NS}/image" Target="media/image1.png"/></Relationships>`,
  );
  archive.setFile('word/media/image1.png', Buffer.from(PNG, 'base64'));
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes
    .replace('<Default Extension="xml"', '<Default Extension="png" ContentType="image/png"/><Default Extension="xml"')
    .replace('</Types>', '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'));
  return archive.save();
}

async function footerXmlOf(buffer: Buffer, project: (xml: string) => string = (xml) => xml): Promise<Document> {
  return parseXml(project((await (await DocxArchive.load(buffer)).getFile('word/footer1.xml'))!));
}

function nearestParagraph(node: Node): Element | null {
  for (let current = node.parentNode; current; current = current.parentNode) {
    const element = current as Element;
    if (current.nodeType === 1 && element.namespaceURI === W_NS && element.localName === 'p') {
      return element;
    }
  }
  return null;
}

/**
 * What a reader sees, independent of run splitting: every paragraph's own
 * text (a nested box's paragraphs are their own entries), any leftover
 * deleted text, and every picture or object with its size and the image part
 * its relationship resolves to.
 */
function readerView(documentXml: string, relationshipsXml: string): string[] {
  const document = parseXml(documentXml);
  const targets = new Map(
    Array.from(parseXml(relationshipsXml).getElementsByTagNameNS(PKG_NS, 'Relationship'))
      .map((relationship) => [relationship.getAttribute('Id'), relationship.getAttribute('Target')]),
  );
  const view: string[] = [];
  for (const paragraph of Array.from(document.getElementsByTagNameNS(W_NS, 'p'))) {
    const own = (localName: string): string =>
      Array.from(paragraph.getElementsByTagNameNS(W_NS, localName))
        .filter((text) => nearestParagraph(text) === paragraph)
        .map((text) => text.textContent ?? '')
        .join('');
    view.push(`p:${own('t')}${own('delText') ? ` del:${own('delText')}` : ''}`);
  }
  for (const image of Array.from(document.getElementsByTagNameNS(VML_NS, 'imagedata'))) {
    const id = image.getAttributeNS(R_NS, 'id') || image.getAttributeNS(OFFICE_NS, 'relid');
    const shape = image.parentNode as Element;
    view.push(`vml:${shape.getAttribute('id')}:${shape.getAttribute('style')}:${targets.get(id)}`);
  }
  for (const blip of Array.from(document.getElementsByTagNameNS(DRAWING_NS, 'blip'))) {
    view.push(`blip:${targets.get(blip.getAttributeNS(R_NS, 'embed'))}`);
  }
  for (const extent of Array.from(document.getElementsByTagNameNS(NAMESPACES.wp, 'extent'))) {
    view.push(`extent:${extent.getAttribute('cx')}`);
  }
  view.push(`objects:${document.getElementsByTagNameNS(W_NS, 'object').length}`);
  view.push(`boxes:${document.getElementsByTagNameNS(W_NS, 'txbxContent').length}`);
  return view;
}

async function packageView(buffer: Buffer, project: (xml: string) => string = (xml) => xml): Promise<string[]> {
  const archive = await DocxArchive.load(buffer);
  return readerView(
    project(await archive.getDocumentXml()),
    (await archive.getFile('word/_rels/document.xml.rels'))!,
  );
}

async function docxCoreView(buffer: Buffer, mode: 'accept' | 'reject'): Promise<string[]> {
  const document = await DocxDocument.load(buffer);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return packageView((await document.toBuffer()).buffer);
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1380-'));
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
 * Accept All reproduces the revised document and Reject All the original,
 * through the comparison's acceptor and through docx-core's, and the output
 * passes the emitted-document schema gate.
 */
async function assertFaithfulRedline(original: Buffer, revised: Buffer, compared: Buffer): Promise<void> {
  const revisedView = await packageView(revised);
  const originalView = await packageView(original);
  expect(await packageView(compared, acceptAllChanges)).toEqual(revisedView);
  expect(await packageView(compared, rejectAllChanges)).toEqual(originalView);
  expect(await docxCoreView(compared, 'accept')).toEqual(revisedView);
  expect(await docxCoreView(compared, 'reject')).toEqual(originalView);
  await assertSchema(compared);
}

async function documentXmlOf(buffer: Buffer): Promise<Document> {
  return parseXml(await (await DocxArchive.load(buffer)).getDocumentXml());
}

function isInside(element: Element, localNames: readonly string[], stopAt?: Element): boolean {
  for (let current = element.parentNode; current && current !== stopAt; current = current.parentNode) {
    const candidate = current as Element;
    if (current.nodeType === 1 && candidate.namespaceURI === W_NS && localNames.includes(candidate.localName)) {
      return true;
    }
  }
  return false;
}

/** Text inside `w:ins` (inserted) and `w:delText` (deleted) under `root`. */
function trackedText(root: Element): { inserted: string; deleted: string } {
  const inserted = Array.from(root.getElementsByTagNameNS(W_NS, 't'))
    .filter((text) => isInside(text, ['ins'], root))
    .map((text) => text.textContent ?? '')
    .join('');
  const deleted = Array.from(root.getElementsByTagNameNS(W_NS, 'delText'))
    .map((text) => text.textContent ?? '')
    .join('');
  return { inserted, deleted };
}

/** The stored copies of the outermost box, and the boxes nested in it. */
function boxes(document: Document): Element[] {
  return Array.from(document.getElementsByTagNameNS(W_NS, 'txbxContent'));
}

/** Every revision id in the document is used once. */
function expectUniqueRevisionIds(document: Document): void {
  const ids = ['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange', 'pPrChange']
    .flatMap((localName) => Array.from(document.getElementsByTagNameNS(W_NS, localName)))
    .map((element) => element.getAttributeNS(W_NS, 'id'));
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
}

async function compare(originalBody: string, revisedBody: string, revisedImageTarget?: string) {
  const original = await packageWith(originalBody);
  const revised = await packageWith(revisedBody, revisedImageTarget);
  return { original, revised, compare: () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS) };
}

describe('Text-box stories holding pictures, objects and nested boxes (#1380)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  test('tracks a text edit in a box holding a VML picture and carries the picture untouched', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const fixture = await given('a VML text box holding a picture, whose text changes', () =>
      compare(bodyWithBox(run('Box old') + vmlPicture()), bodyWithBox(run('Box new') + vmlPicture())));
    const result = await when('the documents are compared', fixture.compare);
    const document = await documentXmlOf(result.document);

    await then('the text edit is tracked inside the box and the picture is not', () => {
      const [box] = boxes(document);
      expect(trackedText(box!)).toEqual({ inserted: 'new', deleted: 'old' });
      const picture = Array.from(box!.getElementsByTagNameNS(W_NS, 'pict'));
      expect(picture).toHaveLength(1);
      expect(isInside(picture[0]!, ['ins', 'del'])).toBe(false);
      expect(result.unrepresentedChanges ?? []).toEqual([]);
    });
    await and('accept and reject reproduce the two documents', () =>
      assertFaithfulRedline(fixture.original, fixture.revised, result.document));
  });

  test('tracks a text edit in a box holding an embedded object', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const fixture = await given('a VML text box holding an OLE object, whose text changes', () =>
      compare(bodyWithBox(run('Box old') + EMBEDDED_OBJECT), bodyWithBox(run('Box new') + EMBEDDED_OBJECT)));
    const result = await when('the documents are compared', fixture.compare);
    const document = await documentXmlOf(result.document);

    await then('the text edit is tracked and the object is carried as one untracked leaf', () => {
      const [box] = boxes(document);
      expect(trackedText(box!)).toEqual({ inserted: 'new', deleted: 'old' });
      const objects = Array.from(box!.getElementsByTagNameNS(W_NS, 'object'));
      expect(objects).toHaveLength(1);
      expect(isInside(objects[0]!, ['ins', 'del'])).toBe(false);
    });
    await and('accept and reject reproduce the two documents', () =>
      assertFaithfulRedline(fixture.original, fixture.revised, result.document));
  });

  test('tracks both stored copies of a Word text box holding a picture', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const fixture = await given('an mc:AlternateContent box: DrawingML picture in Choice, VML picture in Fallback', () =>
      compare(
        bodyWithTwinBox(run('Box old') + drawingPicture(), run('Box old') + vmlPicture()),
        bodyWithTwinBox(run('Box new') + drawingPicture(), run('Box new') + vmlPicture()),
      ));
    const result = await when('the documents are compared', fixture.compare);
    const document = await documentXmlOf(result.document);

    await then('each stored copy carries the tracked edit', () => {
      const copies = boxes(document);
      expect(copies).toHaveLength(2);
      for (const copy of copies) expect(trackedText(copy)).toEqual({ inserted: 'new', deleted: 'old' });
    });
    await and('accept and reject reproduce the two documents', () =>
      assertFaithfulRedline(fixture.original, fixture.revised, result.document));
  });

  test('tracks a resized picture inside a changed box as a deleted and an inserted picture', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const fixture = await given('a box whose text changes and whose VML picture is resized', () =>
      compare(
        bodyWithBox(run('Box old') + vmlPicture()),
        bodyWithBox(run('Box new') + vmlPicture({ size: '40pt' })),
      ));
    const result = await when('the documents are compared', fixture.compare);
    const document = await documentXmlOf(result.document);

    await then('the old picture is a tracked deletion and the new one a tracked insertion', () => {
      const pictures = Array.from(boxes(document)[0]!.getElementsByTagNameNS(VML_NS, 'shape'));
      const placement = pictures.map((shape) =>
        `${isInside(shape, ['del']) ? 'del' : isInside(shape, ['ins']) ? 'ins' : 'kept'}:${shape.getAttribute('style')}`);
      expect(placement).toEqual(['del:width:20pt;height:20pt', 'ins:width:40pt;height:40pt']);
      expect(trackedText(boxes(document)[0]!)).toEqual({ inserted: 'new', deleted: 'old' });
    });
    await and('accept and reject reproduce the two documents', () =>
      assertFaithfulRedline(fixture.original, fixture.revised, result.document));
  });

  test('refuses, rather than loses, a picture swapped through its o:relid relationship', async ({
    given, when, then,
  }: AllureBddContext) => {
    const fixture = await given('a box whose text changes and whose o:relid picture now names another image', () =>
      compare(
        bodyWithBox(run('Box old') + vmlPicture({ relid: true })),
        bodyWithBox(run('Box new') + vmlPicture({ relid: true })),
        'media/image2.png',
      ));
    let failure: unknown;
    await when('the documents are compared', async () => {
      try {
        await fixture.compare();
      } catch (error) {
        failure = error;
      }
    });

    await then('the relationship-closure change is named instead of the swap vanishing', () => {
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect((failure as Error).message).toContain('relationship closure changed');
    });
  });

  for (const [label, storyXml, payload] of [
    ['an embedded object whose binary part was replaced', EMBEDDED_OBJECT, { embedding: Buffer.from('other ole') }],
    ['an r:id picture whose image part was replaced', vmlPicture(), { image: Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from([0])]) }],
    ['an o:relid picture whose image part was replaced', vmlPicture({ relid: true }), { image: Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from([0])]) }],
  ] as const) {
    test(`refuses, rather than loses, ${label} under the same relationship`, async ({
      given, when, then,
    }: AllureBddContext) => {
      const original = await given('a box holding the leaf, with its original part', () =>
        packageWith(bodyWithBox(run('Box old') + storyXml)));
      const revised = await given('the box text edited and the part bytes replaced at the same path', () =>
        packageWith(bodyWithBox(run('Box new') + storyXml), undefined, payload));
      let failure: unknown;
      await when('the documents are compared', async () => {
        try {
          await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
        } catch (error) {
          failure = error;
        }
      });

      await then('the changed part is named instead of being carried untracked', () => {
        expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
        expect((failure as Error).message).toContain('relationship closure changed');
      });
    });
  }

  test('refuses, rather than loses, a chart whose embedded workbook was replaced', async ({
    given, when, then,
  }: AllureBddContext) => {
    const chart =
      `<w:r><w:drawing><wp:inline><wp:extent cx="100000" cy="100000"/><wp:docPr id="8" name="Chart 8"/>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
      `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart"/>` +
      `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    // The chart part and its relationships are identical on both sides; only
    // the workbook the chart reaches through its own relationship differs.
    const withChart = async (text: string, workbook: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(await packageWith(bodyWithBox(run(text) + chart)));
      archive.setFile(
        'word/_rels/document.xml.rels',
        `<Relationships xmlns="${PKG_NS}">` +
          `<Relationship Id="rIdChart" Type="${R_NS}/chart" Target="charts/chart1.xml"/></Relationships>`,
      );
      archive.setFile(
        'word/charts/chart1.xml',
        `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${R_NS}">` +
          `<c:chart><c:plotArea><c:layout/></c:plotArea></c:chart>` +
          `<c:externalData r:id="rIdWorkbook"/></c:chartSpace>`,
      );
      archive.setFile(
        'word/charts/_rels/chart1.xml.rels',
        `<Relationships xmlns="${PKG_NS}">` +
          `<Relationship Id="rIdWorkbook" Type="${R_NS}/package" Target="../embeddings/workbook.xlsx"/></Relationships>`,
      );
      archive.setFile('word/embeddings/workbook.xlsx', Buffer.from(workbook));
      return archive.save();
    };
    const original = await given('a box holding a chart and its embedded workbook', () =>
      withChart('Box old', 'workbook one'));
    const revised = await given('the box text edited and the workbook bytes replaced', () =>
      withChart('Box new', 'workbook two'));
    let failure: unknown;
    await when('the documents are compared', async () => {
      try {
        await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
      } catch (error) {
        failure = error;
      }
    });

    await then('the replaced workbook below the chart is seen', () => {
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect((failure as Error).message).toContain('relationship closure changed');
    });
  });

  // Round-3 review of #1380: the workbook relates back to the chart, closing
  // a cycle, and the document part also relates to the workbook directly. If
  // that direct relationship is fingerprinted first, a per-part memo caches
  // the chart with the workbook cut off as the cycle, and the box's chart
  // closure then misses the replaced workbook. Both orders must refuse.
  // Round-4 review: the chart's own relationship may use a namespace prefix
  // (`<pr:Relationship>`); the closure must still follow it to the workbook.
  for (const workbookFirst of [true, false]) for (const prefixed of [false, true]) {
    test(`refuses a replaced workbook on a relationship cycle (workbook listed ${workbookFirst ? 'first' : 'last'}${prefixed ? ', prefixed chart relationship' : ''})`, async ({
      given, when, then,
    }: AllureBddContext) => {
      const chart =
        `<w:r><w:drawing><wp:inline><wp:extent cx="100000" cy="100000"/><wp:docPr id="8" name="Chart 8"/>` +
        `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
        `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart"/>` +
        `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
      const withCycle = async (text: string, workbook: string): Promise<Buffer> => {
        const archive = await DocxArchive.load(await packageWith(bodyWithBox(run(text) + chart)));
        const workbookRelationship =
          `<Relationship Id="rIdAWorkbook" Type="${R_NS}/package" Target="embeddings/workbook.xlsx"/>`;
        const chartRelationship =
          `<Relationship Id="rIdChart" Type="${R_NS}/chart" Target="charts/chart1.xml"/>`;
        archive.setFile(
          'word/_rels/document.xml.rels',
          `<Relationships xmlns="${PKG_NS}">` +
            (workbookFirst
              ? workbookRelationship + chartRelationship
              : chartRelationship + workbookRelationship) +
            `</Relationships>`,
        );
        archive.setFile(
          'word/charts/chart1.xml',
          `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${R_NS}">` +
            `<c:chart><c:plotArea><c:layout/></c:plotArea></c:chart>` +
            `<c:externalData r:id="rIdWorkbook"/></c:chartSpace>`,
        );
        archive.setFile(
          'word/charts/_rels/chart1.xml.rels',
          prefixed
            ? `<pr:Relationships xmlns:pr="${PKG_NS}">` +
                `<pr:Relationship Id="rIdWorkbook" Type="${R_NS}/package" Target="../embeddings/workbook.xlsx"/></pr:Relationships>`
            : `<Relationships xmlns="${PKG_NS}">` +
                `<Relationship Id="rIdWorkbook" Type="${R_NS}/package" Target="../embeddings/workbook.xlsx"/></Relationships>`,
        );
        archive.setFile(
          'word/embeddings/_rels/workbook.xlsx.rels',
          `<Relationships xmlns="${PKG_NS}">` +
            `<Relationship Id="rIdBack" Type="${R_NS}/chart" Target="../charts/chart1.xml"/></Relationships>`,
        );
        archive.setFile('word/embeddings/workbook.xlsx', Buffer.from(workbook));
        return archive.save();
      };
      const original = await given('a box holding a chart whose workbook relates back to it', () =>
        withCycle('Box old', 'workbook one'));
      const revised = await given('the box text edited and the workbook bytes replaced', () =>
        withCycle('Box new', 'workbook two'));
      let failure: unknown;
      await when('the documents are compared', async () => {
        try {
          await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
        } catch (error) {
          failure = error;
        }
      });

      await then('the replaced workbook on the cycle is seen', () => {
        expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
        expect((failure as Error).message).toContain('relationship closure changed');
      });
    });
  }

  test('keeps an o:relid picture bound to its image across a text edit', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const fixture = await given('a box holding an o:relid picture, whose text changes', () =>
      compare(
        bodyWithBox(run('Box old') + vmlPicture({ relid: true })),
        bodyWithBox(run('Box new') + vmlPicture({ relid: true })),
      ));
    const result = await when('the documents are compared', fixture.compare);

    await then('the picture still resolves to the image part', async () => {
      expect(await packageView(result.document)).toContain(
        'vml:picture1:width:20pt;height:20pt:media/image1.png',
      );
    });
    await and('accept and reject reproduce the two documents', () =>
      assertFaithfulRedline(fixture.original, fixture.revised, result.document));
  });

  test('tracks edits in a box and in the box nested inside it, with unique revision ids', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const fixture = await given('an outer box and a nested box, both with a text edit', () =>
      compare(
        bodyWithBox(run('Outer old') + nestedBox('Inner old')),
        bodyWithBox(run('Outer new') + nestedBox('Inner new')),
      ));
    const result = await when('the documents are compared', fixture.compare);
    const document = await documentXmlOf(result.document);

    await then('each story carries its own tracked edit', () => {
      const [outer, inner] = boxes(document);
      expect(boxes(document)).toHaveLength(2);
      expect(trackedText(inner!)).toEqual({ inserted: 'new', deleted: 'old' });
      expect(trackedText(outer!)).toEqual({ inserted: 'newnew', deleted: 'oldold' });
      expect(isInside(inner!, ['ins', 'del'])).toBe(false);
      expectUniqueRevisionIds(document);
    });
    await and('accept and reject reproduce the two documents', () =>
      assertFaithfulRedline(fixture.original, fixture.revised, result.document));
  });

  test('tracks an edit only in the nested box', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const fixture = await given('a nested box whose text changes inside an otherwise unchanged box', () =>
      compare(
        bodyWithBox(run('Outer') + nestedBox('Inner old')),
        bodyWithBox(run('Outer') + nestedBox('Inner new')),
      ));
    const result = await when('the documents are compared', fixture.compare);
    const document = await documentXmlOf(result.document);

    await then('the nested story carries the edit', () => {
      expect(trackedText(boxes(document)[1]!)).toEqual({ inserted: 'new', deleted: 'old' });
    });
    await and('accept and reject reproduce the two documents', () =>
      assertFaithfulRedline(fixture.original, fixture.revised, result.document));
  });

  test('finds a nested placeholder when the outer box holds nothing but the nested box', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const outerOnlyNested = (text: string): string =>
      `<w:p>${run('Body')}</w:p>` +
      `<w:p>${vmlTextBoxRun(`<w:p>${nestedBox(text)}</w:p>`, 'box1', '_x0000_s1026')}</w:p>`;
    const fixture = await given('an outer box whose only text is in its nested box', () =>
      compare(outerOnlyNested('Inner old'), outerOnlyNested('Inner new')));
    const result = await when('the documents are compared', fixture.compare);
    const document = await documentXmlOf(result.document);

    await then('the nested story carries the edit', () => {
      expect(trackedText(boxes(document)[1]!)).toEqual({ inserted: 'new', deleted: 'old' });
    });
    await and('accept and reject reproduce the two documents', () =>
      assertFaithfulRedline(fixture.original, fixture.revised, result.document));
  });

  test('marks the story of a box inserted inside a changed box', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const fixture = await given('a changed box that gains a nested box', () =>
      compare(bodyWithBox(run('Outer old')), bodyWithBox(run('Outer new') + nestedBox('Inner'))));
    const result = await when('the documents are compared', fixture.compare);
    const document = await documentXmlOf(result.document);

    await then('the nested anchor is inserted and so is every paragraph and run of its story', () => {
      const inner = boxes(document)[1]!;
      expect(isInside(inner, ['ins'])).toBe(true);
      const paragraph = inner.getElementsByTagNameNS(W_NS, 'p').item(0)!;
      const mark = paragraph.getElementsByTagNameNS(W_NS, 'rPr').item(0);
      expect(mark?.getElementsByTagNameNS(W_NS, 'ins').length).toBe(1);
      expect(trackedText(inner)).toEqual({ inserted: 'Inner', deleted: '' });
      expectUniqueRevisionIds(document);
    });
    await and('accept and reject reproduce the two documents', () =>
      assertFaithfulRedline(fixture.original, fixture.revised, result.document));
  });

  test('tracks an inserted box that holds a picture, an object and a nested box', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const fixture = await given('a revised document that adds a full box', () =>
      compare(
        `<w:p>${run('Body')}</w:p>`,
        bodyWithBox(run('Box') + vmlPicture() + EMBEDDED_OBJECT + nestedBox('Inner')),
      ));
    const result = await when('the documents are compared', fixture.compare);
    const document = await documentXmlOf(result.document);

    await then('the box and its nested box are inserted', () => {
      const [outer, inner] = boxes(document);
      expect(isInside(outer!, ['ins'])).toBe(true);
      expect(trackedText(inner!).inserted).toBe('Inner');
      expectUniqueRevisionIds(document);
    });
    await and('accept and reject reproduce the two documents', () =>
      assertFaithfulRedline(fixture.original, fixture.revised, result.document));
  });

  test('tracks a text edit in a footer text box holding a picture', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const footerBox = (text: string): string =>
      `<w:p>${vmlTextBoxRun(`<w:p>${run(text)}${vmlPicture()}</w:p>`, 'box1', '_x0000_s1026')}</w:p>`;
    const original = await given('a footer text box holding a picture', () => packageWithFooter(footerBox('Box old')));
    const revised = await given('the same footer with the box text edited', () => packageWithFooter(footerBox('Box new')));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    const footer = await footerXmlOf(result.document);

    await then('the edit is tracked inside the footer box and the picture is kept untracked', () => {
      const [box] = boxes(footer);
      expect(trackedText(box!)).toEqual({ inserted: 'new', deleted: 'old' });
      const picture = box!.getElementsByTagNameNS(VML_NS, 'imagedata').item(0)!;
      expect(isInside(picture, ['ins', 'del'])).toBe(false);
      expect(picture.getAttributeNS(R_NS, 'id')).toBe('rIdImage');
    });
    await and('accept and reject reproduce the two footers', async () => {
      const text = (document: Document): string => boxes(document)[0]!.textContent ?? '';
      expect(text(await footerXmlOf(result.document, acceptAllChanges))).toBe('Box new');
      expect(text(await footerXmlOf(result.document, rejectAllChanges))).toBe('Box old');
      for (const [mode, expected] of [['accept', 'Box new'], ['reject', 'Box old']] as const) {
        const document = await DocxDocument.load(result.document);
        if (mode === 'accept') await document.acceptChanges();
        else await document.rejectChanges();
        expect(text(await footerXmlOf((await document.toBuffer()).buffer))).toBe(expected);
      }
      await assertSchema(result.document);
    });
  });

  test('still refuses a nested box in a changed footer text box', async ({
    given, when, then,
  }: AllureBddContext) => {
    const footerBox = (text: string): string =>
      `<w:p>${vmlTextBoxRun(`<w:p>${run(text)}${nestedBox('Inner')}</w:p>`, 'box1', '_x0000_s1026')}</w:p>`;
    const original = await given('a footer text box holding a nested box', () => packageWithFooter(footerBox('Box old')));
    const revised = await given('the same footer with the outer text edited', () => packageWithFooter(footerBox('Box new')));
    let failure: unknown;
    await when('the documents are compared', async () => {
      try {
        await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
      } catch (error) {
        failure = error;
      }
    });

    // Header and footer stories splice back by raw position, which a nested
    // box would shift; the refusal names the cause rather than guessing.
    await then('the comparison names the nested box', () => {
      expect(failure).toBeInstanceOf(UnsupportedTextBoxRevisionError);
      expect((failure as Error).message).toContain('nested text boxes are not supported');
    });
  });
});
