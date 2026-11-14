/**
 * A header or footer table that gains or loses a row is tracked with whole-row
 * revisions, as a body table is: an inserted row carries `w:trPr/w:ins` and
 * a deleted row `w:trPr/w:del`, beside the revisions on its content, instead
 * of the story being left in `unrepresentedChanges`. That holds for a row of
 * plain paragraphs (#1393) and for a row holding a field, a content control
 * (inside a cell or around one), range markup or a nested table (#1467).
 *
 * Each case checks, for every default, first and even header and footer, the
 * tables and paragraphs each part shows after Accept All and Reject All, with
 * docx-compare's appliers and with docx-core's `acceptChanges`/`rejectChanges`,
 * against the revised and the original document, plus body text, the
 * formatting-fidelity check and the emitted-document schema gate.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.12
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @see https://github.com/UseJunior/safe-docx/issues/1393
 * @see https://github.com/UseJunior/safe-docx/issues/1467
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import {
  collectStrictFieldStructureIssues,
  DocxArchive,
  DocxDocument,
  OOXML,
  parseXml,
} from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { compareDocumentsAtomizer, type TaggedCompareResult } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { compareSourceProjectedFormattingFidelity } from './formattingFidelity.js';

const TEST_FEATURE = 'add-markdoc-header-footer-authoring';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.17' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.12' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
  );

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const VML_NS = 'urn:schemas-microsoft-com:vml';
// Each case compares, applies twice per applier and runs the schema gate.
const LOAD_SENSITIVE_TIMEOUT_MS = 30_000;
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-13T00:00:00.000Z') };
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

type Kind = 'header' | 'footer';
type Role = 'default' | 'first' | 'even';
const SLOTS: ReadonlyArray<{ kind: Kind; role: Role }> = (['header', 'footer'] as const).flatMap((kind) =>
  (['default', 'first', 'even'] as const).map((role) => ({ kind, role })));
const partPath = ({ kind, role }: { kind: Kind; role: Role }): string => `word/${kind}-${role}.xml`;

const text = (value: string): string => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
const pageField = (): string =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>1</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const paragraph = (content: string): string => `<w:p>${content}</w:p>`;
const cell = (content: string, tcPr = '<w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>'): string =>
  `<w:tc>${tcPr}${paragraph(content)}</w:tc>`;
/** A two-column row: a label and its value, each a plain paragraph unless given as markup. */
const row = (label: string, value: string, trPr = '', labelMerge = ''): string =>
  `<w:tr>${trPr}${cell(label ? text(label) : '', `<w:tcPr><w:tcW w:w="4500" w:type="dxa"/>${labelMerge}</w:tcPr>`)}`
  + `${cell(value.startsWith('<') ? value : text(value))}</w:tr>`;
const table = (...rows: string[]): string =>
  '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>' +
  `${rows.join('')}</w:tbl>`;
/** A story: a table followed by the paragraph CT_HdrFtr content ends with. */
const story = (...rows: string[]): string => table(...rows) + paragraph(text('Confidential'));

const COMPANY = row('Company', 'Acme Corp');
const ADDRESS = row('Address', '1 Main Street');
const PHONE = row('Phone', '555 0100');
const EMAIL = row('Email', 'legal@acme.test');
const MERGED_ADDRESS = '<w:tr><w:tc><w:tcPr><w:tcW w:w="9000" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr>'
  + `${paragraph(text('Address 1 Main Street'))}</w:tc></w:tr>`;

/**
 * One section whose six header/footer parts (default, first and even of each
 * kind) each hold `storyContent(kind, role)`; `w:titlePg` and
 * `w:evenAndOddHeaders` are on, so every part shows on some page.
 */
async function storyPackage(
  bodyText: string,
  storyContent: (slot: { kind: Kind; role: Role }) => string,
): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(
    `<w:p><w:r><w:t>${bodyText}</w:t></w:r></w:p>`,
    [],
    { namespaces: { r: R_NS } },
  ));
  const references = SLOTS.map((slot, index) =>
    `<w:${slot.kind}Reference w:type="${slot.role}" r:id="rIdStory${index}"/>`).join('');
  archive.setDocumentXml((await archive.getDocumentXml())
    .replace('<w:sectPr/>', `<w:sectPr>${references}<w:titlePg/></w:sectPr>`));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      SLOTS.map((slot, index) =>
        `<Relationship Id="rIdStory${index}" Type="${R_NS}/${slot.kind}" Target="${partPath(slot).slice(5)}"/>`).join('') +
      `<Relationship Id="rIdSettings" Type="${R_NS}/settings" Target="settings.xml"/></Relationships>`,
  );
  for (const slot of SLOTS) {
    const root = slot.kind === 'header' ? 'w:hdr' : 'w:ftr';
    archive.setFile(
      partPath(slot),
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${root} xmlns:w="${W_NS}" xmlns:r="${R_NS}"` +
        ` xmlns:v="${VML_NS}">${storyContent(slot)}</${root}>`,
    );
  }
  archive.setFile(
    'word/settings.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${W_NS}"><w:evenAndOddHeaders/></w:settings>`,
  );
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>', SLOTS.map((slot) =>
    `<Override PartName="/${partPath(slot)}"` +
    ` ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${slot.kind}+xml"/>`,
  ).join('') +
    '<Override PartName="/word/settings.xml"' +
    ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'));
  return archive.save();
}

