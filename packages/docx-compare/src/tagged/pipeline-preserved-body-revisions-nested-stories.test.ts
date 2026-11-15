/**
 * A negotiated draft often still carries open tracked changes in its body: a
 * `w:ins` or `w:del` by an earlier author, identical in both copies. The
 * comparison keeps those records and layers its own revisions on top, so its
 * Accept All shows the revised document's Accept All and its Reject All the
 * original's Reject All.
 *
 * A header or footer change, or a text box in the body, sends the comparison
 * through the nested-story path, which splices each story's own comparison
 * into the outer one and re-checks the assembled body. That check must hold
 * the assembled body to the same projections. Held to the raw input text
 * instead, it read the pending insertion or deletion as a difference and
 * aborted the comparison with a text-box error, even with no text box in
 * either document.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @see https://github.com/UseJunior/safe-docx/issues/1486
 * @see https://github.com/UseJunior/safe-docx/issues/1464
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { describe, expect, vi } from 'vitest';
import { DocxArchive, DocxDocument, OOXML, parseXml, rejectChanges, serializeXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { compareDocumentsAtomizer, type TaggedCompareResult } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import {
  assertAssembledBodyRoundTrip,
  UnsupportedTextBoxRevisionError,
} from './textBoxRevisionSafety.js';

const TEST_FEATURE = 'add-markdoc-header-footer-authoring';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
  );

/**
 * Rewrites the assembled main story before the round-trip check reads it, so
 * a test can show that a wrongly assembled body is still refused. Unset, the
 * assembly passes through untouched.
 */
const assembly = vi.hoisted(() => ({ corrupt: undefined as undefined | ((documentXml: string) => string) }));
vi.mock('./textBoxRevisionSafety.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./textBoxRevisionSafety.js')>();
  const { DocxArchive: Archive } = await import('@usejunior/docx-core');
  return {
    ...actual,
    assembleTextBoxStoryComparison: async (
      ...args: Parameters<typeof actual.assembleTextBoxStoryComparison>
    ): Promise<Buffer> => {
      const assembled = await actual.assembleTextBoxStoryComparison(...args);
      if (assembly.corrupt === undefined) return assembled;
      const archive = await Archive.load(assembled);
      archive.setDocumentXml(assembly.corrupt(await archive.getDocumentXml()));
      return archive.save();
    },
  };
});

const W_NS = OOXML.W_NS;
const xmlSerializer = new XMLSerializer();
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NAMESPACES = {
  r: R_NS,
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
};
const DECLARATIONS = Object.entries(NAMESPACES).map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`).join('');
const BODY_NAMESPACE_OPTIONS = { namespaces: NAMESPACES, ignorablePrefixes: ['wps'] };
// Each case compares, applies four projections and a selective reject, and runs the schema gate.
const LOAD_SENSITIVE_TIMEOUT_MS = 30_000;
const COMPARISON_AUTHOR = 'Comparison';
const COMPARE_OPTIONS = { author: COMPARISON_AUTHOR, date: new Date('2026-11-15T00:00:00.000Z') };
const PRIOR = 'w:author="Prior" w:date="2026-10-01T00:00:00Z"';
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

type Kind = 'header' | 'footer';
type Pending = 'w:ins' | 'w:del' | 'w:ins and w:del';
const PART_PATH = (kind: Kind): string => `word/${kind}1.xml`;

const text = (value: string): string => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
const paragraph = (content: string): string => `<w:p>${content}</w:p>`;
const cell = (value: string): string =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${paragraph(text(value))}</w:tc>`;
const row = (...cells: string[]): string => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
const table = (...rows: string[]): string =>
  '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  `${rows.join('')}</w:tbl>`;

/** A DrawingML text box anchored in its own paragraph, `width` EMU wide. */
function textBox(boxText: string, width = 1905000): string {
  return paragraph(
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0"' +
    ' relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    `<wp:extent cx="${width}" cy="635000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    '<wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="Text Box 1"/><wp:cNvGraphicFramePr/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="635000"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${paragraph(text(boxText))}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>',
  );
}

