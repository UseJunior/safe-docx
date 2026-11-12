/**
 * A header or footer change the redline cannot carry (a resized logo, a
 * resized plain shape) is listed in `unrepresentedChanges` and carried as the
 * revised part. Another header or footer slot's change is still compared and
 * tracked. The post-splice package projection check holds every page of the
 * redline to the original after Reject All, except a page showing a listed
 * part no story comparison wrote: that page is held to the revised part's own
 * Reject All. A change left out in one slot therefore no longer refuses the
 * redline of another, and the slot it leaves out stays listed.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @see https://github.com/UseJunior/safe-docx/issues/1391
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
import { assertAncillaryTextBoxStoryProjection } from './textBoxRevisionSafety.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const TEST_FEATURE = 'Listed Header/Footer Slot Projection';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
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
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
} as const;
const STORY_NAMESPACES = Object.entries(NAMESPACES)
  .map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`)
  .join('');
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-12T00:00:00.000Z') };
/** A 1×1 PNG behind the footer logo. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
/** A different 1×1 picture, standing in for a replaced logo. */
const OTHER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);
// Multi-story round trips: well inside 5s alone, slower under a parallel suite.
const LOAD_SENSITIVE_TIMEOUT_MS = 30_000;
const HEADER = 'word/header1.xml';
const FOOTER = 'word/footer1.xml';

const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (content: string): string => `<w:p>${content}</w:p>`;

/** An inline DrawingML logo `cx` EMU square, its image behind `rIdImage`. */
const logo = (cx = '914400'): string =>
  `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cx}"/><wp:docPr id="7" name="Logo"/>` +
  `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
  `<pic:pic><pic:nvPicPr><pic:cNvPr id="7" name="Logo"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cx}"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
  `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

/** A plain VML rectangle (no text box), a shape the redline cannot track. */
const rectangle = (width: string): string =>
  `<w:r><w:pict><v:rect id="rect1" style="width:${width};height:50pt"/></w:pict></w:r>`;

/** A VML text box holding `text`. */
const textBox = (text: string, width = '200pt'): string =>
  `<w:r><w:pict><v:shape id="box1" o:spid="_x0000_s1026" type="#_x0000_t202"` +
  ` style="position:absolute;margin-left:10pt;margin-top:0;width:${width};height:50pt;z-index:1">` +
  `<v:textbox><w:txbxContent><w:p>${run(text)}</w:p></w:txbxContent></v:textbox>` +
  `<w10:wrap type="square"/></v:shape></w:pict></w:r>`;

interface PackageSpec {
  body?: string;
  header: string;
  footer: string;
  /** The footer logo's image bytes. */
  image?: Buffer;
}

/** One section with a default header and a default footer whose logo resolves to `media/image1.png`. */
async function storyPackage(spec: PackageSpec): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(
    paragraph(run(spec.body ?? 'The parties agree as follows.')),
    [],
    { namespaces: NAMESPACES, ignorablePrefixes: ['wps'] },
  ));
  archive.setDocumentXml((await archive.getDocumentXml()).replace(
    '<w:sectPr/>',
    '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/>' +
      '<w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>',
  ));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      `<Relationship Id="rIdHeader" Type="${R_NS}/header" Target="header1.xml"/>` +
      `<Relationship Id="rIdFooter" Type="${R_NS}/footer" Target="footer1.xml"/></Relationships>`,
  );
  const story = (element: 'hdr' | 'ftr', content: string): string =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:${element} xmlns:w="${W_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"` +
    ` xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"${STORY_NAMESPACES}` +
    ` mc:Ignorable="w14 wps">${content}</w:${element}>`;
  archive.setFile(HEADER, story('hdr', spec.header));
  archive.setFile(FOOTER, story('ftr', spec.footer));
  archive.setFile(
    'word/_rels/footer1.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      `<Relationship Id="rIdImage" Type="${R_NS}/image" Target="media/image1.png"/></Relationships>`,
  );
  archive.setFile('word/media/image1.png', spec.image ?? PNG);
  archive.setFile('[Content_Types].xml', (await archive.getFile('[Content_Types].xml'))!.replace(
    '</Types>',
    '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/header1.xml"' +
      ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
      '<Override PartName="/word/footer1.xml"' +
      ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
  ));
  return archive.save();
}

async function partXml(buffer: Buffer, partPath: string): Promise<string> {
  return (await (await DocxArchive.load(buffer)).getFile(partPath))!;
}