const isW = (node: Node | null, name: string): boolean =>
  node !== null && node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === name;
const children = (element: Element, name: string): Element[] =>
  Array.from(element.childNodes).filter((child): child is Element => isW(child, name));

/**
 * The visible text of a paragraph, with a field's instruction kept as `{PAGE}`,
 * for a simple field as for the equivalent complex field.
 */
function paragraphText(p: Element): string {
  let value = '';
  for (const element of Array.from(p.getElementsByTagNameNS(W_NS, '*'))) {
    if (element.localName === 't') value += element.textContent ?? '';
    else if (element.localName === 'instrText') value += `{${(element.textContent ?? '').trim()}}`;
    else if (element.localName === 'fldSimple') value += `{${(element.getAttributeNS(W_NS, 'instr') ?? '').trim()}}`;
  }
  return value;
}

/** Revision records, which say how a property element changed rather than what it holds. */
const PROPERTY_REVISIONS = ['ins', 'del', 'trPrChange', 'tcPrChange', 'tblPrExChange'];

/**
 * A property element's properties without revision records, child order and
 * attributes kept; an empty or absent element reads as `''`.
 */
function propertySignature(properties: Element | undefined): string {
  if (!properties) return '';
  const describe = (element: Element): string => {
    const attributes = Array.from(element.attributes)
      .filter((attribute) => attribute.prefix !== 'xmlns' && attribute.name !== 'xmlns')
      .map((attribute) => `${attribute.localName}=${attribute.value}`).sort().join(',');
    return `${element.localName}[${attributes}](${Array.from(element.childNodes)
      .filter((child): child is Element => child.nodeType === 1).map(describe).join('')})`;
  };
  return Array.from(properties.childNodes)
    .filter((child): child is Element => child.nodeType === 1 && !PROPERTY_REVISIONS.includes((child as Element).localName))
    .map(describe).join('');
}

/**
 * What a story part shows, block by block: a paragraph as its text, a table as
 * its rows, each row as its row properties, table-property exceptions and
 * cells, each cell as its cell properties and paragraph texts, so a lost row,
 * a merged row, a misplaced cell or a property left behind reads differently.
 */
function storyView(xml: string): string[] {
  const root = parseXml(xml).documentElement;
  return Array.from(root.childNodes)
    .filter((child): child is Element => child.nodeType === 1)
    .map((block) => {
      if (isW(block, 'p')) return `p:${paragraphText(block)}`;
      if (isW(block, 'tbl')) {
        return 'tbl:' + children(block, 'tr').map((tr) =>
          `{${propertySignature(children(tr, 'trPr')[0])}}{${propertySignature(children(tr, 'tblPrEx')[0])}}`
          + children(tr, 'tc').map((tc) =>
            `${propertySignature(children(tc, 'tcPr')[0])}=${children(tc, 'p').map(paragraphText).join('/')}`).join('|'),
        ).join(' ; ');
      }
      return block.localName;
    });
}

type Projection = 'accept' | 'reject';

/** What every header/footer part shows after a projection by docx-compare's applier or docx-core's. */
async function projectedStories(
  buffer: Buffer,
  projection: Projection | 'none',
  applier: 'ast' | 'core',
): Promise<Record<string, string[]>> {
  let archive = await DocxArchive.load(buffer);
  if (applier === 'core' && projection !== 'none') {
    const document = await DocxDocument.load(buffer);
    if (projection === 'accept') await document.acceptChanges();
    else await document.rejectChanges();
    archive = await DocxArchive.load((await document.toBuffer()).buffer);
  }
  const project = projection === 'none' || applier === 'core'
    ? (xml: string) => xml
    : projection === 'accept' ? acceptAllChanges : rejectAllChanges;
  const stories: Record<string, string[]> = {};
  for (const slot of SLOTS) stories[partPath(slot)] = storyView(project((await archive.getFile(partPath(slot)))!));
  return stories;
}

const bodyText = async (buffer: Buffer, project: (xml: string) => string = (xml) => xml): Promise<string> =>
  extractRoundTripComparisonText(project(await (await DocxArchive.load(buffer)).getDocumentXml()));

/**
 * The gate validates `word/document.xml`; each header/footer part's blocks
 * (CT_HdrFtr holds the same block-level content as a body) are validated as a
 * document body of their own.
 */
async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1393-'));
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

/** Whole-row revision markers (`w:trPr/w:ins`, `w:trPr/w:del`) in each header/footer part. */
async function rowMarkers(buffer: Buffer): Promise<Record<string, { inserted: number; deleted: number }>> {
  const archive = await DocxArchive.load(buffer);
  const counts: Record<string, { inserted: number; deleted: number }> = {};
  for (const slot of SLOTS) {
    const document = parseXml((await archive.getFile(partPath(slot)))!);
    const markers = Array.from(document.getElementsByTagNameNS(W_NS, 'trPr'))
      .flatMap((trPr) => Array.from(trPr.childNodes).filter((child): child is Element => child.nodeType === 1));
    counts[partPath(slot)] = {
      inserted: markers.filter((marker) => isW(marker, 'ins')).length,
      deleted: markers.filter((marker) => isW(marker, 'del')).length,
    };
  }
  return counts;
}