/** The pending revision both copies carry at the start of the first body paragraph. */
function pendingMarkup(pending: Pending): string {
  const inserted = `<w:ins w:id="101" ${PRIOR}>${text('pending ')}</w:ins>`;
  const deleted = `<w:del w:id="102" ${PRIOR}><w:r><w:delText xml:space="preserve">withdrawn </w:delText></w:r></w:del>`;
  if (pending === 'w:ins') return inserted;
  if (pending === 'w:del') return deleted;
  return inserted + deleted;
}

interface Side {
  readonly bodyText: string;
  readonly bodyBox?: string;
  readonly story?: { kind: Kind; content: string };
}

async function sidePackage(pending: Pending, side: Side): Promise<Buffer> {
  const body =
    paragraph(pendingMarkup(pending) + text(side.bodyText)) +
    paragraph(text('Second paragraph.')) +
    (side.bodyBox === undefined ? '' : textBox(side.bodyBox));
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(body, [], BODY_NAMESPACE_OPTIONS));
  if (side.story) {
    const { kind, content } = side.story;
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
        ` xmlns:mc="${MC_NS}" mc:Ignorable="wps">${content}</${root}>`,
    );
    const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
    archive.setFile('[Content_Types].xml', contentTypes.replace(
      '</Types>',
      `<Override PartName="/${PART_PATH(kind)}"` +
        ` ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/></Types>`,
    ));
  }
  return archive.save();
}

const isW = (node: Node | null, ...names: string[]): node is Element =>
  node !== null && node.nodeType === 1 && (node as Element).namespaceURI === W_NS
  && names.includes((node as Element).localName);
const elementChildren = (element: Element): Element[] =>
  Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1);

/** A story's blocks: a paragraph as its round-trip text, a table as its rows' cell texts. */
function blocksView(container: Element): string[] {
  const own = (element: Element): string => extractRoundTripComparisonText(xmlSerializer.serializeToString(element));
  return elementChildren(container).flatMap((block) => {
    if (isW(block, 'p')) return [`p:${own(block)}`];
    if (isW(block, 'tbl')) {
      return ['tbl:' + elementChildren(block).filter((child) => isW(child, 'tr'))
        .map((tr) => elementChildren(tr).filter((tc) => isW(tc, 'tc')).map(own).join('|')).join(' ; ')];
    }
    return [];
  });
}

/** What a document shows: its body blocks, each box's blocks and the header/footer part's blocks. */
interface DocumentView { body: string[]; boxes: string[][]; story?: string[] }

function documentView(documentXml: string, storyXml: string | null): DocumentView {
  const document = parseXml(documentXml);
  const body = document.getElementsByTagNameNS(W_NS, 'body').item(0)!;
  const view: DocumentView = {
    body: blocksView(body),
    boxes: Array.from(document.getElementsByTagNameNS(W_NS, 'txbxContent')).map(blocksView),
  };
  if (storyXml !== null) view.story = blocksView(parseXml(storyXml).documentElement);
  return view;
}

type Projection = 'accept' | 'reject';

/** The package as docx-compare's applier or docx-core's shows it after a projection. */
async function projectedView(
  buffer: Buffer,
  kind: Kind | undefined,
  projection: Projection,
  applier: 'ast' | 'core',
): Promise<DocumentView> {
  let archive = await DocxArchive.load(buffer);
  if (applier === 'core') {
    const document = await DocxDocument.load(buffer);
    if (projection === 'accept') await document.acceptChanges();
    else await document.rejectChanges();
    archive = await DocxArchive.load((await document.toBuffer()).buffer);
  }
  const project = applier === 'core'
    ? (value: string) => value
    : projection === 'accept' ? acceptAllChanges : rejectAllChanges;
  const storyXml = kind === undefined ? null : await archive.getFile(PART_PATH(kind));
  return documentView(project(await archive.getDocumentXml()), storyXml === null ? null : project(storyXml));
}

/** Revision records by the earlier author, by element name, in the body and the story part. */
async function priorRecords(buffer: Buffer, kind: Kind | undefined): Promise<string[]> {
  const archive = await DocxArchive.load(buffer);
  const parts = [await archive.getDocumentXml(), kind === undefined ? null : await archive.getFile(PART_PATH(kind))];
  return parts.flatMap((xml) => xml === null ? [] : Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, '*'))
    .filter((element) => element.getAttributeNS(W_NS, 'author') === 'Prior')
    .map((element) => `${element.localName}:${element.textContent}`));
}

