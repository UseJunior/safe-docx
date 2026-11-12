/**
 * A hyperlink inside a text box names its target through a relationship of
 * the part that owns the box: `word/_rels/document.xml.rels` for a body box,
 * the footer's own `.rels` for a footer box. Adding a link, or pointing an
 * existing link somewhere else, changes that relationship closure. The
 * comparison tracks the change like a hyperlink change in body text: the
 * original link is a tracked deletion bound to the original target, the
 * revised link a tracked insertion bound to the revised target, and every
 * relationship either side needs is present, once, in the owning part.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.22
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @conformance ECMA-376 edition 5, Part 2 § 6.5.3.4
 * @conformance ECMA-376 edition 5, Part 2 § 6.5.2.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @see https://github.com/UseJunior/safe-docx/issues/1381
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
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'In-Place Reconstruction',
    story: 'Text-Box Hyperlink Relationships',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.22' },
    { spec: 'ECMA-376', edition: 5, part: 4, section: '14.9.1.1' },
    { spec: 'ECMA-376', edition: 5, part: 2, section: '6.5.3.4' },
    { spec: 'ECMA-376', edition: 5, part: 2, section: '6.5.2.3' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.3' },
  );

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HYPERLINK_TYPE = `${R_NS}/hyperlink`;
const VML_NS = 'urn:schemas-microsoft-com:vml';
const OFFICE_NS = 'urn:schemas-microsoft-com:office:office';
const NAMESPACES = { v: VML_NS, o: OFFICE_NS, r: R_NS } as const;
/** Two different 1×1 PNGs, standing in for a logo and its replacement. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const OTHER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);
const STORY_NAMESPACES = Object.entries(NAMESPACES)
  .map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`)
  .join('');
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-11T00:00:00.000Z') };
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);
const LOAD_SENSITIVE_TIMEOUT_MS = 30_000;

const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const link = (id: string, text: string): string =>
  `<w:hyperlink r:id="${id}">${run(text)}</w:hyperlink>`;
/** A VML picture naming its image through `o:relid`. */
const relidPicture = (id: string): string =>
  `<w:r><w:pict><v:shape id="logo" style="width:20pt;height:20pt">` +
  `<v:imagedata o:relid="${id}" o:title=""/></v:shape></w:pict></w:r>`;

/** A paragraph holding `lead` and a VML text box whose one paragraph is `storyXml`. */
const textBoxParagraph = (lead: string, storyXml: string): string =>
  `<w:p>${run(lead)}<w:r><w:pict>` +
  `<v:shape id="box1" o:spid="_x0000_s1026" style="width:200pt;height:80pt">` +
  `<v:textbox><w:txbxContent><w:p>${storyXml}</w:p></w:txbxContent></v:textbox>` +
  `</v:shape></w:pict></w:r></w:p>`;

type Links = Array<[id: string, target: string]>;

interface PackageSpec {
  body: string;
  /** External hyperlink relationships of the main document part. */
  bodyLinks?: Links;
  footer?: string;
  /** External hyperlink relationships of the footer part. */
  footerLinks?: Links;
  /** An image relationship `rIdImage` of the footer part, and its bytes. */
  footerImage?: { target: string; bytes: Buffer };
}

function relationshipsXml(entries: Array<[id: string, type: string, target: string, external?: boolean]>): string {
  return `<Relationships xmlns="${PKG_NS}">` +
    entries.map(([id, type, target, external]) =>
      `<Relationship Id="${id}" Type="${type}" Target="${target}"` +
      `${external ? ' TargetMode="External"' : ''}/>`).join('') +
    `</Relationships>`;
}