async function expectTrackedRows(
  { then }: Pick<AllureBddContext, 'then'>,
  original: Buffer,
  revised: Buffer,
  result: TaggedCompareResult,
  expectedMarkers: { inserted: number; deleted: number },
): Promise<void> {
  await then('nothing is left unrepresented', () => {
    expect(result.unrepresentedChanges).toBeUndefined();
  });
  await then('every header and footer carries the whole-row revision markers', async () => {
    for (const [path, counts] of Object.entries(await rowMarkers(result.document))) {
      expect(counts, path).toEqual(expectedMarkers);
    }
  });
  await then('every header and footer shows the revised tables after Accept All and the original after Reject All, with both appliers', async () => {
    const expectedAccepted = await projectedStories(revised, 'none', 'ast');
    const expectedRejected = await projectedStories(original, 'none', 'ast');
    expect(expectedAccepted).not.toEqual(expectedRejected);
    for (const applier of ['ast', 'core'] as const) {
      expect(await projectedStories(result.document, 'accept', applier), applier).toEqual(expectedAccepted);
      expect(await projectedStories(result.document, 'reject', applier), applier).toEqual(expectedRejected);
    }
  });
  await then('the formatting-fidelity check scores every header and footer 1 in both projections', async () => {
    const archives = await Promise.all(
      [original, revised, result.document].map((buffer) => DocxArchive.load(buffer)),
    );
    for (const slot of SLOTS) {
      const [originalXml, revisedXml, comparedXml] = await Promise.all(
        archives.map(async (archive) => (await archive.getFile(partPath(slot)))!),
      );
      const fidelity = compareSourceProjectedFormattingFidelity(originalXml!, revisedXml!, comparedXml!);
      expect(fidelity.accept.divergences, partPath(slot)).toEqual([]);
      expect(fidelity.reject.divergences, partPath(slot)).toEqual([]);
      expect(fidelity.score, partPath(slot)).toBe(1);
    }
  });
  await then('body text round-trips', async () => {
    expect(await bodyText(result.document, acceptAllChanges)).toBe(await bodyText(revised));
    expect(await bodyText(result.document, rejectAllChanges)).toBe(await bodyText(original));
  });
  await then('the compared package passes the emitted-document schema gate', () => assertSchema(result.document));
}

/**
 * A story's field structure: its text, field characters and field
 * instructions in document order, so a duplicated, dropped or reordered field
 * character, or an instruction left behind, reads differently. A simple field
 * reads as the equivalent complex field (begin, instruction, separate, result,
 * end), the form the comparison gives a simple field it inserts or deletes; a
 * deleted instruction (`w:delInstrText`) reads as an instruction, since a
 * projection must not leave one.
 */
function fieldStructure(xml: string): string[] {
  const tokens: string[] = [];
  const visit = (element: Element): void => {
    if (element.namespaceURI === W_NS) {
      if (element.localName === 't' || element.localName === 'delText') tokens.push(`"${element.textContent ?? ''}"`);
      else if (element.localName === 'fldChar') tokens.push(`{${element.getAttributeNS(W_NS, 'fldCharType')}}`);
      else if (element.localName === 'instrText' || element.localName === 'delInstrText') {
        tokens.push(`instr(${(element.textContent ?? '').trim()})`);
      } else if (element.localName === 'fldSimple') {
        tokens.push('{begin}', `instr(${(element.getAttributeNS(W_NS, 'instr') ?? '').trim()})`, '{separate}');
        Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1).forEach(visit);
        tokens.push('{end}');
        return;
      }
    }
    Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1).forEach(visit);
  };
  visit(parseXml(xml).documentElement);
  return tokens;
}

/**
 * Every header and footer keeps its fields whole after Accept All and Reject
 * All, with both appliers: the field structure equals the revised (accept) or
 * original (reject) story's, and the strict field-structure check finds nothing.
 */
async function expectFieldStructure(
  { then }: Pick<AllureBddContext, 'then'>,
  original: Buffer,
  revised: Buffer,
  result: TaggedCompareResult,
): Promise<void> {
  await then('every header and footer keeps its field structure in both projections, with both appliers', async () => {
    const originalArchive = await DocxArchive.load(original);
    const revisedArchive = await DocxArchive.load(revised);
    const comparedArchive = await DocxArchive.load(result.document);
    const projectedArchives: Record<string, DocxArchive> = {};
    for (const projection of ['accept', 'reject'] as const) {
      const document = await DocxDocument.load(result.document);
      if (projection === 'accept') await document.acceptChanges();
      else await document.rejectChanges();
      projectedArchives[projection] = await DocxArchive.load((await document.toBuffer()).buffer);
    }
    for (const slot of SLOTS) {
      const path = partPath(slot);
      const comparedXml = (await comparedArchive.getFile(path))!;
      for (const [projection, expectedXml, astXml] of [
        ['accept', (await revisedArchive.getFile(path))!, acceptAllChanges(comparedXml)],
        ['reject', (await originalArchive.getFile(path))!, rejectAllChanges(comparedXml)],
      ] as const) {
        const coreXml = (await projectedArchives[projection]!.getFile(path))!;
        for (const [applier, xml] of [['ast', astXml], ['core', coreXml]] as const) {
          expect(fieldStructure(xml), `${path} ${projection} ${applier}`).toEqual(fieldStructure(expectedXml));
          // CT_HdrFtr holds the block-level content a body holds.
          const asDocument = xml
            .replace(/<w:(hdr|ftr)(\s[^>]*)?>/u, (_match, _root, attributes = '') => `<w:document${attributes}><w:body>`)
            .replace(/<\/w:(hdr|ftr)>\s*$/u, '</w:body></w:document>');
          expect(collectStrictFieldStructureIssues(asDocument), `${path} ${projection} ${applier}`).toEqual([]);
        }
      }
    }
  });
}