/** The package after rejecting only the revisions this comparison wrote (docx-core's author filter). */
async function comparisonRevisionsRejected(buffer: Buffer, kind: Kind | undefined): Promise<Buffer> {
  const archive = await DocxArchive.load(buffer);
  const reject = (xml: string): string => {
    const document = parseXml(xml);
    rejectChanges(document, { filter: (element) => element.getAttributeNS(W_NS, 'author') === COMPARISON_AUTHOR });
    return serializeXml(document);
  };
  archive.setDocumentXml(reject(await archive.getDocumentXml()));
  if (kind !== undefined) archive.setFile(PART_PATH(kind), reject((await archive.getFile(PART_PATH(kind)))!));
  return archive.save();
}

/** Whether a package still carries any revision this comparison wrote. */
async function comparisonRevisionCount(buffer: Buffer, kind: Kind | undefined): Promise<number> {
  const archive = await DocxArchive.load(buffer);
  const parts = [await archive.getDocumentXml(), kind === undefined ? null : await archive.getFile(PART_PATH(kind))];
  return parts.reduce((count, xml) => count + (xml === null ? 0 : Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, '*'))
    .filter((element) => element.getAttributeNS(W_NS, 'author') === COMPARISON_AUTHOR).length), 0);
}

/**
 * The gate validates `word/document.xml`; the header/footer part's blocks
 * (CT_HdrFtr holds the same block-level content as a body) are validated as
 * a document body of their own.
 */