async function buildPackage(spec: PackageSpec): Promise<Buffer> {
  const archive = await DocxArchive.load(
    await buildDocxFromBodyXml(spec.body, [], { namespaces: NAMESPACES, ignorablePrefixes: [] }),
  );
  const documentRelationships: Array<[string, string, string, boolean?]> = (spec.bodyLinks ?? [])
    .map(([id, target]) => [id, HYPERLINK_TYPE, target, true]);
  if (spec.footer !== undefined) {
    archive.setDocumentXml((await archive.getDocumentXml()).replace(
      '<w:sectPr/>',
      '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>',
    ));
    documentRelationships.push(['rIdFooter', `${R_NS}/footer`, 'footer1.xml']);
    archive.setFile(
      'word/footer1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:ftr xmlns:w="${W_NS}"${STORY_NAMESPACES}>${spec.footer}</w:ftr>`,
    );
    const footerRelationships: Array<[string, string, string, boolean?]> = (spec.footerLinks ?? [])
      .map(([id, target]) => [id, HYPERLINK_TYPE, target, true]);
    if (spec.footerImage) {
      footerRelationships.push(['rIdImage', `${R_NS}/image`, spec.footerImage.target]);
      archive.setFile(`word/${spec.footerImage.target}`, spec.footerImage.bytes);
    }
    archive.setFile('word/_rels/footer1.xml.rels', relationshipsXml(footerRelationships));
    const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
    archive.setFile('[Content_Types].xml', contentTypes
      .replace('<Default Extension="xml"', '<Default Extension="png" ContentType="image/png"/><Default Extension="xml"')
      .replace(
        '</Types>',
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
      ));
  }
  archive.setFile('word/_rels/document.xml.rels', relationshipsXml(documentRelationships));
  return archive.save();
}

function relationshipsPath(partPath: string): string {
  return posix.join(posix.dirname(partPath), '_rels', `${posix.basename(partPath)}.rels`);
}

/**
 * What a reader sees of one story part: each paragraph's text, with every
 * hyperlink spelled as `[text](target)` through the part's own relationship
 * table. Relationship ids are deliberately left out: only what they resolve
 * to matters.
 */
