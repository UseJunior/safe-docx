/**
 * Word's "unlink from previous" footer shape beside a section break. When a
 * user adds a section break and edits the new section's footer, Word keeps
 * the original footer part on the first section and points the last section
 * at an edited copy (a new part, a new relationship id). Removing the break
 * again leaves one section bound to the copy. Header/footer references bind
 * a section to a part through its relationship (§17.10.2), so the comparison
 * must match the parts by identity, not by literal `r:id`, and must produce a
 * redline whose Accept All shows the revised footers and whose Reject All
 * shows the original footers, for plain footers and for footers holding a
 * VML or DrawingML text box (§20.4.2.38).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 20.4.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/1500
 * @see https://github.com/UseJunior/safe-docx/issues/1420
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { DocxArchive, DocxDocument, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import {
  isBlankStoryPart,
  pageStorySlots,
  resolveEffectiveStoryBindings,
} from './effectiveStoryBindings.js';

const TEST_FEATURE = 'Unlinked Footer Beside Section Break';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '20.4.2.38' },
  );

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const STORY_NS =
  `xmlns:w="${W_NS}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"` +
  ' xmlns:w10="urn:schemas-microsoft-com:office:word"' +
  ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
  ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
  ' xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-22T00:00:00.000Z') };
const PAGE_SETUP =
  '<w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

interface Part { id: string; target: string; xml: string }
type FooterStyle = 'plain' | 'vml box' | 'drawingml box';

const paragraph = (text: string): string => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const footerRef = (id: string, role = 'default'): string => `<w:footerReference w:type="${role}" r:id="${id}"/>`;

function vmlBox(text: string): string {
  return '<w:p><w:r><w:pict><v:shape id="box1" o:spid="_x0000_s1026" type="#_x0000_t202"' +
    ' style="position:absolute;margin-left:10pt;margin-top:0;width:200pt;height:50pt;z-index:1">' +
    `<v:textbox><w:txbxContent>${paragraph(text)}</w:txbxContent></v:textbox>` +
    '<w10:wrap type="square"/></v:shape></w:pict></w:r></w:p>';
}

function drawingMlBox(text: string, docPrId = 1): string {
  return '<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0"' +
    ' relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>127000</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="2540000" cy="635000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:wrapSquare wrapText="bothSides"/><wp:docPr id="${docPrId}" name="Text Box ${docPrId}"/>` +
    '<wp:cNvGraphicFramePr/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2540000" cy="635000"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${paragraph(text)}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>` +
    '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>';
}

function footer(id: string, target: string, style: FooterStyle, suffix: string, docPrId = 1): Part {
  const box = style === 'vml box' ? vmlBox(`Box${suffix}`) : style === 'drawingml box' ? drawingMlBox(`Box${suffix}`, docPrId) : '';
  return {
    id,
    target,
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${STORY_NS}>` +
      `${paragraph(`Footer${suffix}`)}${box}</w:ftr>`,
  };
}

async function packageWith(body: string, finalReferences: string, parts: Part[], tail = ''): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(body, [], { namespaces: { r: R_NS } }));
  archive.setDocumentXml((await archive.getDocumentXml())
    .replace('<w:sectPr/>', `<w:sectPr>${finalReferences}${PAGE_SETUP}${tail}</w:sectPr>`));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      parts.map((entry) => `<Relationship Id="${entry.id}" Type="${R_NS}/footer" Target="${entry.target}"/>`).join('') +
      '</Relationships>',
  );
  for (const entry of parts) archive.setFile(`word/${entry.target}`, entry.xml);
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>', parts.map((entry) =>
    `<Override PartName="/word/${entry.target}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`,
  ).join('') + '</Types>'));
  return archive.save();
}

/** One section bound to the original footer part. */
const oneSection = (style: FooterStyle): Promise<Buffer> =>
  packageWith(
    paragraph('Alpha paragraph.') + paragraph('Beta paragraph.') + paragraph('Gamma paragraph.'),
    footerRef('rIdF1'),
    [footer('rIdF1', 'footer1.xml', style, '')],
  );

/** Word's unlink shape: the first section keeps the original part, the last points at an edited copy. */
const unlinked = (style: FooterStyle): Promise<Buffer> =>
  packageWith(
    paragraph('Alpha paragraph.') +
      `<w:p><w:pPr><w:sectPr>${footerRef('rIdF1')}<w:type w:val="nextPage"/>${PAGE_SETUP}</w:sectPr></w:pPr>` +
      '<w:r><w:t>Beta paragraph.</w:t></w:r></w:p>' +
      paragraph('Gamma paragraph.'),
    footerRef('rIdF2'),
    [footer('rIdF1', 'footer1.xml', style, ''), footer('rIdF2', 'footer2.xml', style, ' edited')],
  );

/** The break removed again: one section bound to the edited copy, the original part dropped. */
const mergedOntoCopy = (style: FooterStyle): Promise<Buffer> =>
  packageWith(
    paragraph('Alpha paragraph.') + paragraph('Beta paragraph.') + paragraph('Gamma paragraph.'),
    footerRef('rIdF2'),
    [footer('rIdF2', 'footer2.xml', style, ' edited')],
  );

type Projection = (xml: string) => string;

