/**
 * A picture or embedded object can change without its markup changing: Word
 * replaces a logo by rewriting the bytes of `media/image1.png`, or points the
 * same relationship id at a new media part. The `w:drawing`/`w:pict`/
 * `w:object` leaf is then identical on both sides, so a comparison that only
 * reads markup carries the revised picture with no revision and no report,
 * and Reject All shows the wrong picture.
 *
 * In the main document story the swap is redlined: the original picture is
 * a tracked deletion bound to a copy of its original payload, and the revised
 * picture a tracked insertion. In a header, footer or note story the picture
 * is listed in `unrepresentedChanges` instead. Nothing is carried silently.
 *
 * @conformance ECMA-376 edition 5, Part 2 § 6.5.3.4
 * @conformance ECMA-376 edition 5, Part 4 § 19.1.2.11
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.10
 * @see https://github.com/UseJunior/safe-docx/issues/1430
 */

import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { DocxArchive, DocxDocument, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { formatUnrepresentedChangeWarnings } from '../unrepresented-change-warnings.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'In-Place Reconstruction',
    story: 'Picture Payload Swaps',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 2, section: '6.5.3.4' },
    { spec: 'ECMA-376', edition: 5, part: 4, section: '19.1.2.11' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.3' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.10' },
  );

const W_NS = OOXML.W_NS;
const VML_NS = 'urn:schemas-microsoft-com:vml';
const OFFICE_NS = 'urn:schemas-microsoft-com:office:office';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NAMESPACES = {
  v: VML_NS,
  o: OFFICE_NS,
  r: R_NS,
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
} as const;
const STORY_NAMESPACES = Object.entries(NAMESPACES)
  .map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`)
  .join('');
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-11T00:00:00.000Z') };
/** A 1×1 PNG, so the picture relationship resolves to a real image part. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
/** A different 1×1 picture (one red pixel), standing in for a replaced logo. */
const OTHER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);
const LOAD_SENSITIVE_TIMEOUT_MS = 30_000;

const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

function drawingPicture({ cx = '100000', relationshipId = 'rIdImage' } = {}): string {
  return (
    `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cx}"/>` +
    `<wp:docPr id="7" name="Logo"/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="7" name="Logo"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relationshipId}"/></pic:blipFill><pic:spPr/></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

function vmlPicture({ relid = false } = {}): string {
  const reference = relid ? 'o:relid="rIdImage"' : 'r:id="rIdImage"';
  return (
    `<w:r><w:pict><v:shape id="logo" style="width:20pt;height:20pt">` +
    `<v:imagedata ${reference} o:title=""/></v:shape></w:pict></w:r>`
  );
}

const EMBEDDED_OBJECT =
  `<w:r><w:object w:dxaOrig="400" w:dyaOrig="400">` +
  `<v:shape id="object1" style="width:20pt;height:20pt"><v:imagedata r:id="rIdImage" o:title=""/></v:shape>` +
  `<o:OLEObject Type="Embed" ProgID="Package" ShapeID="object1" DrawAspect="Icon" ObjectID="_1" r:id="rIdObject"/>` +
  `</w:object></w:r>`;

/** A VML text box whose single paragraph holds `storyXml`. */
const vmlTextBox = (storyXml: string): string =>
  `<w:r><w:pict><v:shape id="box1" o:spid="_x0000_s1026" style="width:200pt;height:80pt">` +
  `<v:textbox><w:txbxContent><w:p>${storyXml}</w:p></w:txbxContent></v:textbox>` +
  `</v:shape></w:pict></w:r>`;

interface Payloads {
  image?: Buffer;
  imageTarget?: string;
  embedding?: Buffer;
}

interface PackageSpec {
  body: string;
  footer?: string;
  footnote?: string;
  /** Payloads behind the main story's relationships. */
  payloads?: Payloads;
  /** Payloads behind the footer's or footnotes' relationships. */
  storyPayloads?: Payloads;
}

function relationships(entries: Array<[id: string, type: string, target: string]>): string {
  return `<Relationships xmlns="${PKG_NS}">` +
    entries.map(([id, type, target]) =>
      `<Relationship Id="${id}" Type="${R_NS}/${type}" Target="${target}"/>`).join('') +
    `</Relationships>`;
}

/**
 * A package whose main story is `body`, optionally with a default footer and
 * one footnote. Each story's `rIdImage` (and the body's `rIdObject`) resolves
 * to its own media parts, so a swap in one story leaves the others alone.
 */
async function buildPackage(spec: PackageSpec): Promise<Buffer> {
  const body = spec.footnote === undefined
    ? spec.body
    : `${spec.body}<w:p>${run('Noted')}<w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
  const archive = await DocxArchive.load(
    await buildDocxFromBodyXml(body, [], { namespaces: NAMESPACES, ignorablePrefixes: [] }),
  );
  const { image = PNG, imageTarget = 'media/image1.png', embedding = Buffer.from('ole') } = spec.payloads ?? {};
  const documentRelationships: Array<[string, string, string]> = [
    ['rIdImage', 'image', imageTarget],
    ['rIdObject', 'oleObject', 'embeddings/oleObject1.bin'],
  ];
  archive.setFile(`word/${imageTarget}`, image);
  archive.setFile('word/embeddings/oleObject1.bin', embedding);
  const overrides: string[] = [];
  const story = spec.storyPayloads ?? {};
  const storyImageTarget = story.imageTarget ?? 'media/story1.png';
  if (spec.footer !== undefined) {
    archive.setDocumentXml((await archive.getDocumentXml()).replace(
      '<w:sectPr/>',
      '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>',
    ));
    documentRelationships.push(['rIdFooter', 'footer', 'footer1.xml']);
    archive.setFile(
      'word/footer1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:ftr xmlns:w="${W_NS}"${STORY_NAMESPACES}>${spec.footer}</w:ftr>`,
    );
    archive.setFile('word/_rels/footer1.xml.rels', relationships([['rIdImage', 'image', storyImageTarget]]));
    overrides.push(
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
    );
  }
  if (spec.footnote !== undefined) {
    documentRelationships.push(['rIdFootnotes', 'footnotes', 'footnotes.xml']);
    archive.setFile(
      'word/footnotes.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:footnotes xmlns:w="${W_NS}"${STORY_NAMESPACES}>` +
        `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
        `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r>${spec.footnote}</w:p></w:footnote>` +
        `</w:footnotes>`,
    );
    archive.setFile('word/_rels/footnotes.xml.rels', relationships([['rIdImage', 'image', storyImageTarget]]));
    overrides.push(
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
    );
  }
  if (spec.footer !== undefined || spec.footnote !== undefined) {
    archive.setFile(`word/${storyImageTarget}`, story.image ?? PNG);
  }
  archive.setFile('word/_rels/document.xml.rels', relationships(documentRelationships));
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes
    .replace(
      '<Default Extension="xml"',
      '<Default Extension="png" ContentType="image/png"/>' +
        '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>' +
        '<Default Extension="xml"',
    )
    .replace('</Types>', `${overrides.join('')}</Types>`));
  return archive.save();
}

function relationshipsPath(partPath: string): string {
  return posix.join(posix.dirname(partPath), '_rels', `${posix.basename(partPath)}.rels`);
}

/**
 * What a reader sees of one story: its paragraph text and, for every
 * relationship reference a picture or object makes, the bytes it resolves to.
 * The part path is deliberately left out, so a payload imported under a new
 * name compares equal to its source.
 */
async function storyView(
  buffer: Buffer,
  partPath: string,
  project: (xml: string) => string = (xml) => xml,
): Promise<string[]> {
  const archive = await DocxArchive.load(buffer);
  const document = parseXml(project((await archive.getFile(partPath))!));
  const relationshipsXml = await archive.getFile(relationshipsPath(partPath));
  const targets = new Map(
    relationshipsXml
      ? Array.from(parseXml(relationshipsXml).getElementsByTagNameNS(PKG_NS, 'Relationship'))
        .map((relationship) => [relationship.getAttribute('Id'), relationship.getAttribute('Target')!])
      : [],
  );
  const view = Array.from(document.getElementsByTagNameNS(W_NS, 'p'))
    .map((paragraph) => `p:${Array.from(paragraph.getElementsByTagNameNS(W_NS, 't'))
      .map((text) => text.textContent).join('')}`);
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const isReference = attribute.namespaceURI === R_NS
        || (attribute.namespaceURI === OFFICE_NS && attribute.localName === 'relid');
      if (!isReference || element.localName === 'footerReference') continue;
      const target = targets.get(attribute.value);
      const bytes = target === undefined
        ? null
        : await archive.getFileBuffer(posix.normalize(posix.join(posix.dirname(partPath), target)));
      const digest = bytes ? createHash('sha256').update(bytes).digest('hex').slice(0, 12) : 'missing';
      view.push(`${element.localName}@${attribute.localName}:${digest}`);
    }
  }
  return view;
}

async function docxCoreProjection(buffer: Buffer, mode: 'accept' | 'reject'): Promise<Buffer> {
  const document = await DocxDocument.load(buffer);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return (await document.toBuffer()).buffer;
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1430-'));
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
 * Accept All reproduces the revised story and Reject All the original,
 * payload bytes included, through the comparison's acceptor and docx-core's,
 * and the output passes the emitted-document schema gate.
 */
async function assertFaithfulRedline(
  original: Buffer,
  revised: Buffer,
  compared: Buffer,
  partPath = 'word/document.xml',
): Promise<void> {
  const originalView = await storyView(original, partPath);
  const revisedView = await storyView(revised, partPath);
  expect(await storyView(compared, partPath, acceptAllChanges)).toEqual(revisedView);
  expect(await storyView(compared, partPath, rejectAllChanges)).toEqual(originalView);
  expect(await storyView(await docxCoreProjection(compared, 'accept'), partPath)).toEqual(revisedView);
  expect(await storyView(await docxCoreProjection(compared, 'reject'), partPath)).toEqual(originalView);
  await assertSchema(compared);
}

function isInside(element: Element, localName: string): boolean {
  for (let current = element.parentNode; current; current = current.parentNode) {
    const candidate = current as Element;
    if (current.nodeType === 1 && candidate.namespaceURI === W_NS && candidate.localName === localName) {
      return true;
    }
  }
  return false;
}

/** How each picture or object in the main story is tracked, in document order. */
async function picturePlacement(buffer: Buffer): Promise<string[]> {
  const document = parseXml(await (await DocxArchive.load(buffer)).getDocumentXml());
  return ['drawing', 'pict', 'object']
    .flatMap((localName) => Array.from(document.getElementsByTagNameNS(W_NS, localName)))
    .filter((element) => !['drawing', 'pict', 'object'].some((outer) => isInside(element, outer)))
    .map((element) =>
      `${element.localName}:${isInside(element, 'del') ? 'del' : isInside(element, 'ins') ? 'ins' : 'kept'}`);
}

async function compare(original: PackageSpec, revised: PackageSpec) {
  const originalBuffer = await buildPackage(original);
  const revisedBuffer = await buildPackage(revised);
  return {
    original: originalBuffer,
    revised: revisedBuffer,
    result: await compareDocumentsAtomizer(originalBuffer, revisedBuffer, COMPARE_OPTIONS),
  };
}

describe('Pictures and objects whose payload changes under the same markup (#1430)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  for (const [label, leaf, revisedPayloads, placement] of [
    ['a DrawingML picture whose image bytes were replaced at the same path', drawingPicture(), { image: OTHER_PNG }, 'drawing'],
    ['a DrawingML picture whose relationship now targets a new media part', drawingPicture(), { image: OTHER_PNG, imageTarget: 'media/image2.png' }, 'drawing'],
    ['a VML picture whose image bytes were replaced at the same path', vmlPicture(), { image: OTHER_PNG }, 'pict'],
    ['a VML picture named through o:relid whose image bytes were replaced', vmlPicture({ relid: true }), { image: OTHER_PNG }, 'pict'],
    ['an embedded object whose binary part was replaced', EMBEDDED_OBJECT, { embedding: Buffer.from('other ole') }, 'object'],
  ] as const) {
    test(`redlines ${label} in the main story`, async ({ given, when, then, and }: AllureBddContext) => {
      const body = `<w:p>${run('Intro')}</w:p><w:p>${leaf}</w:p>`;
      const fixture = await given('two documents whose picture markup is identical but whose payload differs', () => ({
        original: { body },
        revised: { body, payloads: revisedPayloads },
      }));
      const { original, revised, result } = await when('the documents are compared', () =>
        compare(fixture.original, fixture.revised));

      await then('the old leaf is a tracked deletion and the new one a tracked insertion', async () => {
        expect(await picturePlacement(result.document)).toEqual([`${placement}:del`, `${placement}:ins`]);
        expect(result.unrepresentedChanges ?? []).toEqual([]);
      });
      await and('accept and reject reproduce each side, payload bytes included', () =>
        assertFaithfulRedline(original, revised, result.document));
    });
  }

  test('redlines a chart whose embedded workbook was replaced below an unchanged chart part', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const chart =
      `<w:r><w:drawing><wp:inline><wp:extent cx="100000" cy="100000"/><wp:docPr id="8" name="Chart 8"/>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
      `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart"/>` +
      `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    // The chart part and its relationships are byte-identical on both sides;
    // only the workbook the chart reaches through its own relationship differs.
    const withChart = async (text: string, workbook: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(await buildPackage({ body: `<w:p>${run(text)}</w:p><w:p>${chart}</w:p>` }));
      archive.setFile('word/_rels/document.xml.rels', relationships([['rIdChart', 'chart', 'charts/chart1.xml']]));
      archive.setFile(
        'word/charts/chart1.xml',
        `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${R_NS}">` +
          `<c:chart><c:plotArea><c:layout/></c:plotArea></c:chart>` +
          `<c:externalData r:id="rIdWorkbook"/></c:chartSpace>`,
      );
      archive.setFile(
        'word/charts/_rels/chart1.xml.rels',
        relationships([['rIdWorkbook', 'package', '../embeddings/workbook.xlsx']]),
      );
      archive.setFile('word/embeddings/workbook.xlsx', Buffer.from(workbook));
      return archive.save();
    };
    const original = await given('a chart and its embedded workbook', () => withChart('Intro old', 'workbook one'));
    const revised = await given('a body edit, and the workbook bytes replaced under the same chart', () =>
      withChart('Intro new', 'workbook two'));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the chart is a tracked deletion and insertion, with nothing listed', async () => {
      expect(await picturePlacement(result.document)).toEqual(['drawing:del', 'drawing:ins']);
      expect(result.unrepresentedChanges ?? []).toEqual([]);
    });
    await and('Reject All reaches the original workbook through a copy of the chart', async () => {
      const archive = await DocxArchive.load(result.document);
      const rejected = parseXml(rejectAllChanges(await archive.getDocumentXml()));
      const chartId = rejected.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/chart', 'chart')
        .item(0)!.getAttributeNS(R_NS, 'id');
      const documentRelationships = parseXml((await archive.getFile('word/_rels/document.xml.rels'))!);
      const chartTarget = Array.from(documentRelationships.getElementsByTagNameNS(PKG_NS, 'Relationship'))
        .find((relationship) => relationship.getAttribute('Id') === chartId)!.getAttribute('Target')!;
      const chartPath = posix.join('word', chartTarget);
      const chartRelationships = parseXml((await archive.getFile(relationshipsPath(chartPath)))!);
      const workbookTarget = chartRelationships.getElementsByTagNameNS(PKG_NS, 'Relationship').item(0)!
        .getAttribute('Target')!;
      const workbook = await archive.getFileBuffer(posix.normalize(posix.join(posix.dirname(chartPath), workbookTarget)));
      expect(workbook?.toString()).toBe('workbook one');
      await assertSchema(result.document);
    });
  });

  test('redlines a picture whose URI-encoded target names a replaced image', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    // `media/image%201.png` names the part `word/media/image 1.png`; reading
    // the literal name would hash two missing parts as equal (round-1 review).
    const body = `<w:p>${run('Intro')}</w:p><w:p>${drawingPicture()}</w:p>`;
    const withImage = async (image: Buffer): Promise<Buffer> => {
      const archive = await DocxArchive.load(await buildPackage({ body }));
      archive.setFile('word/_rels/document.xml.rels', relationships([['rIdImage', 'image', 'media/image%201.png']]));
      archive.setFile('word/media/image 1.png', image);
      return archive.save();
    };
    const original = await given('a picture whose relationship target is URI-encoded', () => withImage(PNG));
    const revised = await given('the same markup and target, with the image bytes replaced', () => withImage(OTHER_PNG));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the swap is a tracked deletion and insertion', async () => {
      expect(await picturePlacement(result.document)).toEqual(['drawing:del', 'drawing:ins']);
      expect(result.unrepresentedChanges ?? []).toEqual([]);
    });
    await and('the original image survives Reject All', async () => {
      const archive = await DocxArchive.load(result.document);
      const rejected = parseXml(rejectAllChanges(await archive.getDocumentXml()));
      const id = rejected.getElementsByTagNameNS(NAMESPACES.a, 'blip').item(0)!.getAttributeNS(R_NS, 'embed');
      const target = Array.from(parseXml((await archive.getFile('word/_rels/document.xml.rels'))!)
        .getElementsByTagNameNS(PKG_NS, 'Relationship'))
        .find((relationship) => relationship.getAttribute('Id') === id)!.getAttribute('Target')!;
      const bytes = await archive.getFileBuffer(posix.join('word', decodeURIComponent(target)));
      expect(bytes?.equals(PNG)).toBe(true);
      await assertSchema(result.document);
    });
  });

  test('redlines a chart whose payload changed only by which part of a cycle is its root', async ({
    given, when, then,
  }: AllureBddContext) => {
    // Two charts relate to each other through the same relationship. Swapping
    // their bytes keeps the set of reachable parts identical; only which one
    // the picture reaches first changes (round-1 review).
    const chart =
      `<w:r><w:drawing><wp:inline><wp:extent cx="100000" cy="100000"/><wp:docPr id="8" name="Chart 8"/>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
      `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart"/>` +
      `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    const chartPart = (title: string): string =>
      `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${R_NS}">` +
      `<c:chart><c:title><c:tx><c:v>${title}</c:v></c:tx></c:title></c:chart></c:chartSpace>`;
    const withCycle = async (text: string, first: string, second: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(await buildPackage({ body: `<w:p>${run(text)}</w:p><w:p>${chart}</w:p>` }));
      archive.setFile('word/_rels/document.xml.rels', relationships([['rIdChart', 'chart', 'charts/a.xml']]));
      archive.setFile('word/charts/a.xml', chartPart(first));
      archive.setFile('word/charts/b.xml', chartPart(second));
      archive.setFile('word/charts/_rels/a.xml.rels', relationships([['rIdPeer', 'chart', 'b.xml']]));
      archive.setFile('word/charts/_rels/b.xml.rels', relationships([['rIdPeer', 'chart', 'a.xml']]));
      return archive.save();
    };
    const original = await given('a chart that relates to a peer chart, titled RED then BLUE', () =>
      withCycle('Intro old', 'RED', 'BLUE'));
    const revised = await given('the two charts with their bytes exchanged, beside a body edit', () =>
      withCycle('Intro new', 'BLUE', 'RED'));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the chart is a tracked deletion and insertion, with nothing listed', async () => {
      expect(await picturePlacement(result.document)).toEqual(['drawing:del', 'drawing:ins']);
      expect(result.unrepresentedChanges ?? []).toEqual([]);
    });
  });

  test('keeps an imported chart cycle bound to the imported chart', async ({
    given, when, then,
  }: AllureBddContext) => {
    // The chart bytes are equal on both sides; its workbook differs and
    // relates back to the chart. The import must copy the chart aside before
    // writing the workbook's back-edge, or the back-edge lands on the revised
    // chart (round-1 review).
    const chart =
      `<w:r><w:drawing><wp:inline><wp:extent cx="100000" cy="100000"/><wp:docPr id="8" name="Chart 8"/>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
      `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart"/>` +
      `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    const withCycle = async (text: string, workbook: string): Promise<Buffer> => {
      const archive = await DocxArchive.load(await buildPackage({ body: `<w:p>${run(text)}</w:p><w:p>${chart}</w:p>` }));
      archive.setFile('word/_rels/document.xml.rels', relationships([['rIdChart', 'chart', 'charts/chart1.xml']]));
      archive.setFile(
        'word/charts/chart1.xml',
        `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${R_NS}">` +
          `<c:chart><c:plotArea><c:layout/></c:plotArea></c:chart><c:externalData r:id="rIdWorkbook"/></c:chartSpace>`,
      );
      archive.setFile('word/charts/_rels/chart1.xml.rels', relationships([['rIdWorkbook', 'package', '../embeddings/workbook.xlsx']]));
      archive.setFile('word/embeddings/_rels/workbook.xlsx.rels', relationships([['rIdBack', 'chart', '../charts/chart1.xml']]));
      archive.setFile('word/embeddings/workbook.xlsx', Buffer.from(workbook));
      return archive.save();
    };
    const original = await given('a chart whose workbook relates back to it', () => withCycle('Intro old', 'workbook one'));
    const revised = await given('the workbook bytes replaced, beside a body edit', () => withCycle('Intro new', 'workbook two'));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('Reject All reaches a copied chart whose workbook relates back to that copy', async () => {
      expect(await picturePlacement(result.document)).toEqual(['drawing:del', 'drawing:ins']);
      expect(result.unrepresentedChanges ?? []).toEqual([]);
      const archive = await DocxArchive.load(result.document);
      const targetOf = async (owner: string, id?: string): Promise<string> => {
        const relationship = Array.from(parseXml((await archive.getFile(relationshipsPath(owner)))!)
          .getElementsByTagNameNS(PKG_NS, 'Relationship'))
          .find((candidate) => id === undefined || candidate.getAttribute('Id') === id)!;
        return posix.normalize(posix.join(posix.dirname(owner), relationship.getAttribute('Target')!));
      };
      const rejected = parseXml(rejectAllChanges(await archive.getDocumentXml()));
      const chartId = rejected.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/chart', 'chart')
        .item(0)!.getAttributeNS(R_NS, 'id')!;
      const root = await targetOf('word/document.xml', chartId);
      const workbook = await targetOf(root);
      expect(root).not.toBe('word/charts/chart1.xml');
      expect((await archive.getFileBuffer(workbook))?.toString()).toBe('workbook one');
      expect(await targetOf(workbook)).toBe(root);
    });
  });

  test('redlines a picture swapped inside an unchanged text box in the main story', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const body = (text: string): string =>
      `<w:p>${run(text)}</w:p><w:p>${vmlTextBox(run('Box') + drawingPicture())}</w:p>`;
    const fixture = await given('an unchanged text box whose picture bytes change, beside a body edit', () => ({
      original: { body: body('Intro old') },
      revised: { body: body('Intro new'), payloads: { image: OTHER_PNG } },
    }));
    const { original, revised, result } = await when('the documents are compared', () =>
      compare(fixture.original, fixture.revised));

    await then('the swap is redlined rather than carried silently', async () => {
      expect((await picturePlacement(result.document)).some((placement) => placement.endsWith(':del'))).toBe(true);
      expect(result.unrepresentedChanges ?? []).toEqual([]);
    });
    await and('accept and reject reproduce each side, payload bytes included', () =>
      assertFaithfulRedline(original, revised, result.document));
  });

  test('keeps an unchanged picture untracked and unreported', async ({ given, when, then, and }: AllureBddContext) => {
    const body = (text: string): string => `<w:p>${run(text)}</w:p><w:p>${drawingPicture()}</w:p>`;
    const fixture = await given('a picture with the same markup and the same payload, beside a body edit', () => ({
      original: { body: body('Intro old') },
      revised: { body: body('Intro new') },
    }));
    const { original, revised, result } = await when('the documents are compared', () =>
      compare(fixture.original, fixture.revised));

    await then('the picture is neither tracked nor listed', async () => {
      expect(await picturePlacement(result.document)).toEqual(['drawing:kept']);
      expect(result.unrepresentedChanges ?? []).toEqual([]);
    });
    await and('accept and reject reproduce each side', () =>
      assertFaithfulRedline(original, revised, result.document));
  });

  test('still redlines a resized picture whose payload is unchanged', async ({ given, when, then, and }: AllureBddContext) => {
    const fixture = await given('a DrawingML picture resized with its payload unchanged', () => ({
      original: { body: `<w:p>${drawingPicture()}</w:p>` },
      revised: { body: `<w:p>${drawingPicture({ cx: '200000' })}</w:p>` },
    }));
    const { original, revised, result } = await when('the documents are compared', () =>
      compare(fixture.original, fixture.revised));

    await then('the resize stays a tracked deletion and insertion, with nothing listed', async () => {
      expect(await picturePlacement(result.document)).toEqual(['drawing:del', 'drawing:ins']);
      expect(result.unrepresentedChanges ?? []).toEqual([]);
    });
    await and('accept and reject reproduce each side', () =>
      assertFaithfulRedline(original, revised, result.document));
  });

  test('redlines a resized picture whose payload was also replaced', async ({ given, when, then, and }: AllureBddContext) => {
    const fixture = await given('a DrawingML picture resized and its bytes replaced at the same path', () => ({
      original: { body: `<w:p>${drawingPicture()}</w:p>` },
      revised: { body: `<w:p>${drawingPicture({ cx: '200000' })}</w:p>`, payloads: { image: OTHER_PNG } },
    }));
    const { original, revised, result } = await when('the documents are compared', () =>
      compare(fixture.original, fixture.revised));

    await then('the old picture keeps its old payload under the deletion', async () => {
      expect(await picturePlacement(result.document)).toEqual(['drawing:del', 'drawing:ins']);
      expect(result.unrepresentedChanges ?? []).toEqual([]);
    });
    await and('accept and reject reproduce each side, payload bytes included', () =>
      assertFaithfulRedline(original, revised, result.document));
  });

  for (const [label, footerLeaf, footerEdit] of [
    ['a VML footer picture swapped alongside a footer text edit', vmlPicture(), true],
    ['a VML footer picture swapped with no other footer edit', vmlPicture(), false],
    ['a DrawingML footer picture swapped alongside a footer text edit', drawingPicture(), true],
    ['a DrawingML footer picture swapped with no other footer edit', drawingPicture(), false],
    ['a picture swapped in an unchanged footer text box', vmlTextBox(run('Box') + vmlPicture()), true],
  ] as const) {
    test(`lists ${label}`, async ({ given, when, then, and }: AllureBddContext) => {
      const footer = (text: string): string => `<w:p>${run(text)}${footerLeaf}</w:p>`;
      const fixture = await given('a footer whose picture markup is unchanged but whose image bytes differ', () => ({
        original: { body: `<w:p>${run('Body old')}</w:p>`, footer: footer('Footer old') },
        revised: {
          body: `<w:p>${run('Body new')}</w:p>`,
          footer: footer(footerEdit ? 'Footer new' : 'Footer old'),
          storyPayloads: { image: OTHER_PNG },
        },
      }));
      const { result } = await when('the documents are compared', () =>
        compare(fixture.original, fixture.revised));

      await then('the footer picture is named in unrepresentedChanges', () => {
        const pictures = (result.unrepresentedChanges ?? []).filter((change) => change.scope === 'picture');
        expect(pictures).toHaveLength(1);
        expect(pictures[0]).toMatchObject({
          kind: 'changed',
          sectionIndex: 0,
          role: 'default',
          picture: { story: 'footer', partPath: 'word/footer1.xml', relationshipId: 'rIdImage' },
        });
      });
      await and('the caller-facing warning names the footer and the picture', () => {
        const warnings = formatUnrepresentedChangeWarnings(result.unrepresentedChanges);
        expect(warnings.some((warning) => warning.includes('picture') && warning.includes('word/footer1.xml'))).toBe(true);
      });
    });
  }

  test('lists a picture swapped in a footnote', async ({ given, when, then }: AllureBddContext) => {
    const fixture = await given('a footnote holding a picture whose image bytes differ, beside a body edit', () => ({
      original: { body: `<w:p>${run('Body old')}</w:p>`, footnote: `${run(' Note')}${drawingPicture()}` },
      revised: {
        body: `<w:p>${run('Body new')}</w:p>`,
        footnote: `${run(' Note')}${drawingPicture()}`,
        storyPayloads: { image: OTHER_PNG },
      },
    }));
    const { result } = await when('the documents are compared', () =>
      compare(fixture.original, fixture.revised));

    await then('the footnote picture is named in unrepresentedChanges', () => {
      const pictures = (result.unrepresentedChanges ?? []).filter((change) => change.scope === 'picture');
      expect(pictures).toHaveLength(1);
      expect(pictures[0]).toMatchObject({
        kind: 'changed',
        picture: { story: 'footnote', partPath: 'word/footnotes.xml', relationshipId: 'rIdImage', name: 'Logo' },
      });
    });
  });
});