interface RowCase {
  readonly name: string;
  readonly original: readonly string[];
  readonly revised: readonly string[];
  readonly markers: { inserted: number; deleted: number };
}

const ROW_CASES: readonly RowCase[] = [
  { name: 'a row inserted at the start', original: [COMPANY, ADDRESS], revised: [PHONE, COMPANY, ADDRESS], markers: { inserted: 1, deleted: 0 } },
  { name: 'a row inserted in the middle', original: [COMPANY, ADDRESS], revised: [COMPANY, PHONE, ADDRESS], markers: { inserted: 1, deleted: 0 } },
  { name: 'a row inserted at the end', original: [COMPANY, ADDRESS], revised: [COMPANY, ADDRESS, PHONE], markers: { inserted: 1, deleted: 0 } },
  { name: 'a row deleted at the start', original: [COMPANY, ADDRESS, PHONE], revised: [ADDRESS, PHONE], markers: { inserted: 0, deleted: 1 } },
  { name: 'a row deleted in the middle', original: [COMPANY, ADDRESS, PHONE], revised: [COMPANY, PHONE], markers: { inserted: 0, deleted: 1 } },
  { name: 'a row deleted at the end', original: [COMPANY, ADDRESS, PHONE], revised: [COMPANY, ADDRESS], markers: { inserted: 0, deleted: 1 } },
  {
    name: 'a row inserted beside an edit to another row',
    original: [COMPANY, ADDRESS],
    revised: [row('Company', 'Acme Holdings'), ADDRESS, PHONE],
    markers: { inserted: 1, deleted: 0 },
  },
  {
    // A matched row whose cell count changes is replaced, as in the body (#1396).
    name: 'a row whose two cells merge into one',
    original: [COMPANY, ADDRESS],
    revised: [COMPANY, MERGED_ADDRESS],
    markers: { inserted: 1, deleted: 1 },
  },
  {
    // The vertical-merge band is replaced, as in the body (#1397).
    name: 'a label cell merged down over the row below',
    original: [COMPANY, ADDRESS],
    revised: [row('Company', 'Acme Corp', '', '<w:vMerge w:val="restart"/>'), row('', '1 Main Street', '', '<w:vMerge/>')],
    markers: { inserted: 2, deleted: 2 },
  },
  {
    // Row and cell properties of a kept row are tracked as in the body.
    name: 'a row inserted beside a shading and row-height change to another row',
    original: [COMPANY, ADDRESS],
    revised: [
      COMPANY,
      `<w:tr><w:trPr><w:trHeight w:val="500"/></w:trPr>${cell(text('Address'), '<w:tcPr><w:tcW w:w="4500" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/></w:tcPr>')}${cell(text('1 Main Street'))}</w:tr>`,
      PHONE,
    ],
    markers: { inserted: 1, deleted: 0 },
  },
  {
    name: 'a row deleted and another inserted',
    original: [COMPANY, ADDRESS, PHONE],
    revised: [COMPANY, PHONE, EMAIL],
    markers: { inserted: 1, deleted: 1 },
  },
];

