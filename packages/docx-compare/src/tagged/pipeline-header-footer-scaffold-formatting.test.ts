/**
 * A formatting-only change in a header or footer paragraph that also holds a
 * field, a content control or a drawing is tracked with `w:rPrChange` /
 * `w:pPrChange`, as in body text, instead of being left in
 * `unrepresentedChanges`. A change to the field, content control or drawing
 * itself stays listed.
 *
 * Each case checks, for every default, first and even header and footer, the
 * run and paragraph formatting of every paragraph after Accept All and Reject
 * All, with docx-compare's appliers and with docx-core's
 * `acceptChanges`/`rejectChanges`, against the revised and the original
 * document, plus body text and the emitted-document schema gate.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.31
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.29
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @see https://github.com/UseJunior/safe-docx/issues/1392
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
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { compareDocumentsAtomizer, type TaggedCompareResult } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { compareSourceProjectedFormattingFidelity } from './formattingFidelity.js';

const TEST_FEATURE = 'add-markdoc-header-footer-authoring';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.31' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.29' },
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

const BOLD = '<w:rPr><w:b/></w:rPr>';
const text = (value: string, rPr = ''): string =>
  `<w:r>${rPr}<w:t xml:space="preserve">${value}</w:t></w:r>`;
const pageField = (rPr = '', instruction = ' PAGE '): string =>
  `<w:r>${rPr}<w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r>${rPr}<w:instrText xml:space="preserve">${instruction}</w:instrText></w:r>` +
  `<w:r>${rPr}<w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r>${rPr}<w:t>1</w:t></w:r>` +
  `<w:r>${rPr}<w:fldChar w:fldCharType="end"/></w:r>`;
const contentControl = (value: string, rPr = '', sdtRPr = ''): string =>
  `<w:sdt><w:sdtPr>${sdtRPr}<w:alias w:val="Company"/><w:id w:val="7"/></w:sdtPr>` +
  `<w:sdtContent>${text(value, rPr)}</w:sdtContent></w:sdt>`;
const vmlShape = '<w:r><w:pict><v:rect id="mark1" style="width:12pt;height:12pt"/></w:pict></w:r>';
const paragraph = (content: string, pPr = ''): string => `<w:p>${pPr}${content}</w:p>`;
const PRIOR_RUN_REVISION =
  '<w:rPrChange w:id="71" w:author="Prior" w:date="2026-11-01T00:00:00Z"><w:rPr><w:i/></w:rPr></w:rPrChange>';
const PRIOR_PARAGRAPH_REVISION =
  '<w:pPrChange w:id="72" w:author="Prior" w:date="2026-11-01T00:00:00Z"><w:pPr/></w:pPrChange>';

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

function hasAncestor(element: Element, name: string): boolean {
  for (let node = element.parentNode; node; node = node.parentNode) if (isW(node, name)) return true;
  return false;
}

/** A property element's formatting, without revision records and with child order kept. */
function propertySignature(properties: Element | undefined, skip: readonly string[]): string {
  if (!properties) return '';
  const describe = (element: Element): string => {
    const attributes = Array.from(element.attributes)
      .map((attribute) => `${attribute.localName}=${attribute.value}`).sort().join(',');
    const children = Array.from(element.childNodes)
      .filter((child): child is Element => child.nodeType === 1)
      .map(describe).join('');
    return `${element.localName}[${attributes}](${children})`;
  };
  return Array.from(properties.childNodes)
    .filter((child): child is Element => child.nodeType === 1 && !skip.includes((child as Element).localName))
    .map(describe).join('');
}

const firstChild = (element: Element, name: string): Element | undefined =>
  Array.from(element.childNodes).find((child): child is Element => isW(child, name));

/**
 * Every paragraph of a story part, as its paragraph properties, its paragraph
 * mark's run properties and its content split into segments of equal run
 * properties (so a different run split reads the same): text, field
 * instructions, field characters and pictures each stand for themselves.
 */