async function assertSchema(buffer: Buffer, kind: Kind | undefined): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1486-'));
  try {
    const paths = [join(directory, 'compared.docx')];
    await writeFile(paths[0]!, buffer);
    if (kind !== undefined) {
      paths.push(join(directory, `${kind}.xml`));
      const xml = (await (await DocxArchive.load(buffer)).getFile(PART_PATH(kind)))!;
      await writeFile(paths[1]!, xml
        .replace(/<w:(hdr|ftr)(\s[^>]*)?>/u, (_match, _root, attributes = '') => `<w:document${attributes}><w:body>`)
        .replace(/<\/w:(hdr|ftr)>\s*$/u, '</w:body></w:document>'));
    }
    const check = spawnSync(process.execPath, [schemaScript, ...paths], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function expectPreservingRedline(
  { then }: Pick<AllureBddContext, 'then'>,
  kind: Kind | undefined,
  original: Buffer,
  revised: Buffer,
  result: TaggedCompareResult,
): Promise<void> {
  await then('Accept All shows the revised document\'s Accept All and Reject All the original\'s Reject All, with both appliers', async () => {
    for (const applier of ['ast', 'core'] as const) {
      const expectedAccepted = await projectedView(revised, kind, 'accept', applier);
      const expectedRejected = await projectedView(original, kind, 'reject', applier);
      expect(expectedAccepted, applier).not.toEqual(expectedRejected);
      expect(await projectedView(result.document, kind, 'accept', applier), `accept ${applier}`).toEqual(expectedAccepted);
      expect(await projectedView(result.document, kind, 'reject', applier), `reject ${applier}`).toEqual(expectedRejected);
    }
  });
  await then('rejecting only the comparison\'s revisions gives back the original, its pending records intact', async () => {
    expect(await comparisonRevisionCount(result.document, kind)).toBeGreaterThan(0);
    const restored = await comparisonRevisionsRejected(result.document, kind);
    expect(await comparisonRevisionCount(restored, kind)).toBe(0);
    expect(await priorRecords(restored, kind)).toEqual(await priorRecords(original, kind));
    for (const projection of ['accept', 'reject'] as const) {
      expect(await projectedView(restored, kind, projection, 'ast'), projection)
        .toEqual(await projectedView(original, kind, projection, 'ast'));
    }
  });
  await then('the compared package passes the emitted-document schema gate', () => assertSchema(result.document, kind));
}

interface StoryChangeCase {
  readonly name: string;
  readonly original: Side;
  readonly revised: Side;
  /** A box resize is shape geometry, which the redline lists instead of tracking. */
  readonly listedDrawing?: Kind;
}

const footerStory = (kind: Kind, content: string): Side['story'] => ({ kind, content });
const sameBody = 'Body text stays the same.';
const BESIDE_BOX = textBox('Confidential');

const STORY_CHANGE_CASES: readonly StoryChangeCase[] = (['header', 'footer'] as const).flatMap((kind) =>
  [false, true].flatMap((withBox): StoryChangeCase[] => {
    const box = withBox ? BESIDE_BOX : '';
    const beside = withBox ? ' beside a text box' : ' with no text box';
    const cases: StoryChangeCase[] = [{
      name: `a ${kind} text edit${beside}`,
      original: { bodyText: sameBody, story: footerStory(kind, paragraph(text(`${kind} legend v1`)) + box) },
      revised: { bodyText: sameBody, story: footerStory(kind, paragraph(text(`${kind} legend v2`)) + box) },
    }];
    if (kind === 'footer') {
      cases.push({
        name: `a footer table row inserted${beside}`,
        original: { bodyText: sameBody, story: footerStory(kind, table(row('Company', 'Acme Corp')) + box) },
        revised: { bodyText: sameBody, story: footerStory(kind, table(row('Company', 'Acme Corp'), row('Phone', '555 0100')) + box) },
      });
    }
    return cases;
  })).concat([
  {
    name: 'a footer text box text edit',
    original: { bodyText: sameBody, story: footerStory('footer', paragraph(text('Footer legend')) + textBox('Draft for review')) },
    revised: { bodyText: sameBody, story: footerStory('footer', paragraph(text('Footer legend')) + textBox('Final for signature')) },
  },
  {
    // The resize alone is listed, not tracked; the body edit beside it gives the redline a revision of its own.
    name: 'a footer text box resize beside a body edit',
    original: { bodyText: 'Body draft.', story: footerStory('footer', paragraph(text('Footer legend')) + textBox('Confidential')) },
    revised: { bodyText: 'Body final.', story: footerStory('footer', paragraph(text('Footer legend')) + textBox('Confidential', 2540000)) },
    listedDrawing: 'footer',
  },
  {
    name: 'a body text box text edit',
    original: { bodyText: sameBody, bodyBox: 'Draft for review' },
    revised: { bodyText: sameBody, bodyBox: 'Final for signature' },
  },
]);

describe('a pending body revision beside a header, footer or body text box change (#1486)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  for (const pending of ['w:ins', 'w:del', 'w:ins and w:del'] as const) {
    for (const storyCase of STORY_CHANGE_CASES) {
      test(`keeps a pending body ${pending} and tracks ${storyCase.name}`, async ({ given, when, then }: AllureBddContext) => {
        const kind = storyCase.original.story?.kind;
        const [original, revised] = await given(`both copies carry the same pending body ${pending}; the revision has ${storyCase.name}`, () =>
          Promise.all([sidePackage(pending, storyCase.original), sidePackage(pending, storyCase.revised)]));
        const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
        await then('the comparison completes, listing only a resized drawing', () => {
          if (storyCase.listedDrawing === undefined) {
            expect(result.unrepresentedChanges).toBeUndefined();
          } else {
            expect(result.unrepresentedChanges).toEqual([expect.objectContaining({
              scope: 'drawing',
              kind: 'changed',
              drawing: expect.objectContaining({ story: storyCase.listedDrawing, partPath: PART_PATH(storyCase.listedDrawing) }),
            })]);
          }
        });
        await expectPreservingRedline({ then }, kind, original, revised, result);
      });
    }
  }
});

/** The body's first `w:ins` by `author`, removed with its content. */
function withoutInsertionBy(author: string): (documentXml: string) => string {
  return (documentXml) => {
    const document = parseXml(documentXml);
    const insertion = Array.from(document.getElementsByTagNameNS(W_NS, 'ins'))
      .find((element) => element.getAttributeNS(W_NS, 'author') === author && !isW(element.parentNode, 'rPr', 'trPr'));
    if (!insertion) throw new Error(`no w:ins by ${author} to remove`);
    insertion.parentNode!.removeChild(insertion);
    return serializeXml(document);
  };
}