describe('a header or footer table that gains or loses a row (#1393)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  // One test per case, so each comparison has its own time budget.
  for (const rowCase of ROW_CASES) {
    test.openspec('[SDX-CMP-STORY-07] Header and footer table rows are tracked as whole-row revisions')(
    `tracks ${rowCase.name} in every header and footer`,
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given(`six stories each holding a table; the revision has ${rowCase.name} and edits the body`, () =>
        Promise.all([
          storyPackage('Body draft', () => story(...rowCase.original)),
          storyPackage('Body final', () => story(...rowCase.revised)),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectTrackedRows({ then }, original, revised, result, rowCase.markers);
    },
  );
  }

  const pageRow = row('Page', text('Page ') + pageField());
  const FIELD_CASES: readonly RowCase[] = [
    { name: 'a row inserted above a PAGE-field row', original: [COMPANY, pageRow], revised: [COMPANY, PHONE, pageRow], markers: { inserted: 1, deleted: 0 } },
    { name: 'a row deleted above a PAGE-field row', original: [COMPANY, ADDRESS, pageRow], revised: [COMPANY, pageRow], markers: { inserted: 0, deleted: 1 } },
  ];
  for (const rowCase of FIELD_CASES) {
    test.openspec('[SDX-CMP-STORY-07] Header and footer table rows are tracked as whole-row revisions')(
    `tracks ${rowCase.name} and keeps the field whole`,
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given(`six page-number tables; the revision has ${rowCase.name}`, () =>
        Promise.all([
          storyPackage('Body', () => story(...rowCase.original)),
          storyPackage('Body', () => story(...rowCase.revised)),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectTrackedRows({ then }, original, revised, result, rowCase.markers);
      await then('the PAGE field keeps its structure and gains no revision', async () => {
        const archive = await DocxArchive.load(result.document);
        for (const slot of SLOTS) {
          const document = parseXml((await archive.getFile(partPath(slot)))!);
          const fieldParagraph = Array.from(document.getElementsByTagNameNS(W_NS, 'instrText'))
            .map((instruction) => instruction.parentNode!.parentNode as Element)[0]!;
          expect(fieldParagraph.getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(0);
          expect(fieldParagraph.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(0);
          expect(Array.from(document.getElementsByTagNameNS(W_NS, 'fldChar'))
            .map((element) => element.getAttributeNS(W_NS, 'fldCharType'))).toEqual(['begin', 'separate', 'end']);
        }
      });
    },
  );
  }
});

/**
 * A table inside a header text box is compared as the text box's own story,
 * under the same table-topology guard: a merged row is replaced rather than
 * emitted as `w:del`/`w:ins` wrapped around `w:tc`, which the schema forbids.
 */
describe('a table inside a header text box (#1393)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  const O_NS = 'urn:schemas-microsoft-com:office:office';
  const textBox = (...rows: string[]): string =>
    '<w:p><w:r><w:pict><v:shape id="shape1" o:spid="_x0000_s1026"><v:textbox><w:txbxContent>'
    + table(...rows) + paragraph(text('Box'))
    + '</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>';
  const boxStory = (...rows: string[]): string => textBox(...rows).replace('<w:p>', `<w:p xmlns:o="${O_NS}">`);
  /** The text of every table row in the default header's text box, after a projection by each applier. */
  const boxRows = async (buffer: Buffer, projection: Projection | 'none', applier: 'ast' | 'core'): Promise<string[]> => {
    let archive = await DocxArchive.load(buffer);
    if (applier === 'core' && projection !== 'none') {
      const document = await DocxDocument.load(buffer);
      if (projection === 'accept') await document.acceptChanges();
      else await document.rejectChanges();
      archive = await DocxArchive.load((await document.toBuffer()).buffer);
    }
    const xml = (await archive.getFile(partPath({ kind: 'header', role: 'default' })))!;
    const projected = projection === 'none' || applier === 'core'
      ? xml
      : (projection === 'accept' ? acceptAllChanges : rejectAllChanges)(xml);
    return Array.from(parseXml(projected).getElementsByTagNameNS(W_NS, 'tr'))
      .map((tr) => children(tr, 'tc').map((tc) => children(tc, 'p').map(paragraphText).join('/')).join('|'));
  };
  const BOX_CASES: readonly RowCase[] = [
    { name: 'a row inserted', original: [COMPANY], revised: [COMPANY, ADDRESS], markers: { inserted: 1, deleted: 0 } },
    { name: 'a row whose two cells merge into one', original: [COMPANY, ADDRESS], revised: [COMPANY, MERGED_ADDRESS], markers: { inserted: 1, deleted: 1 } },
  ];
  for (const boxCase of BOX_CASES) {
    test.openspec('[SDX-CMP-STORY-07] Header and footer table rows are tracked as whole-row revisions')(
      `tracks ${boxCase.name} in a table inside a header text box`,
      async ({ given, when, then }: AllureBddContext) => {
        const [original, revised] = await given(`a default header text box holding a table; the revision has ${boxCase.name}`, () =>
          Promise.all([
            storyPackage('Body draft', ({ kind, role }) =>
              (kind === 'header' && role === 'default' ? boxStory(...boxCase.original) : paragraph(text('Plain')))),
            storyPackage('Body final', ({ kind, role }) =>
              (kind === 'header' && role === 'default' ? boxStory(...boxCase.revised) : paragraph(text('Plain')))),
          ]));
        const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
        await then('nothing is left unrepresented and the header carries the whole-row markers', async () => {
          expect(result.unrepresentedChanges).toBeUndefined();
          expect((await rowMarkers(result.document))[partPath({ kind: 'header', role: 'default' })]).toEqual(boxCase.markers);
        });
        await then('the text box shows the revised rows after Accept All and the original after Reject All, with both appliers', async () => {
          for (const applier of ['ast', 'core'] as const) {
            expect(await boxRows(result.document, 'accept', applier), applier).toEqual(await boxRows(revised, 'none', 'ast'));
            expect(await boxRows(result.document, 'reject', applier), applier).toEqual(await boxRows(original, 'none', 'ast'));
          }
        });
        await then('the compared package passes the emitted-document schema gate', () => assertSchema(result.document));
      },
    );
  }

  test.openspec('[SDX-CMP-STORY-05] Unsupported topology remains unrepresented')(
    'keeps a grid-width change inside a header text box listed instead of aborting',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('a default header text box table whose first grid column widens, beside a body edit', () =>
        Promise.all([
          storyPackage('Body draft', ({ kind, role }) =>
            (kind === 'header' && role === 'default' ? boxStory(COMPANY) : paragraph(text('Plain')))),
          storyPackage('Body final', ({ kind, role }) =>
            (kind === 'header' && role === 'default'
              ? boxStory(COMPANY).replace('<w:gridCol w:w="4500"/>', '<w:gridCol w:w="5000"/>')
              : paragraph(text('Plain')))),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await then('the default header is listed, the body edit is tracked and the package is schema-valid', async () => {
        expect(result.unrepresentedChanges).toEqual([
          expect.objectContaining({ scope: 'header', kind: 'changed', role: 'default' }),
        ]);
        expect(await bodyText(result.document, acceptAllChanges)).toBe(await bodyText(revised));
        expect(await bodyText(result.document, rejectAllChanges)).toBe(await bodyText(original));
        await assertSchema(result.document);
      });
    },
  );
});

const numPagesField = (): string =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>3</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const PAGE_ROW = row('Page', text('Page ') + pageField());
/** A "Page X of Y" row: PAGE and NUMPAGES fields in one cell. */
const PAGE_OF_ROW = row('Page', text('Page ') + pageField() + text(' of ') + numPagesField());

/**
 * A header or footer table row that holds a field, a content control, range
 * markup or a nested table is tracked as a whole-row revision when it is
 * inserted or deleted, as in the main body: "Page X of Y" cells are common in
 * agreements. The field keeps its structure in each projection: its text,
 * field characters and instruction, in document order, equal the source's.
 */
describe('a header or footer table row holding a field, content control or range markup (#1467)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  const SIMPLE_FIELD_ROW = row('Pages', '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>3</w:t></w:r></w:fldSimple>');
  const CONTROL_ROW = `<w:tr>${cell(text('Client'))}<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>`
    + `<w:sdt><w:sdtPr><w:alias w:val="Client"/><w:tag w:val="client"/></w:sdtPr><w:sdtContent>${paragraph(text('Acme Corp'))}</w:sdtContent></w:sdt></w:tc></w:tr>`;
  const CELL_CONTROL_ROW = `<w:tr><w:sdt><w:sdtPr><w:alias w:val="Client"/></w:sdtPr><w:sdtContent>${cell(text('Client'))}</w:sdtContent></w:sdt>${cell(text('Acme'))}</w:tr>`;
  // A bookmark inside the paragraph, and one around the cell's paragraphs.
  const BOOKMARK_ROW = row('Matter', '<w:bookmarkStart w:id="7" w:name="MatterNumber"/>' + text('2026-001') + '<w:bookmarkEnd w:id="7"/>');
  const CELL_BOOKMARK_ROW = `<w:tr>${cell(text('Office'))}<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>`
    + `<w:bookmarkStart w:id="8" w:name="OfficeAddress"/>${paragraph(text('1 Main Street'))}${paragraph(text('Springfield'))}`
    + '<w:bookmarkEnd w:id="8"/></w:tc></w:tr>';
  const NESTED_TABLE_ROW = `<w:tr>${cell(text('Signatory'))}<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>`
    + '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>'
    + `<w:tr>${cell(text('Jane Doe'), '<w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>')}</w:tr></w:tbl>${paragraph('')}</w:tc></w:tr>`;
  const RICH_CASES: readonly RowCase[] = [
    { name: 'an inserted row holding a PAGE field', original: [COMPANY], revised: [COMPANY, PAGE_ROW], markers: { inserted: 1, deleted: 0 } },
    { name: 'a deleted row holding a PAGE field', original: [COMPANY, PAGE_ROW], revised: [COMPANY], markers: { inserted: 0, deleted: 1 } },
    { name: 'an inserted "Page X of Y" row', original: [COMPANY, ADDRESS], revised: [COMPANY, PAGE_OF_ROW, ADDRESS], markers: { inserted: 1, deleted: 0 } },
    { name: 'a deleted "Page X of Y" row', original: [PAGE_OF_ROW, COMPANY, ADDRESS], revised: [COMPANY, ADDRESS], markers: { inserted: 0, deleted: 1 } },
    { name: 'an inserted row holding a simple NUMPAGES field', original: [COMPANY], revised: [SIMPLE_FIELD_ROW, COMPANY], markers: { inserted: 1, deleted: 0 } },
    { name: 'an inserted row beside a kept PAGE-field row', original: [COMPANY, PAGE_ROW], revised: [COMPANY, PAGE_OF_ROW, PAGE_ROW], markers: { inserted: 1, deleted: 0 } },
    { name: 'a PAGE-field row replacing a plain row', original: [COMPANY, ADDRESS], revised: [COMPANY, PAGE_ROW], markers: { inserted: 1, deleted: 1 } },
    { name: 'an inserted row holding a content control', original: [COMPANY], revised: [COMPANY, CONTROL_ROW], markers: { inserted: 1, deleted: 0 } },
    { name: 'a deleted row holding a content control', original: [CONTROL_ROW, COMPANY], revised: [COMPANY], markers: { inserted: 0, deleted: 1 } },
    { name: 'an inserted row whose cell sits in a cell-level content control', original: [COMPANY], revised: [COMPANY, CELL_CONTROL_ROW], markers: { inserted: 1, deleted: 0 } },
    { name: 'a deleted row whose cell sits in a cell-level content control', original: [CELL_CONTROL_ROW, COMPANY], revised: [COMPANY], markers: { inserted: 0, deleted: 1 } },
    { name: 'an inserted row holding a bookmark', original: [COMPANY], revised: [COMPANY, BOOKMARK_ROW], markers: { inserted: 1, deleted: 0 } },
    { name: 'a deleted row holding a bookmark', original: [COMPANY, BOOKMARK_ROW, ADDRESS], revised: [COMPANY, ADDRESS], markers: { inserted: 0, deleted: 1 } },
    { name: 'an inserted row holding a bookmark around its cell paragraphs', original: [COMPANY], revised: [CELL_BOOKMARK_ROW, COMPANY], markers: { inserted: 1, deleted: 0 } },
    { name: 'a deleted row holding a bookmark around its cell paragraphs', original: [COMPANY, CELL_BOOKMARK_ROW], revised: [COMPANY], markers: { inserted: 0, deleted: 1 } },
    { name: 'an inserted row holding a nested table', original: [COMPANY], revised: [COMPANY, NESTED_TABLE_ROW], markers: { inserted: 1, deleted: 0 } },
    { name: 'a deleted row holding a nested table', original: [COMPANY, NESTED_TABLE_ROW], revised: [COMPANY], markers: { inserted: 0, deleted: 1 } },
  ];
  for (const richCase of RICH_CASES) {
    test.openspec('[SDX-CMP-STORY-07] Header and footer table rows are tracked as whole-row revisions')(
      `tracks ${richCase.name} in every header and footer`,
      async ({ given, when, then }: AllureBddContext) => {
        const [original, revised] = await given(`six stories each holding a table; the revision has ${richCase.name} and edits the body`, () =>
          Promise.all([
            storyPackage('Body draft', () => story(...richCase.original)),
            storyPackage('Body final', () => story(...richCase.revised)),
          ]));
        const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
        await expectTrackedRows({ then }, original, revised, result, richCase.markers);
        await expectFieldStructure({ then }, original, revised, result);
      },
    );
  }
});

/**
 * Changes the whole-row revisions cannot carry, or that the comparison could
 * pair into a kept row's change that is itself listed, keep the story listed.
 */
describe('header and footer table changes the row revisions cannot carry stay listed (#1393, #1467)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  const controlRow = (alias: string, value: string): string =>
    `<w:tr>${cell(text('Client'))}<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr><w:sdt><w:sdtPr><w:alias w:val="${alias}"/></w:sdtPr><w:sdtContent>${paragraph(text(value))}</w:sdtContent></w:sdt></w:tc></w:tr>`;
  const LISTED_CASES: ReadonlyArray<{ name: string; original: string; revised: string }> = [
    {
      // docx-core's Reject All does not restore a w:tblPrExChange.
      name: 'table-property exceptions added to a row',
      original: story(COMPANY, ADDRESS),
      revised: story(COMPANY, ADDRESS.replace('<w:tr>', '<w:tr><w:tblPrEx><w:tblW w:w="7000" w:type="dxa"/></w:tblPrEx>')),
    },
    {
      // A cell-level content control keeps its row in the scaffold.
      name: 'a cell added beside a cell-level content control',
      original: story(`<w:tr><w:trPr><w:gridAfter w:val="1"/></w:trPr><w:sdt><w:sdtPr><w:alias w:val="Company"/></w:sdtPr><w:sdtContent>${cell(text('Acme'))}</w:sdtContent></w:sdt></w:tr>`),
      revised: story(`<w:tr><w:sdt><w:sdtPr><w:alias w:val="Company"/></w:sdtPr><w:sdtContent>${cell(text('Acme'))}</w:sdtContent></w:sdt>${cell(text('Corp'))}</w:tr>`),
    },
    {
      name: 'a renamed content control in a kept row',
      original: story(COMPANY, `<w:tr>${cell(text('Client'))}<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr><w:sdt><w:sdtPr><w:alias w:val="Client"/></w:sdtPr><w:sdtContent>${paragraph(text('Acme'))}</w:sdtContent></w:sdt></w:tc></w:tr>`),
      revised: story(COMPANY, `<w:tr>${cell(text('Client'))}<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr><w:sdt><w:sdtPr><w:alias w:val="Customer"/></w:sdtPr><w:sdtContent>${paragraph(text('Acme'))}</w:sdtContent></w:sdt></w:tc></w:tr>`),
    },
    {
      // A field instruction change in a paired row is listed, as in a paragraph (SDX-CMP-STORY-06).
      name: 'a kept row whose PAGE field becomes a NUMPAGES field',
      original: story(COMPANY, PAGE_ROW),
      revised: story(COMPANY, row('Page', text('Page ') + numPagesField())),
    },
    {
      name: 'a PAGE-field row that gains a NUMPAGES field',
      original: story(COMPANY, PAGE_ROW),
      revised: story(COMPANY, PAGE_OF_ROW),
    },
    {
      // A content control must not land in a paired row's kept cell.
      name: 'a content-control row replacing a plain row',
      original: story(COMPANY, ADDRESS),
      revised: story(COMPANY, `<w:tr>${cell(text('Client'))}<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr><w:sdt><w:sdtPr><w:alias w:val="Client"/></w:sdtPr><w:sdtContent>${paragraph(text('Acme'))}</w:sdtContent></w:sdt></w:tc></w:tr>`),
    },
    {
      // The scaffold pairs the alias-A rows; the story comparison pairs the
      // rows by text, so the kept row would carry an untracked rename.
      name: 'a content-control row inserted above a kept row whose control is renamed',
      original: story(controlRow('A', 'Alpha')),
      revised: story(controlRow('B', 'Alpha'), controlRow('A', 'Beta')),
    },
    {
      name: 'a renamed cell-level content control',
      original: story(`<w:tr><w:sdt><w:sdtPr><w:alias w:val="Company"/></w:sdtPr><w:sdtContent>${cell(text('Acme'))}</w:sdtContent></w:sdt>${cell(text('Corp'))}</w:tr>`),
      revised: story(`<w:tr><w:sdt><w:sdtPr><w:alias w:val="Client"/></w:sdtPr><w:sdtContent>${cell(text('Acme'))}</w:sdtContent></w:sdt>${cell(text('Corp'))}</w:tr>`),
    },
  ];
  for (const listedCase of LISTED_CASES) {
    test.openspec('[SDX-CMP-STORY-05] Unsupported topology remains unrepresented')(
      `lists ${listedCase.name} instead of aborting or claiming it`,
      async ({ given, when, then }: AllureBddContext) => {
        const [original, revised] = await given(`a default footer table with ${listedCase.name} beside a body edit`, () =>
          Promise.all([
            storyPackage('Body draft', () => listedCase.original),
            storyPackage('Body final', ({ kind, role }) =>
              (kind === 'footer' && role === 'default' ? listedCase.revised : listedCase.original)),
          ]));
        const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
        await then('the default footer is listed and carries no row revision', async () => {
          expect(result.unrepresentedChanges).toEqual([
            expect.objectContaining({ scope: 'footer', kind: 'changed', role: 'default' }),
          ]);
          const footer = partPath({ kind: 'footer', role: 'default' });
          expect((await rowMarkers(result.document))[footer]).toEqual({ inserted: 0, deleted: 0 });
          expect(await bodyText(result.document, acceptAllChanges)).toBe(await bodyText(revised));
          expect(await bodyText(result.document, rejectAllChanges)).toBe(await bodyText(original));
        });
        await then('the compared package passes the emitted-document schema gate', () => assertSchema(result.document));
      },
    );
  }
});

/**
 * Each header and footer of an ODT export (LibreOffice keeps them in
 * `styles.xml` master pages, one element per page kind) as its table rows'
 * text, in document order.
 */
async function odtStoryRows(odt: Buffer): Promise<Record<string, string[]>> {
  const zip = await JSZip.loadAsync(odt);
  const styles = parseXml(await zip.file('styles.xml')!.async('string'));
  const STYLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
  const TABLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const stories: Record<string, string[]> = {};
  for (const localName of ['header', 'header-left', 'header-first', 'footer', 'footer-left', 'footer-first']) {
    const story = styles.getElementsByTagNameNS(STYLE_NS, localName)[0];
    stories[localName] = story
      ? Array.from(story.getElementsByTagNameNS(TABLE_NS, 'table-row')).map((tableRow) => tableRow.textContent ?? '')
      : [];
  }
  return stories;
}

// Explicit opt-in: a requested reader run must fail, never silently skip an
// unusable LibreOffice.
const reader = process.env.SAFE_DOCX_HEADER_FOOTER_TABLE_ROWS_READER_REQUIRED === '1' ? describe : describe.skip;
reader('LibreOffice accepts and rejects header and footer table rows as compared (#1393)', () => {
  const READER_CASES: readonly RowCase[] = [ROW_CASES[2]!, ROW_CASES[4]!];
  for (const readerCase of READER_CASES) {
    test(`shows the revised rows after Accept All and the original rows after Reject All for ${readerCase.name}`, async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const original = await storyPackage('Body draft', () => story(...readerCase.original));
      const revised = await storyPackage('Body final', () => story(...readerCase.revised));
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
      const [originalView, revisedView, accepted, rejected] = await Promise.all(packages.map(odtStoryRows));
      expect(originalView!.footer).toHaveLength(readerCase.original.length);
      expect(revisedView!.footer).toHaveLength(readerCase.revised.length);
      expect(accepted).toEqual(revisedView);
      expect(rejected).toEqual(originalView);
    }, 600_000);
  }
});

/**
 * Each header and footer of an ODT export as the number of page-number and
 * page-count fields LibreOffice read from it.
 */
async function odtStoryFields(odt: Buffer): Promise<Record<string, number>> {
  const zip = await JSZip.loadAsync(odt);
  const styles = parseXml(await zip.file('styles.xml')!.async('string'));
  const STYLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
  const TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const fields: Record<string, number> = {};
  for (const localName of ['header', 'header-left', 'header-first', 'footer', 'footer-left', 'footer-first']) {
    const story = styles.getElementsByTagNameNS(STYLE_NS, localName)[0];
    fields[localName] = story
      ? story.getElementsByTagNameNS(TEXT_NS, 'page-number').length + story.getElementsByTagNameNS(TEXT_NS, 'page-count').length
      : 0;
  }
  return fields;
}

reader('LibreOffice accepts and rejects header and footer table rows holding fields as compared (#1467)', () => {
  const READER_CASES: readonly RowCase[] = [
    { name: 'an inserted "Page X of Y" row', original: [COMPANY, ADDRESS], revised: [COMPANY, PAGE_OF_ROW, ADDRESS], markers: { inserted: 1, deleted: 0 } },
    { name: 'a deleted row holding a PAGE field', original: [COMPANY, PAGE_ROW], revised: [COMPANY], markers: { inserted: 0, deleted: 1 } },
  ];
  for (const readerCase of READER_CASES) {
    test(`shows the revised rows and fields after Accept All and the original after Reject All for ${readerCase.name}`, async () => {
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const original = await storyPackage('Body draft', () => story(...readerCase.original));
      const revised = await storyPackage('Body final', () => story(...readerCase.revised));
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
      const [originalView, revisedView, accepted, rejected] = await Promise.all(packages.map(odtStoryRows));
      const [originalFields, revisedFields, acceptedFields, rejectedFields] = await Promise.all(packages.map(odtStoryFields));
      expect(originalView!.footer).toHaveLength(readerCase.original.length);
      expect(revisedView!.footer).toHaveLength(readerCase.revised.length);
      expect(originalFields).not.toEqual(revisedFields);
      expect(accepted).toEqual(revisedView);
      expect(rejected).toEqual(originalView);
      expect(acceptedFields).toEqual(revisedFields);
      expect(rejectedFields).toEqual(originalFields);
    }, 600_000);
  }
});