function formattingView(xml: string): string[] {
  const view: string[] = [];
  for (const p of Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'p'))) {
    if (hasAncestor(p, 'txbxContent')) continue;
    const pPr = firstChild(p, 'pPr');
    const segments: Array<[string, string]> = [];
    for (const run of Array.from(p.getElementsByTagNameNS(W_NS, 'r'))) {
      const rPr = propertySignature(firstChild(run, 'rPr'), ['rPrChange']);
      let content = '';
      for (const child of Array.from(run.childNodes)) {
        if (isW(child, 't') || isW(child, 'instrText')) content += child.textContent ?? '';
        else if (isW(child, 'fldChar')) content += `{${(child as Element).getAttributeNS(W_NS, 'fldCharType')}}`;
        else if (isW(child, 'pict') || isW(child, 'drawing')) content += '{picture}';
      }
      if (!content) continue;
      const last = segments[segments.length - 1];
      if (last && last[0] === rPr) last[1] += content;
      else segments.push([rPr, content]);
    }
    view.push([
      propertySignature(pPr, ['rPr', 'pPrChange']),
      propertySignature(pPr ? firstChild(pPr, 'rPr') : undefined, ['rPrChange', 'ins', 'del']),
      ...segments.map(([rPr, content]) => `<${rPr}>${content}`),
    ].join('|'));
  }
  return view;
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
  for (const slot of SLOTS) stories[partPath(slot)] = formattingView(project((await archive.getFile(partPath(slot)))!));
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
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1392-'));
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

/** Formatting revision records in each header/footer part. */
async function formattingRevisions(buffer: Buffer): Promise<Record<string, { rPrChange: number; pPrChange: number }>> {
  const archive = await DocxArchive.load(buffer);
  const counts: Record<string, { rPrChange: number; pPrChange: number }> = {};
  for (const slot of SLOTS) {
    const document = parseXml((await archive.getFile(partPath(slot)))!);
    counts[partPath(slot)] = {
      rPrChange: document.getElementsByTagNameNS(W_NS, 'rPrChange').length,
      pPrChange: document.getElementsByTagNameNS(W_NS, 'pPrChange').length,
    };
  }
  return counts;
}