describe('a wrongly assembled body is still refused (#1486)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  const footerCase = STORY_CHANGE_CASES.find((storyCase) => storyCase.name === 'a footer text edit with no text box')!;
  const bodyBoxCase = STORY_CHANGE_CASES.find((storyCase) => storyCase.name === 'a body text box text edit')!;
  const corruptions = [
    {
      name: 'an assembly that drops the pending insertion',
      storyCase: footerCase,
      corrupt: withoutInsertionBy('Prior'),
      location: 'word/document.xml#w:txbxContent[0]: assembled nested stories failed accept/reject round-trip validation in the body text outside its text boxes',
    },
    {
      name: 'an assembly that drops the box\'s tracked insertion',
      storyCase: bodyBoxCase,
      corrupt: withoutInsertionBy(COMPARISON_AUTHOR),
      location: 'word/document.xml#w:txbxContent[0]: assembled nested stories failed accept/reject round-trip validation',
    },
  ];
  for (const corruption of corruptions) {
    test(`refuses ${corruption.name}, naming the body story`, async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given(`both copies carry the same pending body w:ins; the revision has ${corruption.storyCase.name}`, () =>
        Promise.all([sidePackage('w:ins', corruption.storyCase.original), sidePackage('w:ins', corruption.storyCase.revised)]));
      const outcome = await when(`the pair is compared through ${corruption.name}`, async () => {
        assembly.corrupt = corruption.corrupt;
        try {
          return await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS).then(
            () => undefined,
            (error: unknown) => error,
          );
        } finally {
          assembly.corrupt = undefined;
        }
      });
      await then('the assembled round-trip check refuses it and names word/document.xml', () => {
        expect(outcome).toBeInstanceOf(UnsupportedTextBoxRevisionError);
        expect((outcome as Error).message.endsWith(corruption.location), (outcome as Error).message).toBe(true);
      });
    });
  }
});