async function storyView(
  buffer: Buffer,
  partPath: string,
  project: (xml: string) => string = (xml) => xml,
): Promise<string[]> {
  const archive = await DocxArchive.load(buffer);
  const document = parseXml(project((await archive.getFile(partPath))!));
  const rels = await archive.getFile(relationshipsPath(partPath));
  const relationships = rels
    ? Array.from(parseXml(rels).getElementsByTagNameNS(PKG_NS, 'Relationship'))
    : [];
  const targets = new Map(relationships.map((relationship) => [
    relationship.getAttribute('Id'),
    `${relationship.getAttribute('Target')}|${relationship.getAttribute('TargetMode') ?? ''}`,
  ]));
  const imageDigest = async (id: string): Promise<string> => {
    const target = relationships
      .find((relationship) => relationship.getAttribute('Id') === id)
      ?.getAttribute('Target');
    const bytes = target === undefined || target === null
      ? null
      : await archive.getFileBuffer(posix.normalize(posix.join(posix.dirname(partPath), target)));
    return bytes ? createHash('sha256').update(bytes).digest('hex').slice(0, 12) : `missing:${id}`;
  };
  const paragraphText = (paragraph: Element): string => {
    let text = '';
    const visit = (node: Node): void => {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== 1) continue;
        const element = child as Element;
        if (element.namespaceURI === W_NS && element.localName === 'p') continue;
        if (element.namespaceURI === W_NS && element.localName === 'txbxContent') continue;
        if (element.namespaceURI === W_NS && element.localName === 't') {
          text += element.textContent ?? '';
        } else if (element.namespaceURI === W_NS && element.localName === 'hyperlink') {
          const id = element.getAttributeNS(R_NS, 'id') ?? '';
          const before = text;
          text = '';
          visit(element);
          // A link with no text shows nothing a reader can follow (docx-core
          // Reject All leaves an emptied link container in place).
          text = text === ''
            ? before
            : `${before}[${text}](${targets.get(id) ?? `missing:${id}`})`;
        } else {
          visit(element);
        }
      }
    };
    visit(paragraph);
    return text;
  };
  const view = Array.from(document.getElementsByTagNameNS(W_NS, 'p'))
    .map((paragraph) => `p:${paragraphText(paragraph)}`);
  for (const image of Array.from(document.getElementsByTagNameNS(VML_NS, 'imagedata'))) {
    view.push(`image:${await imageDigest(image.getAttributeNS(OFFICE_NS, 'relid') ?? '')}`);
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
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1381-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Every relationship id of `partPath` is declared once. */
async function assertUniqueRelationshipIds(buffer: Buffer, partPath: string): Promise<void> {
  const rels = await (await DocxArchive.load(buffer)).getFile(relationshipsPath(partPath));
  const ids = rels
    ? Array.from(parseXml(rels).getElementsByTagNameNS(PKG_NS, 'Relationship'))
      .map((relationship) => relationship.getAttribute('Id'))
    : [];
  expect(new Set(ids).size).toBe(ids.length);
}

/**
 * Accept All reproduces the revised story and Reject All the original, link
 * targets included, through the comparison's acceptor and docx-core's; the
 * owning part declares each relationship id once; and the output passes the
 * emitted-document schema gate.
 */
async function assertFaithfulRedline(
  original: Buffer,
  revised: Buffer,
  compared: Buffer,
  partPath: string,
): Promise<void> {
  const originalView = await storyView(original, partPath);
  const revisedView = await storyView(revised, partPath);
  expect(originalView).not.toEqual(revisedView);
  expect(await storyView(compared, partPath, acceptAllChanges)).toEqual(revisedView);
  expect(await storyView(compared, partPath, rejectAllChanges)).toEqual(originalView);
  expect(await storyView(await docxCoreProjection(compared, 'accept'), partPath)).toEqual(revisedView);
  expect(await storyView(await docxCoreProjection(compared, 'reject'), partPath)).toEqual(originalView);
  await assertUniqueRelationshipIds(compared, partPath);
  await assertSchema(compared);
}

/** The tracked revisions inside the first text box of `partPath`. */
async function textBoxRevisions(buffer: Buffer, partPath: string): Promise<{ ins: number; del: number }> {
  const xml = (await (await DocxArchive.load(buffer)).getFile(partPath))!;
  const box = parseXml(xml).getElementsByTagNameNS(W_NS, 'txbxContent').item(0)!;
  return {
    ins: box.getElementsByTagNameNS(W_NS, 'ins').length,
    del: box.getElementsByTagNameNS(W_NS, 'del').length,
  };
}

interface HyperlinkCase {
  label: string;
  original: PackageSpec;
  revised: PackageSpec;
  partPath: string;
}

const BODY = 'word/document.xml';
const FOOTER = 'word/footer1.xml';
const plainBody = `<w:p>${run('Body')}</w:p>`;

const CASES: HyperlinkCase[] = [
  {
    label: 'a hyperlink added in a body text box',
    original: { body: textBoxParagraph('Intro', run('See terms')) },
    revised: {
      body: textBoxParagraph('Intro', `${run('See ')}${link('rIdLink', 'terms')}`),
      bodyLinks: [['rIdLink', 'https://example.com/terms']],
    },
    partPath: BODY,
  },
  {
    label: 'a hyperlink retargeted under the same id in a body text box',
    original: {
      body: textBoxParagraph('Intro', `${run('See ')}${link('rIdLink', 'terms')}`),
      bodyLinks: [['rIdLink', 'https://example.com/old-terms']],
    },
    revised: {
      body: textBoxParagraph('Intro', `${run('See ')}${link('rIdLink', 'terms')}`),
      bodyLinks: [['rIdLink', 'https://example.com/terms']],
    },
    partPath: BODY,
  },
  {
    label: 'a hyperlink retargeted under a new id in a body text box, beside an ordinary body edit',
    original: {
      body: `<w:p>${run('The parties agree.')}</w:p>` +
        textBoxParagraph('Intro', `${run('See ')}${link('rIdOld', 'terms')}`),
      bodyLinks: [['rIdOld', 'https://example.com/old-terms']],
    },
    revised: {
      body: `<w:p>${run('The parties now agree.')}</w:p>` +
        textBoxParagraph('Intro', `${run('See ')}${link('rIdNew', 'terms')}`),
      bodyLinks: [['rIdNew', 'https://example.com/terms']],
    },
    partPath: BODY,
  },
  {
    label: 'a hyperlink removed from a body text box',
    original: {
      body: textBoxParagraph('Intro', `${run('See ')}${link('rIdLink', 'terms')}`),
      bodyLinks: [['rIdLink', 'https://example.com/terms']],
    },
    revised: { body: textBoxParagraph('Intro', run('See terms')) },
    partPath: BODY,
  },
  {
    label: 'a hyperlink added in a footer text box',
    original: { body: plainBody, footer: textBoxParagraph('Page', run('See terms')) },
    revised: {
      body: plainBody,
      footer: textBoxParagraph('Page', `${run('See ')}${link('rIdLink', 'terms')}`),
      footerLinks: [['rIdLink', 'https://example.com/terms']],
    },
    partPath: FOOTER,
  },
  {
    label: 'a hyperlink retargeted under the same id in a footer text box',
    original: {
      body: plainBody,
      footer: textBoxParagraph('Page', `${run('See ')}${link('rIdLink', 'terms')}`),
      footerLinks: [['rIdLink', 'https://example.com/old-terms']],
    },
    revised: {
      body: plainBody,
      footer: textBoxParagraph('Page', `${run('See ')}${link('rIdLink', 'terms')}`),
      footerLinks: [['rIdLink', 'https://example.com/terms']],
    },
    partPath: FOOTER,
  },
  {
    label: 'a hyperlink retargeted in a footer text box beside an unchanged footer link',
    original: {
      body: plainBody,
      footer: `<w:p>${link('rId1', 'Home')}</w:p>` +
        textBoxParagraph('Page', `${run('See ')}${link('rId2', 'terms')}`),
      footerLinks: [['rId1', 'https://example.com/'], ['rId2', 'https://example.com/old-terms']],
    },
    revised: {
      body: plainBody,
      footer: `<w:p>${link('rId1', 'Home')}</w:p>` +
        textBoxParagraph('Page', `${run('See ')}${link('rId2', 'terms')}`),
      footerLinks: [['rId1', 'https://example.com/'], ['rId2', 'https://example.com/terms']],
    },
    partPath: FOOTER,
  },
  {
    label: 'a hyperlink removed from a footer text box',
    original: {
      body: plainBody,
      footer: textBoxParagraph('Page', `${run('See ')}${link('rIdLink', 'terms')}`),
      footerLinks: [['rIdLink', 'https://example.com/terms']],
    },
    revised: { body: plainBody, footer: textBoxParagraph('Page', run('See terms')) },
    partPath: FOOTER,
  },
];

async function compareCase({ original, revised }: HyperlinkCase) {
  const originalBuffer = await buildPackage(original);
  const revisedBuffer = await buildPackage(revised);
  return {
    original: originalBuffer,
    revised: revisedBuffer,
    result: await compareDocumentsAtomizer(originalBuffer, revisedBuffer, COMPARE_OPTIONS),
  };
}

describe('Hyperlinks added or retargeted inside a text box (#1381)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  for (const hyperlinkCase of CASES) {
    test(`tracks ${hyperlinkCase.label}`, async ({ given, when, then, and }: AllureBddContext) => {
      const cases = await given('two documents whose text-box link closure differs', () => hyperlinkCase);
      const compared = await when('the documents are compared', () => compareCase(cases));
      await then('the link change is tracked inside the text box', async () => {
        const revisions = await textBoxRevisions(compared.result.document, hyperlinkCase.partPath);
        expect(revisions.ins + revisions.del).toBeGreaterThan(0);
        // A footer whose markup changed is still listed as a changed footer
        // even when its text-box story is redlined; PR #1435 narrows that
        // listing to changes the redline does not carry.
        expect((compared.result.unrepresentedChanges ?? [])
          .filter((change) => change.scope !== 'footer')).toEqual([]);
      });
      await and('accept and reject reproduce the revised and original link targets', () =>
        assertFaithfulRedline(
          compared.original,
          compared.revised,
          compared.result.document,
          hyperlinkCase.partPath,
        ));
      if (hyperlinkCase.partPath !== BODY) {
        await and('the body relationship table gains no footer link', async () => {
          const rels = (await (await DocxArchive.load(compared.result.document))
            .getFile('word/_rels/document.xml.rels'))!;
          const types = Array.from(parseXml(rels).getElementsByTagNameNS(PKG_NS, 'Relationship'))
            .map((relationship) => relationship.getAttribute('Type'));
          expect(types).not.toContain(HYPERLINK_TYPE);
        });
      }
    });
  }

  for (const [label, original, revised] of [
    [
      'added',
      { body: `<w:p>${run('See terms')}</w:p>` },
      { body: `<w:p>${run('See ')}${link('rIdLink', 'terms')}</w:p>`, bodyLinks: [['rIdLink', 'https://example.com/terms']] },
    ],
    [
      'retargeted',
      { body: `<w:p>${run('See ')}${link('rIdLink', 'terms')}</w:p>`, bodyLinks: [['rIdLink', 'https://example.com/old-terms']] },
      { body: `<w:p>${run('See ')}${link('rIdLink', 'terms')}</w:p>`, bodyLinks: [['rIdLink', 'https://example.com/terms']] },
    ],
  ] as Array<[string, PackageSpec, PackageSpec]>) {
    test(`keeps the link container outside the revision for a hyperlink ${label} in body text`, async ({
      given, when, then, and,
    }: AllureBddContext) => {
      // The story comparison and the body share one serializer: a side-only
      // link is emitted as w:hyperlink > w:ins|w:del, never the reverse.
      const bodyCase = await given('a body paragraph whose link is added or retargeted', () => ({
        label, original, revised, partPath: BODY,
      }));
      const compared = await when('the documents are compared', () => compareCase(bodyCase));
      await then('no revision wrapper holds a hyperlink', async () => {
        const document = parseXml(await (await DocxArchive.load(compared.result.document)).getDocumentXml());
        const wrapped = Array.from(document.getElementsByTagNameNS(W_NS, 'hyperlink')).filter((hyperlink) =>
          hyperlink.parentNode?.nodeType === 1 &&
          ['ins', 'del'].includes((hyperlink.parentNode as Element).localName));
        expect(wrapped).toEqual([]);
        expect(document.getElementsByTagNameNS(W_NS, 'ins').length).toBeGreaterThan(0);
      });
      await and('accept and reject reproduce the revised and original link targets', () =>
        assertFaithfulRedline(compared.original, compared.revised, compared.result.document, BODY));
    });
  }

  test('tracks a footer text-box picture whose o:relid now names another image, beside a box edit', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    // The same import carries an internal target: the original image part is
    // copied in and bound through the footer's own relationship part.
    const footer = (text: string): string => textBoxParagraph('Page', run(text) + relidPicture('rIdImage'));
    const pictureCase = await given('a footer box whose text changes and whose picture names another image part', () => ({
      label: 'footer picture retarget',
      original: { body: plainBody, footer: footer('Box old'), footerImage: { target: 'media/logo1.png', bytes: PNG } },
      revised: { body: plainBody, footer: footer('Box new'), footerImage: { target: 'media/logo2.png', bytes: OTHER_PNG } },
      partPath: FOOTER,
    }));
    const compared = await when('the documents are compared', () => compareCase(pictureCase));
    await then('the old picture is deleted and the new one inserted inside the box', async () => {
      const xml = (await (await DocxArchive.load(compared.result.document)).getFile(FOOTER))!;
      const placement = Array.from(parseXml(xml).getElementsByTagNameNS(VML_NS, 'imagedata'))
        .map((image) => {
          for (let node = image.parentNode; node; node = node.parentNode) {
            const element = node as Element;
            if (node.nodeType === 1 && element.namespaceURI === W_NS && ['ins', 'del'].includes(element.localName)) {
              return element.localName;
            }
          }
          return 'kept';
        });
      expect(placement).toEqual(['del', 'ins']);
    });
    await and('accept and reject reproduce each footer, image bytes included', () =>
      assertFaithfulRedline(compared.original, compared.revised, compared.result.document, FOOTER));
  });
});

/** The `text:a` link targets of a LibreOffice-saved ODT, in reading order. */
async function odtLinks(odt: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(odt);
  const links: string[] = [];
  for (const file of ['content.xml', 'styles.xml']) {
    const xml = await zip.file(file)?.async('string');
    if (!xml) continue;
    for (const anchor of Array.from(
      parseXml(xml).getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:text:1.0', 'a'),
    )) {
      links.push(`${anchor.textContent}->${anchor.getAttributeNS('http://www.w3.org/1999/xlink', 'href')}`);
    }
  }
  return links;
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice.
const reader = process.env.SAFE_DOCX_TEXT_BOX_HYPERLINK_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice reads a redlined text-box hyperlink as the source links (#1381)', () => {
  test('accepts and rejects body and footer text-box link changes to the revised and original targets', async () => {
    const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
    const cases = await Promise.all(CASES.map(compareCase));
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
        packages.slice(index * 4, index * 4 + 4).map(odtLinks),
      );
      expect(original, CASES[index]!.label).not.toEqual(revised);
      expect(accepted, CASES[index]!.label).toEqual(revised);
      expect(rejected, CASES[index]!.label).toEqual(original);
    }
  }, 600_000);
});