async function expectTrackedFormatting(
  { then }: Pick<AllureBddContext, 'then'>,
  original: Buffer,
  revised: Buffer,
  result: TaggedCompareResult,
): Promise<void> {
  await then('nothing is left unrepresented', () => {
    expect(result.unrepresentedChanges).toBeUndefined();
  });
  await then('every header and footer shows the revised formatting after Accept All and the original after Reject All, with both appliers', async () => {
    const expectedAccepted = await projectedStories(revised, 'none', 'ast');
    const expectedRejected = await projectedStories(original, 'none', 'ast');
    expect(expectedAccepted).not.toEqual(expectedRejected);
    for (const applier of ['ast', 'core'] as const) {
      expect(await projectedStories(result.document, 'accept', applier)).toEqual(expectedAccepted);
      expect(await projectedStories(result.document, 'reject', applier)).toEqual(expectedRejected);
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

/** Field structure in each header/footer part: field characters and instructions. */
async function fieldStructure(buffer: Buffer): Promise<string[]> {
  const archive = await DocxArchive.load(buffer);
  const structure: string[] = [];
  for (const slot of SLOTS) {
    const document = parseXml((await archive.getFile(partPath(slot)))!);
    structure.push([
      ...Array.from(document.getElementsByTagNameNS(W_NS, 'fldChar')).map((element) => element.getAttributeNS(W_NS, 'fldCharType')),
      ...Array.from(document.getElementsByTagNameNS(W_NS, 'instrText')).map((element) => element.textContent),
    ].join(','));
  }
  return structure;
}

describe('formatting changes beside a field, content control or drawing in a header or footer (#1392)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  test.openspec('[SDX-CMP-STORY-06] Formatting beside a field, content control or drawing is tracked')(
    'tracks bold text and a changed alignment beside a PAGE field in every header and footer',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('six stories reading Page {PAGE}; the revision bolds Page, centers the paragraph and edits the body', () =>
        Promise.all([
          storyPackage('Body draft', () => paragraph(text('Page ') + pageField())),
          storyPackage('Body final', () =>
            paragraph(text('Page ', BOLD) + pageField(), '<w:pPr><w:jc w:val="center"/></w:pPr>')),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectTrackedFormatting({ then }, original, revised, result);
      await then('each header and footer carries a run and a paragraph formatting revision, and the field is untouched', async () => {
        for (const counts of Object.values(await formattingRevisions(result.document))) {
          expect(counts.rPrChange).toBeGreaterThan(0);
          expect(counts.pPrChange).toBe(1);
        }
        expect(await fieldStructure(result.document)).toEqual(await fieldStructure(revised));
      });
    },
  );

  test.openspec('[SDX-CMP-STORY-06] Formatting beside a field, content control or drawing is tracked')(
    'tracks a font-size change on the field runs themselves',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('six stories reading Page {PAGE}; the revision sets the field runs to 9 points', () =>
        Promise.all([
          storyPackage('Body', () => paragraph(text('Page ') + pageField())),
          storyPackage('Body', () => paragraph(text('Page ') + pageField('<w:rPr><w:sz w:val="18"/></w:rPr>'))),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectTrackedFormatting({ then }, original, revised, result);
      await then('the field keeps its structure', async () => {
        expect(await fieldStructure(result.document)).toEqual(await fieldStructure(revised));
      });
    },
  );

  test.openspec('[SDX-CMP-STORY-06] Formatting beside a field, content control or drawing is tracked')(
    'tracks formatting inside and beside a content control and on the paragraph mark',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('six stories holding a Company content control; the revision bolds its text, italicizes the run beside it and bolds the paragraph mark', () =>
        Promise.all([
          storyPackage('Body', () => paragraph(contentControl('Acme') + text(' Inc'))),
          storyPackage('Body', () => paragraph(
            contentControl('Acme', BOLD) + text(' Inc', '<w:rPr><w:i/></w:rPr>'),
            '<w:pPr><w:rPr><w:b/></w:rPr></w:pPr>',
          )),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectTrackedFormatting({ then }, original, revised, result);
    },
  );

  test.openspec('[SDX-CMP-STORY-06] Formatting beside a field, content control or drawing is tracked')(
    'tracks a font and spacing change beside a VML drawing',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('six stories with a VML mark beside text; the revision changes the font and paragraph spacing', () =>
        Promise.all([
          storyPackage('Body', () => paragraph(vmlShape + text(' Confidential'))),
          storyPackage('Body', () => paragraph(
            vmlShape + text(' Confidential', '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/></w:rPr>'),
            '<w:pPr><w:spacing w:after="120"/></w:pPr>',
          )),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectTrackedFormatting({ then }, original, revised, result);
    },
  );
});

describe('scaffold changes beside formatting changes stay listed (#1392)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  const listedCases: ReadonlyArray<{ name: string; original: string; revised: string }> = [
    {
      name: 'a field instruction changed together with its formatting',
      original: paragraph(text('Page ') + pageField()),
      revised: paragraph(text('Page ', BOLD) + pageField(BOLD, ' NUMPAGES ')),
    },
    {
      name: 'a field added beside bolded text',
      original: paragraph(text('Page ') + vmlShape),
      revised: paragraph(text('Page ', BOLD) + vmlShape + pageField()),
    },
    {
      name: 'a content control removed beside bolded text',
      original: paragraph(contentControl('Acme') + text(' Inc')),
      revised: paragraph(text('Acme') + text(' Inc', BOLD)),
    },
    {
      name: 'a content control placeholder formatting change',
      original: paragraph(contentControl('Acme') + text(' Inc')),
      revised: paragraph(contentControl('Acme', '', BOLD) + text(' Inc')),
    },
  ];
  for (const listedCase of listedCases) {
    test.openspec('[SDX-CMP-STORY-05] Unsupported topology remains unrepresented')(
      `lists ${listedCase.name} instead of claiming it as a formatting revision`,
      async ({ given, when, then }: AllureBddContext) => {
        const [original, revised] = await given(`a default footer with ${listedCase.name}`, () =>
          Promise.all([
            storyPackage('Body', () => listedCase.original),
            storyPackage('Body', ({ kind, role }) =>
              (kind === 'footer' && role === 'default' ? listedCase.revised : listedCase.original)),
          ]));
        const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
        await then('the default footer is listed and carries no formatting revision', async () => {
          expect(result.unrepresentedChanges).toEqual([
            expect.objectContaining({ scope: 'footer', kind: 'changed', role: 'default' }),
          ]);
          const footer = partPath({ kind: 'footer', role: 'default' });
          expect((await formattingRevisions(result.document))[footer])
            .toEqual((await formattingRevisions(revised))[footer]);
        });
        await then('the compared package passes the emitted-document schema gate', () => assertSchema(result.document));
      },
    );
  }
});

/**
 * Existing property revisions in the paragraph: the comparison never layers a
 * second `w:rPrChange` / `w:pPrChange` onto a property element that already
 * holds one (CT_RPr and CT_PPr allow one each, §17.13.5.29, §17.13.5.31).
 */
describe('formatting beside existing formatting revisions in a header or footer (#1392)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  const footer = partPath({ kind: 'footer', role: 'default' });
  const compareFooter = async (originalStory: string, revisedStory: string) => {
    const original = await storyPackage('Body', () => originalStory);
    const revised = await storyPackage('Body', ({ kind, role }) =>
      (kind === 'footer' && role === 'default' ? revisedStory : originalStory));
    return { original, revised, result: await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS) };
  };
  const expectNoLayeredRevision = async (revised: Buffer, result: TaggedCompareResult): Promise<void> => {
    const document = parseXml((await (await DocxArchive.load(result.document)).getFile(footer))!);
    for (const name of ['rPrChange', 'pPrChange']) {
      for (const record of Array.from(document.getElementsByTagNameNS(W_NS, name))) {
        expect(record.getElementsByTagNameNS(W_NS, name)).toHaveLength(0);
        const owner = record.parentNode as Element;
        expect(Array.from(owner.childNodes).filter((child) => isW(child, name))).toHaveLength(1);
      }
    }
    expect((await formattingRevisions(result.document))[footer]).toEqual((await formattingRevisions(revised))[footer]);
    await assertSchema(result.document);
  };

  test.openspec('[SDX-CMP-STORY-06] Formatting beside a field, content control or drawing is tracked')(
    'keeps one record when bold is added to a run whose existing revision already restores its old formatting on Reject All',
    async ({ given, when, then }: AllureBddContext) => {
      const originalStory = paragraph(text('Page ', `<w:rPr>${PRIOR_RUN_REVISION}</w:rPr>`) + pageField());
      const revisedStory = paragraph(text('Page ', `<w:rPr><w:b/>${PRIOR_RUN_REVISION}</w:rPr>`) + pageField());
      await given('a footer run with an existing w:rPrChange; the revision adds bold to it', () => undefined);
      const { original, revised, result } = await when('the pair is compared', () => compareFooter(originalStory, revisedStory));
      await then('no formatting revision is layered onto the existing one and the package is schema-valid', () =>
        expectNoLayeredRevision(revised, result));
      await then('Accept All shows the revised formatting and Reject All the original document rejected, with both appliers', async () => {
        expect(result.unrepresentedChanges).toBeUndefined();
        for (const applier of ['ast', 'core'] as const) {
          expect(await projectedStories(result.document, 'accept', applier)).toEqual(await projectedStories(revised, 'accept', applier));
          expect(await projectedStories(result.document, 'reject', applier)).toEqual(await projectedStories(original, 'reject', applier));
        }
      });
    },
  );

  const listedHistoryCases: ReadonlyArray<{ name: string; original: string; revised: string }> = [
    {
      name: 'bold added beside a field run that already carries a formatting revision',
      original: paragraph(text('Page ') + pageField(`<w:rPr><w:sz w:val="18"/>${PRIOR_RUN_REVISION}</w:rPr>`)),
      revised: paragraph(text('Page ', BOLD) + pageField(`<w:rPr><w:sz w:val="18"/>${PRIOR_RUN_REVISION}</w:rPr>`)),
    },
    {
      name: 'bold added in a field paragraph whose properties already carry a formatting revision',
      original: paragraph(text('Page ') + pageField(), `<w:pPr><w:jc w:val="right"/>${PRIOR_PARAGRAPH_REVISION}</w:pPr>`),
      revised: paragraph(text('Page ', BOLD) + pageField(), `<w:pPr><w:jc w:val="right"/>${PRIOR_PARAGRAPH_REVISION}</w:pPr>`),
    },
  ];
  for (const listedCase of listedHistoryCases) {
    test.openspec('[SDX-CMP-STORY-06] Formatting beside a field, content control or drawing is tracked')(
      `lists ${listedCase.name} instead of layering a second record`,
      async ({ given, when, then }: AllureBddContext) => {
        await given(`a default footer with ${listedCase.name}`, () => undefined);
        const { revised, result } = await when('the pair is compared', () => compareFooter(listedCase.original, listedCase.revised));
        await then('the default footer is listed', () => {
          expect(result.unrepresentedChanges).toEqual([
            expect.objectContaining({ scope: 'footer', kind: 'changed', role: 'default' }),
          ]);
        });
        await then('no formatting revision is layered onto the existing one and the package is schema-valid', () =>
          expectNoLayeredRevision(revised, result));
      },
    );
  }
});