describe('the assembled body round-trip check (#1486)', () => {
  const body = (content: string): string =>
    `<w:document xmlns:w="${W_NS}"${DECLARATIONS}><w:body>${content}<w:sectPr/></w:body></w:document>`;
  const pending = `<w:ins w:id="101" ${PRIOR}>${text('pending ')}</w:ins>`;
  const comparison = (tag: 'ins' | 'del', value: string): string => tag === 'ins'
    ? `<w:ins w:id="201" w:author="${COMPARISON_AUTHOR}">${text(value)}</w:ins>`
    : `<w:del w:id="202" w:author="${COMPARISON_AUTHOR}"><w:r><w:delText xml:space="preserve">${value}</w:delText></w:r></w:del>`;
  const original = body(paragraph(pending + text('Body draft.')));
  const revised = body(paragraph(pending + text('Body final.')));
  const refusal = (compared: string): unknown => {
    try {
      assertAssembledBodyRoundTrip(original, revised, compared);
      return undefined;
    } catch (error) {
      return error;
    }
  };

  test('accepts a body that keeps the pending record and projects to both sides', () => {
    const compared = body(paragraph(pending + text('Body ') + comparison('del', 'draft.') + comparison('ins', 'final.')));
    expect(refusal(compared)).toBeUndefined();
  });

  test('refuses a body whose Reject All is not the original\'s Reject All', () => {
    // The comparison's insertion is written as plain text, so Reject All keeps it.
    const compared = body(paragraph(pending + text('Body ') + comparison('del', 'draft.') + text('final.')));
    expect(refusal(compared)).toBeInstanceOf(UnsupportedTextBoxRevisionError);
  });

  test('refuses a body whose Accept All is not the revised document\'s Accept All', () => {
    // The pending record is lost, so Accept All no longer shows the pending text.
    const compared = body(paragraph(text('Body ') + comparison('del', 'draft.') + comparison('ins', 'final.')));
    expect(refusal(compared)).toBeInstanceOf(UnsupportedTextBoxRevisionError);
  });

  const firstChange = (originalXml: string, revisedXml: string, comparedXml: string): unknown => {
    try {
      assertAssembledBodyRoundTrip(originalXml, revisedXml, comparedXml);
      return undefined;
    } catch (caught) {
      return (caught as UnsupportedTextBoxRevisionError).changes?.[0] ?? caught;
    }
  };

  test('names a box whose difference is confined to its mc:Fallback copy', () => {
    const VML = 'urn:schemas-microsoft-com:vml';
    const twinned = (choice: string, fallback: string): string => body(
      paragraph(pending + text('Body.')) +
      paragraph(`<w:r><mc:AlternateContent xmlns:mc="${MC_NS}" xmlns:v="${VML}"><mc:Choice Requires="wps">` +
        `${textBox(choice).slice('<w:p><w:r>'.length, -'</w:r></w:p>'.length)}</mc:Choice>` +
        `<mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>${paragraph(text(fallback))}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback>` +
        '</mc:AlternateContent></w:r>'),
    );
    expect(firstChange(twinned('Final', 'Final'), twinned('Final', 'Final'), twinned('Final', 'Draft'))).toEqual({
      index: 0,
      partPath: 'word/document.xml',
      reason: 'assembled nested stories failed accept/reject round-trip validation',
    });
  });

  test('judges box text with the whole body\'s normalization when the failure lies outside the boxes', () => {
    // The box differs only by doubled whitespace, which the gate normalizes away; the body word is the real change.
    const withBox = (bodyWord: string, boxText: string): string =>
      body(paragraph(pending + text(bodyWord)) + textBox(boxText));
    expect(firstChange(withBox('Body.', 'Box text'), withBox('Body.', 'Box text'), withBox('Other.', 'Box  text'))).toEqual({
      index: 0,
      partPath: 'word/document.xml',
      reason: 'assembled nested stories failed accept/reject round-trip validation in the body text outside its text boxes',
    });
  });

  test('names the text box whose text differs', () => {
    const withBoxes = (first: string, second: string): string =>
      body(paragraph(pending + text('Body.')) + textBox(first) + textBox(second));
    const error = (() => {
      try {
        assertAssembledBodyRoundTrip(withBoxes('Kept', 'Draft'), withBoxes('Kept', 'Final'), withBoxes('Kept', 'Draft'));
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(UnsupportedTextBoxRevisionError);
    expect((error as UnsupportedTextBoxRevisionError).changes).toEqual([{
      index: 1,
      partPath: 'word/document.xml',
      reason: 'assembled nested stories failed accept/reject round-trip validation',
    }]);
  });
});

/**
 * What an ODT export shows: the body text (`content.xml`) and the header and
 * footer text (LibreOffice keeps them in `styles.xml` master pages).
 */
async function odtView(odt: Buffer): Promise<{ body: string; header: string; footer: string }> {
  const zip = await JSZip.loadAsync(odt);
  const OFFICE_NS = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
  const STYLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
  const content = parseXml(await zip.file('content.xml')!.async('string'));
  const styles = parseXml(await zip.file('styles.xml')!.async('string'));
  const stories = (localName: string): string =>
    Array.from(styles.getElementsByTagNameNS(STYLE_NS, localName)).map((story) => story.textContent ?? '').join('');
  return {
    body: Array.from(content.getElementsByTagNameNS(OFFICE_NS, 'text')).map((body) => body.textContent ?? '').join(''),
    header: stories('header'),
    footer: stories('footer'),
  };
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice.
const reader = process.env.SAFE_DOCX_PRESERVED_BODY_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice reads a redline that keeps pending body revisions (#1486)', () => {
  for (const name of ['a footer text edit beside a text box', 'a body text box text edit']) {
    test(`accepts to the revised Accept All and rejects to the original Reject All for ${name}`, async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const storyCase = STORY_CHANGE_CASES.find((candidate) => candidate.name === name)!;
      const [original, revised] = await Promise.all([
        sidePackage('w:ins and w:del', storyCase.original),
        sidePackage('w:ins and w:del', storyCase.revised),
      ]);
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
      expect(originalRejected).not.toEqual(revisedAccepted);
      expect(revisedAccepted!.body).toContain('pending');
      expect(originalRejected!.body).toContain('withdrawn');
      expect(accepted).toEqual(revisedAccepted);
      expect(rejected).toEqual(originalRejected);
    }, 600_000);
  }
});