/**
 * The image bytes of every `draw:image` in a LibreOffice-saved ODT, in
 * reading order. Each source and each projection passes through the same
 * LibreOffice import and export, so any re-encoding applies to all alike.
 */
async function odtImages(odt: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(odt);
  const content = parseXml(await zip.file('content.xml')!.async('string'));
  const images: string[] = [];
  for (const image of Array.from(
    content.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', 'image'),
  )) {
    const href = image.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '';
    const bytes = await zip.file(href)?.async('nodebuffer');
    images.push(bytes ? createHash('sha256').update(bytes).digest('hex').slice(0, 12) : `missing:${href}`);
  }
  return images;
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice.
const reader = process.env.SAFE_DOCX_PICTURE_PAYLOAD_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice reads a redlined picture swap as the source pictures (#1430)', () => {
  test('accepts and rejects a swapped DrawingML picture to the revised and original images', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    // DrawingML only: LibreOffice imports a VML picture as a drawing shape
    // outside its tracked-change regions, so it keeps both copies of any
    // tracked VML picture on Accept and on Reject. That holds equally for a
    // VML picture resized with an unchanged payload, which #1380 already
    // redlines this way, so it is a reader limit, not part of this fix.
    const body = `<w:p>${run('Intro')}</w:p><w:p>${drawingPicture()}</w:p>`;
    const cases = [await compare({ body }, { body, payloads: { image: OTHER_PNG } })];
    const packages: Buffer[] = [];
    await runLibreOfficeOracle(
      cases.flatMap(({ original, revised, result }) => [
        { op: 'identity' as const, docx: original, saveAs: 'odt' as const },
        { op: 'identity' as const, docx: revised, saveAs: 'odt' as const },
        { op: 'accept' as const, docx: result.document, saveAs: 'odt' as const },
        { op: 'reject' as const, docx: result.document, saveAs: 'odt' as const },
      ]),
      undefined,
      (index, bytes) => { packages[index] = bytes; },
    );
    for (let index = 0; index < cases.length; index++) {
      const [original, revised, accepted, rejected] = await Promise.all(
        packages.slice(index * 4, index * 4 + 4).map(odtImages),
      );
      expect(original).toHaveLength(1);
      expect(original).not.toEqual(revised);
      expect(accepted).toEqual(revised);
      expect(rejected).toEqual(original);
    }
  }, 600_000);
});
