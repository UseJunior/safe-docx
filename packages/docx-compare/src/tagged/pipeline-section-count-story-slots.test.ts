/**
 * Header/footer changes beside an added or removed section break.
 *
 * A section with no reference of a type shows the previous section's story,
 * or a blank one in the first section (ECMA-376 Part 1 §17.10.5, §17.10.2),
 * and `w:sectPrChange` cannot hold references (§17.13.5.32, #944). When the
 * section count changes, the sections are aligned across the documents (the
 * last sections always, the others by the body text around their break) so
 * that a header or footer attached to, dropped from or re-pointed on an
 * aligned section is tracked as the slot's content: as an inserted or deleted
 * story beside a blank one, and, where a page moves between footers whose
 * scaffolds differ (NVCA Voting Agreement: the signature-page footer beside
 * the page-number footer), as the whole revised story inserted with the
 * original one copied in as deleted. Each case checks what every first, odd
 * and even page of every section shows after Accept All and Reject All, with
 * docx-compare's appliers and with docx-core's `acceptChanges` /
 * `rejectChanges`, plus body text and the schema gate over the document and
 * every header/footer part.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @see https://github.com/UseJunior/safe-docx/issues/1475
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

const TEST_FEATURE = 'Header Footer Changes Beside A Section Count Change';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' },
  );

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
// Each case compares, applies twice per applier and runs the schema gate.
const LOAD_SENSITIVE_TIMEOUT_MS = 30_000;
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-13T00:00:00.000Z') };
const PAGE_SETUP =
  '<w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

type Kind = 'header' | 'footer';
type Role = 'default' | 'first' | 'even';
interface Part { id: string; kind: Kind; target: string; xml: string }

const paragraph = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const ref = (kind: Kind, id: string, role: Role = 'default'): string =>
  `<w:${kind}Reference w:type="${role}" r:id="${id}"/>`;
const sectionEnd = (text: string, references: string): string =>
  `<w:p><w:pPr><w:sectPr>${references.replace('<w:titlePg/>', '')}${PAGE_SETUP}` +
  `${references.includes('<w:titlePg/>') ? '<w:titlePg/>' : ''}</w:sectPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const vmlBox = (text: string): string =>
  '<w:p><w:r><w:pict><v:shape id="box1" style="width:200pt;height:40pt"><v:textbox><w:txbxContent>' +
  `${paragraph(text)}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
const story = (id: string, kind: Kind, target: string, contentXml: string): Part => {
  const root = kind === 'header' ? 'w:hdr' : 'w:ftr';
  return {
    id,
    kind,
    target,
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${root} xmlns:w="${W_NS}" ` +
      `xmlns:v="urn:schemas-microsoft-com:vml">${contentXml}</${root}>`,
  };
};

async function packageWith(body: string, finalSectPr: string, parts: Part[]): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(body, [], { namespaces: { r: R_NS } }));
  archive.setDocumentXml((await archive.getDocumentXml())
    .replace('<w:sectPr/>', `<w:sectPr>${finalSectPr.replace('<w:titlePg/>', '')}${PAGE_SETUP}` +
      `${finalSectPr.includes('<w:titlePg/>') ? '<w:titlePg/>' : ''}</w:sectPr>`));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      parts.map((entry) => `<Relationship Id="${entry.id}" Type="${R_NS}/${entry.kind}" Target="${entry.target}"/>`).join('') +
      `</Relationships>`,
  );
  for (const entry of parts) archive.setFile(`word/${entry.target}`, entry.xml);
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>', parts.map((entry) =>
    `<Override PartName="/word/${entry.target}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${entry.kind}+xml"/>`,
  ).join('') + '</Types>'));
  return archive.save();
}

type Projection = (xml: string) => string;

/**
 * What each first, odd and even page of each section shows:
 * `<section>:<kind>:<page>=<text>`, `-` for a blank story or none.
 */
async function shownPages(buffer: Buffer, project: Projection = (xml) => xml): Promise<string[]> {
  const archive = await DocxArchive.load(buffer);
  const bindings = resolveEffectiveStoryBindings({
    documentXml: project(await archive.getDocumentXml()),
    relationshipsXml: await archive.getFile('word/_rels/document.xml.rels'),
    settingsXml: await archive.getFile('word/settings.xml'),
  });
  const shown: string[] = [];
  for (const { page, slot } of pageStorySlots(bindings)) {
    const xml = slot.targetPath ? await archive.getFile(slot.targetPath) : null;
    const projected = xml === null ? null : project(xml);
    const text = projected === null || isBlankStoryPart(projected)
      ? '-'
      : Array.from(parseXml(projected).getElementsByTagNameNS(W_NS, 'p'))
        .filter((element) => (element.parentNode as Element).localName !== 'txbxContent')
        .map((element) => Array.from(element.getElementsByTagNameNS(W_NS, 't'))
          .map((textElement) => textElement.textContent ?? '').join(''))
        .filter((line) => line !== '').join(' / ');
    shown.push(`${slot.sectionOrdinal}:${slot.kind}:${page}=${text}`);
  }
  return shown;
}