/** What a reader sees in a story: its text (text boxes included) and every drawing, stories emptied. */
interface StoryView {
  text: string;
  drawings: string[];
}

function storyView(xml: string): StoryView {
  const document = parseXml(xml);
  return {
    text: Array.from(document.getElementsByTagNameNS(W_NS, 't')).map((text) => text.textContent ?? '').join(''),
    drawings: Array.from(document.getElementsByTagName('*'))
      .filter((element) => element.namespaceURI === W_NS && ['drawing', 'pict'].includes(element.localName))
      .map((container) => {
        const clone = container.cloneNode(true) as Element;
        for (const box of Array.from(clone.getElementsByTagNameNS(W_NS, 'txbxContent'))) {
          while (box.firstChild) box.removeChild(box.firstChild);
        }
        return canonicalNode(clone);
      }),
  };
}

/** The text a story's `w:ins` and `w:del` wrappers carry. */
function trackedText(xml: string): { deleted: string; inserted: string } {
  const document = parseXml(xml);
  const insideInsertion = (element: Element): boolean => {
    for (let node = element.parentNode; node?.nodeType === 1; node = node.parentNode) {
      const ancestor = node as Element;
      if (ancestor.namespaceURI === W_NS && ancestor.localName === 'ins') return true;
    }
    return false;
  };
  return {
    deleted: Array.from(document.getElementsByTagNameNS(W_NS, 'delText')).map((text) => text.textContent).join(''),
    inserted: Array.from(document.getElementsByTagNameNS(W_NS, 't'))
      .filter(insideInsertion)
      .map((text) => text.textContent)
      .join(''),
  };
}