/** `<section>:<page>=<text>` for every page of every section; `-` for a blank story. */
async function shownPages(buffer: Buffer, project: Projection = (xml) => xml): Promise<string[]> {
  const archive = await DocxArchive.load(buffer);
  const bindings = resolveEffectiveStoryBindings({
    documentXml: project(await archive.getDocumentXml()),
    relationshipsXml: await archive.getFile('word/_rels/document.xml.rels'),
    settingsXml: await archive.getFile('word/settings.xml'),
  });
  const shown: string[] = [];
  for (const { page, slot } of pageStorySlots(bindings)) {
    if (slot.kind !== 'footer') continue;
    const xml = slot.targetPath ? await archive.getFile(slot.targetPath) : null;
    const projected = xml === null ? null : project(xml);
    const text = projected === null || isBlankStoryPart(projected)
      ? '-'
      : extractRoundTripComparisonText(projected).replace(/\s+/g, ' ').trim();
    shown.push(`${slot.sectionOrdinal}:${page}=${text}`);
  }
  return shown;
}

async function afterDocxCore(buffer: Buffer, mode: 'accept' | 'reject'): Promise<Buffer> {
  const document = await DocxDocument.load(buffer);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return (await document.toBuffer()).buffer;
}

const bodyText = async (buffer: Buffer, project: Projection = (xml) => xml): Promise<string> =>
  extractRoundTripComparisonText(project(await (await DocxArchive.load(buffer)).getDocumentXml()));

const sectionCount = async (buffer: Buffer, project: Projection = (xml) => xml): Promise<number> =>
  parseXml(project(await (await DocxArchive.load(buffer)).getDocumentXml()))
    .getElementsByTagNameNS(W_NS, 'sectPr').length;

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1500-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const STYLES: FooterStyle[] = ['plain', 'vml box', 'drawingml box'];
const DIRECTIONS = [
  { label: 'break added', original: oneSection, revised: unlinked },
  { label: 'break removed', original: unlinked, revised: mergedOntoCopy },
] as const;

describe("Word's unlink-from-previous footer beside a section break (#1500)", () => {
  for (const direction of DIRECTIONS) {
    for (const style of STYLES) {
      test(`${direction.label}, ${style} footer: Accept All shows the revised footers and Reject All the original footers`, async () => {
        const original = await direction.original(style);
        const revised = await direction.revised(style);

        const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
        const compared = result.document;

        const expectedAccept = await shownPages(revised);
        const expectedReject = await shownPages(original);
        expect(await shownPages(compared, acceptAllChanges)).toEqual(expectedAccept);
        expect(await shownPages(compared, rejectAllChanges)).toEqual(expectedReject);
        expect(await shownPages(await afterDocxCore(compared, 'accept'))).toEqual(expectedAccept);
        expect(await shownPages(await afterDocxCore(compared, 'reject'))).toEqual(expectedReject);

        expect(await sectionCount(compared, acceptAllChanges)).toBe(await sectionCount(revised));
        expect(await sectionCount(compared, rejectAllChanges)).toBe(await sectionCount(original));
        expect(await sectionCount(await afterDocxCore(compared, 'accept'))).toBe(await sectionCount(revised));
        expect(await sectionCount(await afterDocxCore(compared, 'reject'))).toBe(await sectionCount(original));
        expect(await bodyText(compared, acceptAllChanges)).toBe(await bodyText(revised));
        expect(await bodyText(compared, rejectAllChanges)).toBe(await bodyText(original));

        // The unchanged original part is never rewritten with revision marks.
        const archive = await DocxArchive.load(compared);
        const untouched = await archive.getFile('word/footer1.xml');
        if (untouched !== null && direction.label === 'break added') {
          expect(untouched).not.toMatch(/<w:(ins|del)\b/);
        }
        await assertSchema(compared);
      });
    }
  }

  test('break added, first-page and default DrawingML footers both unlinked: every copied drawing gets its own id', async () => {
    const body = (breakReferences?: string): string =>
      paragraph('Alpha paragraph.') +
      (breakReferences === undefined
        ? paragraph('Beta paragraph.')
        : `<w:p><w:pPr><w:sectPr>${breakReferences}<w:type w:val="nextPage"/>${PAGE_SETUP}<w:titlePg/></w:sectPr></w:pPr>` +
          '<w:r><w:t>Beta paragraph.</w:t></w:r></w:p>') +
      paragraph('Gamma paragraph.');
    const originalParts = [
      footer('rIdF1', 'footer1.xml', 'drawingml box', '', 1),
      footer('rIdP1', 'footerFirst1.xml', 'drawingml box', ' first', 2),
    ];
    const original = await packageWith(body(), footerRef('rIdF1') + footerRef('rIdP1', 'first'), originalParts, '<w:titlePg/>');
    const revised = await packageWith(
      body(footerRef('rIdF1') + footerRef('rIdP1', 'first')),
      footerRef('rIdF2') + footerRef('rIdP2', 'first'),
      [
        ...originalParts,
        footer('rIdF2', 'footer2.xml', 'drawingml box', ' edited', 3),
        footer('rIdP2', 'footerFirst2.xml', 'drawingml box', ' first edited', 4),
      ],
      '<w:titlePg/>',
    );

    const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
    const compared = result.document;
    expect(await shownPages(compared, acceptAllChanges)).toEqual(await shownPages(revised));
    expect(await shownPages(compared, rejectAllChanges)).toEqual(await shownPages(original));
    expect(await shownPages(await afterDocxCore(compared, 'accept'))).toEqual(await shownPages(revised));
    expect(await shownPages(await afterDocxCore(compared, 'reject'))).toEqual(await shownPages(original));

    const archive = await DocxArchive.load(compared);
    const ids: string[] = [];
    for (const path of archive.listFiles().filter((file) => /^word\/.*\.xml$/u.test(file))) {
      const xml = await archive.getFile(path);
      if (xml === null) continue;
      for (const docPr of Array.from(parseXml(xml).getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'docPr',
      ))) {
        ids.push(docPr.getAttribute('id') ?? '');
      }
    }
    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
    await assertSchema(compared);
  });
});