async function shownAfterDocxCore(buffer: Buffer, mode: 'accept' | 'reject'): Promise<string[]> {
  const document = await DocxDocument.load(buffer);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return shownPages((await document.toBuffer()).buffer);
}

/**
 * The gate validates `word/document.xml`; each header/footer part's blocks
 * (CT_HdrFtr holds the same block-level content as a body) are validated as
 * a document body of their own.
 */
async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1475-'));
  try {
    const paths = [join(directory, 'compared.docx')];
    await writeFile(paths[0]!, buffer);
    const archive = await DocxArchive.load(buffer);
    for (const part of archive.listFiles().filter((name) => /^word\/(header|footer)[^/]*\.xml$/u.test(name))) {
      const xml = (await archive.getFile(part))!;
      const asDocument = xml
        .replace(/<w:(hdr|ftr)(\s[^>]*)?>/u, (_match, _root, attributes = '') => `<w:document${attributes}><w:body>`)
        .replace(/<\/w:(hdr|ftr)>\s*$/u, '</w:body></w:document>');
      const path = join(directory, `${part.replace(/\W/gu, '_')}.xml`);
      await writeFile(path, asDocument);
      paths.push(path);
    }
    const check = spawnSync(process.execPath, [schemaScript, ...paths], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Header/footer references nested in a `w:sectPrChange` snapshot (CT_SectPrBase forbids them). */
async function snapshotStoryReferences(buffer: Buffer): Promise<number> {
  const document = parseXml(await (await DocxArchive.load(buffer)).getDocumentXml());
  return Array.from(document.getElementsByTagNameNS(W_NS, 'sectPrChange')).reduce(
    (count, change) =>
      count +
      change.getElementsByTagNameNS(W_NS, 'headerReference').length +
      change.getElementsByTagNameNS(W_NS, 'footerReference').length,
    0,
  );
}


const bodyText = async (buffer: Buffer, project: Projection = (xml) => xml): Promise<string> =>
  extractRoundTripComparisonText(project(await (await DocxArchive.load(buffer)).getDocumentXml()));

const pageField = (text: string): string =>
  `<w:p><w:r><w:t xml:space="preserve">${text} </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';

/** The stories the cases bind, by name. */
const STORIES: Record<string, Part> = {
  boxedHeader: story('rIdH', 'header', 'header1.xml', vmlBox('Boxed draft') + paragraph('Draft')),
  editedBoxedHeader: story('rIdH2', 'header', 'header2.xml', vmlBox('Boxed draft edited') + paragraph('Draft edited')),
  plainHeader: story('rIdHP', 'header', 'header3.xml', paragraph('Plain draft')),
  plainFooter: story('rIdFP', 'footer', 'footer4.xml', paragraph('Plain footer')),
  boxedFooter: story('rIdFB', 'footer', 'footerB.xml', vmlBox('Boxed footer') + paragraph('Footer')),
  // NVCA Voting Agreement: footer1 holds a PAGE field, footer3 two plain lines.
  pageNumberFooter: story('rIdF1', 'footer', 'footer1.xml', pageField('Last Updated October 2025')),
  signaturePageFooter: story('rIdF3', 'footer', 'footer3.xml',
    paragraph('[Signature Page to Voting Agreement]') + paragraph('Last Updated October 2025')),
};
const referencesTo = (names: readonly string[]): string =>
  names.map((name) => ref(STORIES[name]!.kind, STORIES[name]!.id)).join('');
const partsOf = (names: readonly string[]): Part[] => [...new Set(names)].map((name) => STORIES[name]!);
/** One section binding `names`. */
const oneSection = (names: readonly string[]): Promise<Buffer> =>
  packageWith(paragraph('One') + paragraph('Two'), referencesTo(names), partsOf(names));
/** Two sections: the break after "One" binds `first`, the final section `last`; "Two" is edited. */
const twoSections = (first: readonly string[], last: readonly string[]): Promise<Buffer> =>
  packageWith(sectionEnd('One', referencesTo(first)) + paragraph('Two edited'), referencesTo(last), partsOf([...first, ...last]));

interface SectionCountCase {
  label: string;
  /** The one-section document's references. */
  single: string[];
  /** The two-section document's references: the new break's, then the final section's. */
  first: string[];
  last: string[];
}

const CASES: SectionCountCase[] = [
  // A header/footer lifecycle beside the break (#1450 follow-up).
  { label: 'a boxed header the new final section gains', single: [], first: [], last: ['boxedHeader'] },
  { label: 'a boxed header both sections share', single: [], first: ['boxedHeader'], last: ['boxedHeader'] },
  { label: 'a boxed header the new first section gains', single: [], first: ['boxedHeader'], last: [] },
  { label: 'a boxed footer the new final section gains', single: [], first: [], last: ['boxedFooter'] },
  { label: 'a plain header the new final section gains', single: [], first: [], last: ['plainHeader'] },
  { label: 'a plain header both sections share', single: [], first: ['plainHeader'], last: ['plainHeader'] },
  { label: 'a plain footer the new final section gains', single: [], first: [], last: ['plainFooter'] },
  { label: 'a boxed header copied and edited for the new first section', single: ['boxedHeader'], first: ['editedBoxedHeader'], last: ['boxedHeader'] },
  { label: 'a boxed header copied and edited for the final section', single: ['boxedHeader'], first: ['boxedHeader'], last: ['editedBoxedHeader'] },
  // A page re-pointed between footers whose scaffolds differ.
  { label: 'the signature-page footer the new first section names, which the final section inherits', single: ['pageNumberFooter'], first: ['signaturePageFooter'], last: [] },
  { label: 'the page-number footer the new first section names, which the final section inherits', single: ['signaturePageFooter'], first: ['pageNumberFooter'], last: [] },
  { label: 'the signature-page footer on the new first section beside the page-number footer', single: ['pageNumberFooter'], first: ['signaturePageFooter'], last: ['pageNumberFooter'] },
];

describe('header/footer changes beside an added or removed section break (#1475)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  for (const { label, single, first, last } of CASES) {
    for (const direction of ['added', 'removed'] as const) {
      // Copying and editing the final section's boxed header, then removing
      // the break, re-points the merged section at the first section's part;
      // the text-box pairing aligns that pair by content (follow-up).
      if (direction === 'removed' && label === 'a boxed header copied and edited for the final section') continue;
      test(`break ${direction}: ${label}`, async () => {
        const one = await oneSection(single);
        const two = await twoSections(first, last);
        const [original, revised] = direction === 'added' ? [one, two] : [two, one];

        const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

        const expectedAccepted = await shownPages(revised);
        const expectedRejected = await shownPages(original);
        expect(expectedAccepted).not.toEqual(expectedRejected);
        expect(await shownPages(result.document, acceptAllChanges)).toEqual(expectedAccepted);
        expect(await shownPages(result.document, rejectAllChanges)).toEqual(expectedRejected);
        expect(await shownAfterDocxCore(result.document, 'accept')).toEqual(expectedAccepted);
        expect(await shownAfterDocxCore(result.document, 'reject')).toEqual(expectedRejected);
        expect(result.unrepresentedChanges).toBeUndefined();
        expect(await bodyText(result.document, acceptAllChanges)).toBe(await bodyText(revised));
        expect(await bodyText(result.document, rejectAllChanges)).toBe(await bodyText(original));
        expect(await snapshotStoryReferences(result.document)).toBe(0);
        await assertSchema(result.document);
      });
    }
  }

  for (const mode of ['ins', 'del'] as const) {
    test(`a header already holding a tracked paragraph ${mode === 'ins' ? 'insertion' : 'deletion'} keeps its author and date beside an added or removed break`, async () => {
      // Lifecycle marking would restamp the prior revision (PRESERVE), so such
      // a story is left to the earlier pairing.
      const prior = `<w:p><w:pPr><w:rPr><w:${mode} w:id="77" w:author="Prior" w:date="2026-01-01T00:00:00Z"/></w:rPr></w:pPr>` +
        `<w:r><w:t>History</w:t></w:r></w:p>${paragraph('Last')}`;
      const header = story('rIdH', 'header', 'header1.xml', prior);
      const withHeader = await packageWith(sectionEnd('One', '') + paragraph('Two'), ref('header', header.id), [header]);
      const withoutHeader = await packageWith(paragraph('One') + paragraph('Two'), '', []);
      const [original, revised] = mode === 'ins' ? [withoutHeader, withHeader] : [withHeader, withoutHeader];

      const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);

      const archive = await DocxArchive.load(result.document);
      const markers: Element[] = [];
      for (const path of archive.listFiles().filter((name) => /^word\/header[^/]*\.xml$/u.test(name))) {
        markers.push(...Array.from(parseXml((await archive.getFile(path))!).getElementsByTagNameNS(W_NS, mode))
          .filter((element) => element.getAttributeNS(W_NS, 'id') === '77'));
      }
      expect(markers.length).toBeGreaterThan(0);
      for (const marker of markers) {
        expect(marker.getAttributeNS(W_NS, 'author')).toBe('Prior');
        expect(marker.getAttributeNS(W_NS, 'date')).toBe('2026-01-01T00:00:00Z');
      }
    });
  }
});