async function docxCorePart(buffer: Buffer, mode: 'accept' | 'reject', partPath: string): Promise<string> {
  const document = await DocxDocument.load(buffer);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return partXml((await document.toBuffer()).buffer, partPath);
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1391-'));
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
 * Accept All reproduces the revised body, header and footer; Reject All
 * reproduces the original body and the original of every `represented` story
 * part, and the revised part of every `listed` one. Both the comparison
 * acceptor and docx-core's acceptChanges/rejectChanges are checked, and the
 * output passes the emitted-document schema gate.
 */
async function assertProjections(
  original: Buffer,
  revised: Buffer,
  compared: Buffer,
  { represented, listed }: { represented: string[]; listed: string[] },
): Promise<void> {
  for (const partPath of ['word/document.xml', ...represented, ...listed]) {
    const originalView = storyView(await partXml(original, partPath));
    const revisedView = storyView(await partXml(revised, partPath));
    const rejectedView = listed.includes(partPath) ? revisedView : originalView;
    const output = await partXml(compared, partPath);
    expect(storyView(acceptAllChanges(output)), `accept ${partPath}`).toEqual(revisedView);
    expect(storyView(rejectAllChanges(output)), `reject ${partPath}`).toEqual(rejectedView);
    expect(storyView(await docxCorePart(compared, 'accept', partPath)), `docx-core accept ${partPath}`)
      .toEqual(revisedView);
    expect(storyView(await docxCorePart(compared, 'reject', partPath)), `docx-core reject ${partPath}`)
      .toEqual(rejectedView);
  }
  await assertSchema(compared);
}

const BODY_EDIT = { original: 'The parties agree as follows.', revised: 'The parties hereby agree as follows.' };

describe('a listed header/footer slot beside a tracked one (#1391)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  test('tracks a header edit beside a footer whose logo was resized', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const original = await given('a header reading "Draft" and a footer logo one inch square', () =>
      storyPackage({ body: BODY_EDIT.original, header: paragraph(run('Draft')), footer: paragraph(logo()) }));
    const revised = await given('the header edited to "Final", the logo resized and the body edited', () =>
      storyPackage({ body: BODY_EDIT.revised, header: paragraph(run('Final')), footer: paragraph(logo('1828800')) }));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the header edit is tracked', async () => {
      expect(trackedText(await partXml(result.document, HEADER))).toEqual({ deleted: 'Draft', inserted: 'Final' });
    });
    await and('only the footer is listed', () => {
      expect(result.unrepresentedChanges).toEqual([
        { scope: 'footer', kind: 'changed', sectionIndex: 0, role: 'default' },
      ]);
    });
    await and('the header and body keep exact parity and the footer reads as revised', () =>
      assertProjections(original, revised, result.document, { represented: [HEADER], listed: [FOOTER] }));
  });

  test('tracks a header edit beside a footer whose logo image was replaced under the same markup', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const original = await given('a header reading "Draft" and a footer logo', () =>
      storyPackage({ header: paragraph(run('Draft')), footer: paragraph(logo()) }));
    const revised = await given('the header edited to "Final" and the logo bytes replaced', () =>
      storyPackage({ header: paragraph(run('Final')), footer: paragraph(logo()), image: OTHER_PNG }));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the header edit is tracked', async () => {
      expect(trackedText(await partXml(result.document, HEADER))).toEqual({ deleted: 'Draft', inserted: 'Final' });
    });
    await and('the footer picture is listed', () => {
      expect(result.unrepresentedChanges).toEqual([expect.objectContaining({
        scope: 'picture',
        picture: expect.objectContaining({ story: 'footer', partPath: FOOTER, relationshipId: 'rIdImage' }),
      })]);
    });
    await and('every story keeps its documented projection', () =>
      assertProjections(original, revised, result.document, { represented: [HEADER], listed: [FOOTER] }));
  });

  test('tracks a header edit beside a footer edit and logo resize carried as listed', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const original = await given('a header reading "Draft" and a footer "Page" beside a logo', () =>
      storyPackage({ header: paragraph(run('Draft')), footer: paragraph(run('Page') + logo()) }));
    const revised = await given('the header and footer text edited and the logo resized', () =>
      storyPackage({ header: paragraph(run('Final')), footer: paragraph(run('Folio') + logo('1828800')) }));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the header edit is tracked and the footer is listed', async () => {
      expect(trackedText(await partXml(result.document, HEADER))).toEqual({ deleted: 'Draft', inserted: 'Final' });
      expect(result.unrepresentedChanges).toEqual([
        { scope: 'footer', kind: 'changed', sectionIndex: 0, role: 'default' },
      ]);
    });
    await and('the header keeps exact parity and the footer reads as revised', () =>
      assertProjections(original, revised, result.document, { represented: [HEADER], listed: [FOOTER] }));
  });

  test('tracks a footer text-box edit beside a header whose rectangle was resized', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const original = await given('a header rectangle and a footer text box reading "Notice: Old"', () =>
      storyPackage({ header: paragraph(rectangle('100pt')), footer: paragraph(textBox('Notice: Old')) }));
    const revised = await given('the rectangle resized and the box edited to "Notice: New"', () =>
      storyPackage({ header: paragraph(rectangle('150pt')), footer: paragraph(textBox('Notice: New')) }));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the box edit is tracked inside the footer box', async () => {
      expect(trackedText(await partXml(result.document, FOOTER))).toEqual({ deleted: 'Old', inserted: 'New' });
    });
    await and('the header stays listed', () => {
      expect(result.unrepresentedChanges).toContainEqual(
        { scope: 'header', kind: 'changed', sectionIndex: 0, role: 'default' },
      );
    });
    await and('the footer keeps exact parity and the header reads as revised', () =>
      assertProjections(original, revised, result.document, { represented: [FOOTER], listed: [HEADER] }));
  });

  test('tracks a resized footer text-box edit beside a header whose rectangle was resized', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const original = await given('a header rectangle and a footer text box reading "Notice: Old"', () =>
      storyPackage({ header: paragraph(rectangle('100pt')), footer: paragraph(textBox('Notice: Old')) }));
    const revised = await given('the rectangle resized and the box edited and widened', () =>
      storyPackage({ header: paragraph(rectangle('150pt')), footer: paragraph(textBox('Notice: New', '260pt')) }));
    const result = await when('the documents are compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));

    await then('the box edit is tracked and the header and the footer drawing are each listed', async () => {
      expect(trackedText(await partXml(result.document, FOOTER))).toEqual({ deleted: 'Old', inserted: 'New' });
      expect(result.unrepresentedChanges).toHaveLength(2);
      expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
        { scope: 'header', kind: 'changed', sectionIndex: 0, role: 'default' },
        expect.objectContaining({ scope: 'drawing', drawing: expect.objectContaining({ partPath: FOOTER }) }),
      ]));
    });
    await and('the header reads as revised', async () => {
      const output = await partXml(result.document, HEADER);
      const revisedView = storyView(await partXml(revised, HEADER));
      expect(storyView(rejectAllChanges(output))).toEqual(revisedView);
      expect(storyView(await docxCorePart(result.document, 'reject', HEADER))).toEqual(revisedView);
      await assertSchema(result.document);
    });
  });
});

describe('the package projection check excludes only listed, uncompared slots (#1391)', {
  timeout: LOAD_SENSITIVE_TIMEOUT_MS,
}, () => {
  const fixture = async () => {
    const original = await storyPackage({ header: paragraph(run('Draft')), footer: paragraph(logo()) });
    const revised = await storyPackage({ header: paragraph(run('Final')), footer: paragraph(logo('1828800')) });
    const { document, unrepresentedChanges } = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
    return { original, revised, document, changes: unrepresentedChanges ?? [] };
  };
  const withPart = async (buffer: Buffer, partPath: string, xml: string): Promise<Buffer> => {
    const archive = await DocxArchive.load(buffer);
    archive.setFile(partPath, xml);
    return archive.save();
  };
  const comparedPartPaths = new Set([HEADER]);

  test('accepts the redline while the footer stays listed', async ({ given, then }: AllureBddContext) => {
    const { original, revised, document, changes } = await given('a header edit beside a listed footer', fixture);
    await then('the projection check passes', () =>
      expect(assertAncillaryTextBoxStoryProjection(original, revised, document, { changes, comparedPartPaths }))
        .resolves.toBeUndefined());
  });

  test('refuses the redline once the footer is no longer listed', async ({ given, then }: AllureBddContext) => {
    const { original, revised, document } = await given('a header edit beside an unlisted footer', fixture);
    await then('the footer is held to the original and the check fails', () =>
      expect(assertAncillaryTextBoxStoryProjection(original, revised, document, { changes: [], comparedPartPaths }))
        .rejects.toThrow(/package projection validation/u));
  });

  test('refuses a listed footer that is not the revised part', async ({ given, when, then }: AllureBddContext) => {
    const { original, revised, document, changes } = await given('a header edit beside a listed footer', fixture);
    const altered = await when('the output footer is replaced by a third story', async () =>
      withPart(document, FOOTER, (await partXml(document, FOOTER)).replace('<w:p>', `<w:p>${run('Other')}`)));
    await then('the footer is held to the revised side and the check fails', () =>
      expect(assertAncillaryTextBoxStoryProjection(original, revised, altered, { changes, comparedPartPaths }))
        .rejects.toThrow(/package projection validation/u));
  });

  test('refuses an untracked header even while the footer is listed', async ({ given, when, then }: AllureBddContext) => {
    const { original, revised, document, changes } = await given('a header edit beside a listed footer', fixture);
    const untracked = await when('the output header is replaced by the revised header', async () =>
      withPart(document, HEADER, await partXml(revised, HEADER)));
    await then('the compared header keeps exact parity and the check fails', () =>
      expect(assertAncillaryTextBoxStoryProjection(original, revised, untracked, { changes, comparedPartPaths }))
        .rejects.toThrow(/package projection validation/u));
  });
});

/**
 * The text of each header and footer of an ODT export (LibreOffice keeps
 * them in `styles.xml` master pages) and each drawn frame's width there.
 */
async function odtStories(odt: Buffer): Promise<{ header: string; footer: string; frames: string[] }> {
  const zip = await JSZip.loadAsync(odt);
  const styles = parseXml(await zip.file('styles.xml')!.async('string'));
  const STYLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
  const DRAW_NS = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
  const SVG_NS = 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0';
  const text = (localName: string): string =>
    Array.from(styles.getElementsByTagNameNS(STYLE_NS, localName)).map((story) => story.textContent ?? '').join('');
  return {
    header: text('header'),
    footer: text('footer'),
    frames: Array.from(styles.getElementsByTagNameNS(DRAW_NS, 'frame'))
      .map((frame) => frame.getAttributeNS(SVG_NS, 'width') ?? ''),
  };
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice.
const reader = process.env.SAFE_DOCX_LISTED_STORY_SLOT_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice reads a header edit beside a listed footer as documented (#1391)', () => {
  test('accepts to the revised header and footer, rejects to the original header and the revised footer', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const original = await storyPackage({ body: BODY_EDIT.original, header: paragraph(run('Draft')), footer: paragraph(logo()) });
    const revised = await storyPackage({
      body: BODY_EDIT.revised,
      header: paragraph(run('Final')),
      footer: paragraph(logo('1828800')),
    });
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
    const [originalView, revisedView, accepted, rejected] = await Promise.all(packages.map(odtStories));
    expect(originalView!.header).toBe('Draft');
    expect(originalView!.frames).toHaveLength(1);
    expect(originalView!.frames).not.toEqual(revisedView!.frames);
    expect(accepted).toEqual(revisedView);
    expect(rejected).toEqual({ ...revisedView, header: originalView!.header });
  }, 600_000);
});
