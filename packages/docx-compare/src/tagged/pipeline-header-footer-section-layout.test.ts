/**
 * A header/footer story's identity is its effective slot (section × kind ×
 * role after inheritance), paired through the section alignment the body
 * comparison emitted, so a text edit is tracked whatever else changed in the
 * section layout: a section added or removed, a page-size or orientation
 * change, `w:titlePg` or `w:evenAndOddHeaders` switched.
 *
 * Each case checks what every first, odd and even page of every section shows
 * after Accept All and Reject All, with docx-compare's appliers and with
 * docx-core's `acceptChanges`/`rejectChanges`, against the revised and the
 * original document, plus body text and the emitted-document schema gate.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.6
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.1
 * @see https://github.com/UseJunior/safe-docx/issues/1390
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
import {
  isBlankStoryPart,
  pageStorySlots,
  resolveEffectiveStoryBindings,
} from './effectiveStoryBindings.js';

const TEST_FEATURE = 'pair-header-footer-stories-through-section-alignment';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.6' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.1' },
  );

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-11T00:00:00.000Z') };
const LANDSCAPE = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>';
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

type Kind = 'header' | 'footer';
type Role = 'default' | 'first' | 'even';
interface Part { id: string; kind: Kind; target: string; lines: string[]; extraXml?: string }

const paragraph = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const ref = (kind: Kind, id: string, role: Role = 'default'): string =>
  `<w:${kind}Reference w:type="${role}" r:id="${id}"/>`;
const MARGINS = '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
/**
 * Gives every section an explicit page size and margins, as Word writes them,
 * so a `w:sectPrChange` snapshot of a changed section is never empty: Word
 * reads an empty snapshot as "keep the live properties", unlike the appliers
 * (see `preserve-section-on-snapshotless-sectprchange`).
 */
function withPageSetup(sectPr: string): string {
  const titlePg = sectPr.indexOf('<w:titlePg');
  const [head, tail] = titlePg < 0 ? [sectPr, ''] : [sectPr.slice(0, titlePg), sectPr.slice(titlePg)];
  const size = head.includes('<w:pgSz') ? '' : '<w:pgSz w:w="12240" w:h="15840"/>';
  const margins = head.includes('<w:pgMar') ? '' : MARGINS;
  const withSize = size && head.includes('<w:pgMar') ? head.replace('<w:pgMar', `${size}<w:pgMar`) : head + size;
  return withSize + margins + tail;
}
const sectionEnd = (text: string, sectPr: string): string =>
  `<w:p><w:pPr><w:sectPr>${withPageSetup(sectPr)}</w:sectPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const part = (id: string, kind: Kind, target: string, ...lines: string[]): Part => ({ id, kind, target, lines });

function storyXml(entry: Part): string {
  const root = entry.kind === 'header' ? 'w:hdr' : 'w:ftr';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${root} xmlns:w="${W_NS}" xmlns:v="urn:schemas-microsoft-com:vml">` +
    (entry.extraXml ?? '') + entry.lines.map(paragraph).join('') + `</${root}>`;
}

const settings = (contents: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${W_NS}">${contents}</w:settings>`;

async function packageWith(
  body: string,
  finalSectPr: string,
  parts: Part[],
  settingsContents = '',
): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(body, [], { namespaces: { r: R_NS } }));
  archive.setDocumentXml((await archive.getDocumentXml()).replace('<w:sectPr/>', `<w:sectPr>${withPageSetup(finalSectPr)}</w:sectPr>`));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      parts.map((entry) => `<Relationship Id="${entry.id}" Type="${R_NS}/${entry.kind}" Target="${entry.target}"/>`).join('') +
      `<Relationship Id="rIdSettings" Type="${R_NS}/settings" Target="settings.xml"/></Relationships>`,
  );
  for (const entry of parts) archive.setFile(`word/${entry.target}`, storyXml(entry));
  archive.setFile('word/settings.xml', settings(settingsContents));
  // Word opens a header/footer part only under its own content type.
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>', parts.map((entry) =>
    `<Override PartName="/word/${entry.target}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${entry.kind}+xml"/>`,
  ).join('') + (contentTypes.includes('/word/settings.xml')
    ? ''
    : '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>') +
    '</Types>'));
  return archive.save();
}

type Projection = (xml: string) => string;

/**
 * What each first, odd and even page of each section shows:
 * `<section>:<kind>:<page>=<text>`, `-` for a blank story. `project` is
 * applied to the document and to every bound part.
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
        .map((paragraphElement) => Array.from(paragraphElement.getElementsByTagNameNS(W_NS, 't'))
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

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1390-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function revisionCounts(buffer: Buffer, path: string): Promise<{ ins: number; del: number }> {
  const xml = await (await DocxArchive.load(buffer)).getFile(path);
  if (xml === null) throw new Error(`missing ${path}`);
  const document = parseXml(xml);
  return {
    ins: document.getElementsByTagNameNS(W_NS, 'ins').length,
    del: document.getElementsByTagNameNS(W_NS, 'del').length,
  };
}

const bodyText = async (buffer: Buffer, project: Projection = (xml) => xml): Promise<string> =>
  extractRoundTripComparisonText(project(await (await DocxArchive.load(buffer)).getDocumentXml()));

/**
 * The checks every represented case shares: tracked markup in `trackedParts`,
 * every page right after Accept All / Reject All with both appliers, body
 * text, no header/footer left in `unrepresentedChanges`, schema-valid output.
 */
async function expectRepresentedRedline(
  { then }: Pick<AllureBddContext, 'then'>,
  original: Buffer,
  revised: Buffer,
  result: TaggedCompareResult,
  trackedParts: string[],
): Promise<void> {
  await then('the edited header/footer parts carry tracked revisions', async () => {
    for (const path of trackedParts) {
      const counts = await revisionCounts(result.document, path);
      expect(counts.ins + counts.del, path).toBeGreaterThan(0);
    }
  });
  await then('every page shows the revised story after Accept All and the original after Reject All, with both appliers', async () => {
    const expectedAccepted = await shownPages(revised, acceptAllChanges);
    const expectedRejected = await shownPages(original, rejectAllChanges);
    expect(await shownPages(result.document, acceptAllChanges)).toEqual(expectedAccepted);
    expect(await shownPages(result.document, rejectAllChanges)).toEqual(expectedRejected);
    expect(await shownAfterDocxCore(result.document, 'accept')).toEqual(expectedAccepted);
    expect(await shownAfterDocxCore(result.document, 'reject')).toEqual(expectedRejected);
  });
  await then('body text round-trips and no header/footer change is left unrepresented', async () => {
    expect(await bodyText(result.document, acceptAllChanges)).toBe(await bodyText(revised));
    expect(await bodyText(result.document, rejectAllChanges)).toBe(await bodyText(original));
    expect((result.unrepresentedChanges ?? []).filter((change) => change.scope === 'header' || change.scope === 'footer'))
      .toEqual([]);
  });
  await then('the compared package passes the emitted-document schema gate', () => assertSchema(result.document));
}


/** Replaces `word/<name>.xml` with a footer whose one hyperlink points at `url`. */
async function withLinkedFooter(buffer: Buffer, name: string, text: string, url: string): Promise<Buffer> {
  const archive = await DocxArchive.load(buffer);
  archive.setFile(`word/${name}.xml`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}">` +
    `<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>${text}</w:t></w:r></w:hyperlink></w:p></w:ftr>`);
  archive.setFile(`word/_rels/${name}.xml.rels`,
    `<Relationships xmlns="${PKG_NS}"><Relationship Id="rIdLink" Type="${R_NS}/hyperlink" Target="${url}" TargetMode="External"/></Relationships>`);
  return archive.save();
}

/** The hyperlink target each odd page's footer resolves to, per section. */
async function oddFooterLinks(buffer: Buffer, project: Projection): Promise<string[]> {
  const archive = await DocxArchive.load(buffer);
  const bindings = resolveEffectiveStoryBindings({
    documentXml: project(await archive.getDocumentXml()),
    relationshipsXml: await archive.getFile('word/_rels/document.xml.rels'),
    settingsXml: await archive.getFile('word/settings.xml'),
  });
  const links: string[] = [];
  for (const entry of pageStorySlots(bindings).filter((x) => x.slot.kind === 'footer' && x.page === 'odd')) {
    const path = entry.slot.targetPath!;
    const rels = parseXml((await archive.getFile(path.replace('word/', 'word/_rels/') + '.rels'))!);
    const link = Array.from(rels.getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === 'rIdLink');
    links.push(link?.getAttribute('Target') ?? '-');
  }
  return links;
}


const PNG_RED = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const PNG_BLUE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC';

/**
 * Replaces `word/<name>.xml` with a footer holding `text` and one inline
 * picture whose `r:embed` targets `target`; `png` (base64) is written to that
 * media part unless it is undefined.
 */
async function withPictureFooter(buffer: Buffer, name: string, text: string, target: string, png: string | undefined): Promise<Buffer> {
  const archive = await DocxArchive.load(buffer);
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  archive.setFile(`word/${name}.xml`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:a="${A}"` +
    ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<w:p><w:r><w:t>${text}</w:t></w:r><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1"/>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:ftr>');
  archive.setFile(`word/_rels/${name}.xml.rels`,
    `<Relationships xmlns="${PKG_NS}"><Relationship Id="rIdImage" Type="${R_NS}/image" Target="${target}"/></Relationships>`);
  if (png !== undefined) {
    archive.setFile(target.startsWith('/') ? target.slice(1) : `word/${target}`, Buffer.from(png, 'base64'));
  }
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  if (!contentTypes.includes('Extension="png"')) {
    archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>'));
  }
  return archive.save();
}

/** Two original sections with their own footers; the revision shares footer1 across both and turns section 2 landscape. */
async function twoFootersSharedInRevision(): Promise<{ original: Buffer; revised: Buffer }> {
  return {
    original: await packageWith(sectionEnd('One', ref('footer', 'rIdA')) + paragraph('Two'), ref('footer', 'rIdC'),
      [part('rIdA', 'footer', 'footer1.xml', 'x'), part('rIdC', 'footer', 'footer2.xml', 'x')]),
    revised: await packageWith(sectionEnd('One', ref('footer', 'rIdB')) + paragraph('Two'), ref('footer', 'rIdB') + LANDSCAPE,
      [part('rIdB', 'footer', 'footer1.xml', 'x')]),
  };
}

async function expectBothFootersStayReported(result: TaggedCompareResult): Promise<void> {
  expect(await revisionCounts(result.document, 'word/footer1.xml')).toEqual({ ins: 0, del: 0 });
  expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
    expect.objectContaining({ scope: 'footer', sectionIndex: 0 }),
    expect.objectContaining({ scope: 'footer', sectionIndex: 1 }),
  ]));
}


/**
 * Replaces `word/<name>.xml` with a footer holding `text` and one chart whose
 * part is `word/charts/<chart>.xml`. Every chart's XML is the same; its
 * `c:userShapes` drawing carries `label`, so charts differ only one
 * relationship hop away from the footer.
 */
async function withChartFooter(buffer: Buffer, name: string, text: string, chart: string, label: string): Promise<Buffer> {
  const archive = await DocxArchive.load(buffer);
  const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  archive.setFile(`word/${name}.xml`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:a="${A}" xmlns:c="${C}"` +
    ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    `<w:p><w:r><w:t>${text}</w:t></w:r><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Chart 1"/>` +
    `<a:graphic><a:graphicData uri="${C}"><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:ftr>`);
  archive.setFile(`word/_rels/${name}.xml.rels`,
    `<Relationships xmlns="${PKG_NS}"><Relationship Id="rIdChart" Type="${R_NS}/chart" Target="charts/${chart}.xml"/></Relationships>`);
  archive.setFile(`word/charts/${chart}.xml`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${C}" xmlns:r="${R_NS}"><c:chart><c:plotArea><c:layout/></c:plotArea></c:chart><c:userShapes r:id="rIdShapes"/></c:chartSpace>`);
  archive.setFile(`word/charts/_rels/${chart}.xml.rels`,
    `<Relationships xmlns="${PKG_NS}"><Relationship Id="rIdShapes" Type="${R_NS}/chartUserShapes" Target="../drawings/${chart}.xml"/></Relationships>`);
  archive.setFile(`word/drawings/${chart}.xml`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:userShapes xmlns:c="${C}" xmlns:cdr="http://schemas.openxmlformats.org/drawingml/2006/chartDrawing" xmlns:a="${A}"><cdr:relSizeAnchor><cdr:from><cdr:x>0</cdr:x><cdr:y>0</cdr:y></cdr:from><cdr:to><cdr:x>1</cdr:x><cdr:y>1</cdr:y></cdr:to><cdr:sp macro="" textlink=""><cdr:nvSpPr><cdr:cNvPr id="2" name="Label"/><cdr:cNvSpPr/></cdr:nvSpPr><cdr:spPr/><cdr:txBody><a:bodyPr/><a:p><a:r><a:t>${label}</a:t></a:r></a:p></cdr:txBody></cdr:sp></cdr:relSizeAnchor></c:userShapes>`);
  return archive.save();
}

describe('header/footer edits across section-layout changes (#1390)', () => {
  test.openspec('[SDX-CMP-SLOTPAIR-01] Header/footer edit across a page-layout change is tracked')(
    'tracks a shared footer edit when the revision turns section 2 landscape (issue reproduction)',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('two sections sharing a default footer; the revision edits it and turns section 2 landscape', () =>
        Promise.all([
          packageWith(sectionEnd('One', ref('footer', 'rIdF')) + paragraph('Two'), ref('footer', 'rIdF'),
            [part('rIdF', 'footer', 'footer1.xml', 'Draft v1')]),
          packageWith(sectionEnd('One', ref('footer', 'rIdF')) + paragraph('Two'), ref('footer', 'rIdF') + LANDSCAPE,
            [part('rIdF', 'footer', 'footer1.xml', 'Draft v2')]),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectRepresentedRedline({ then }, original, revised, result, ['word/footer1.xml']);
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-01] Header/footer edit across a page-layout change is tracked')(
    'tracks inherited and explicit headers across three sections when one section changes margins',
    async ({ given, when, then }: AllureBddContext) => {
      const margins = (left: number): string =>
        `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="${left}" w:header="720" w:footer="720" w:gutter="0"/>`;
      const body = (middleMargin: number): string =>
        sectionEnd('One', ref('header', 'rIdA')) + sectionEnd('Two', margins(middleMargin)) + paragraph('Three');
      const [original, revised] = await given('header A on section 0, inherited by section 1; header B on section 2', () =>
        Promise.all([
          packageWith(body(1440), ref('header', 'rIdB'), [
            part('rIdA', 'header', 'header1.xml', 'Alpha draft'),
            part('rIdB', 'header', 'header2.xml', 'Beta draft'),
          ]),
          packageWith(body(2880), ref('header', 'rIdB'), [
            part('rIdA', 'header', 'header1.xml', 'Alpha final'),
            part('rIdB', 'header', 'header2.xml', 'Beta final'),
          ]),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectRepresentedRedline({ then }, original, revised, result, ['word/header1.xml', 'word/header2.xml']);
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-02] Header/footer edit across an added or removed section is tracked')(
    'tracks a footer edit when the revision adds a section',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('one section; the revision splits it in two and edits the footer both show', () =>
        Promise.all([
          packageWith(paragraph('One') + paragraph('Two'), ref('footer', 'rIdF'), [part('rIdF', 'footer', 'footer1.xml', 'Draft v1')]),
          packageWith(sectionEnd('One', ref('footer', 'rIdF')) + paragraph('Two'), ref('footer', 'rIdF'),
            [part('rIdF', 'footer', 'footer1.xml', 'Draft v2')]),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectRepresentedRedline({ then }, original, revised, result, ['word/footer1.xml']);
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-02] Header/footer edit across an added or removed section is tracked')(
    'tracks a footer edit when the revision removes a section',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('two sections sharing a footer; the revision merges them and edits it', () =>
        Promise.all([
          packageWith(sectionEnd('One', ref('footer', 'rIdF')) + paragraph('Two'), ref('footer', 'rIdF'),
            [part('rIdF', 'footer', 'footer1.xml', 'Draft v1')]),
          packageWith(paragraph('One') + paragraph('Two'), ref('footer', 'rIdF'), [part('rIdF', 'footer', 'footer1.xml', 'Draft v2')]),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectRepresentedRedline({ then }, original, revised, result, ['word/footer1.xml']);
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-02] Header/footer edit across an added or removed section is tracked')(
    'tracks the surviving footer edit next to a removed section\'s own footer',
    async ({ given, when, then }: AllureBddContext) => {
      // Section 0 has a footer of its own that the revision removes with the
      // section (a tracked deletion, #754); the final section's footer is
      // edited and paired through the alignment.
      const [original, revised] = await given('section 0 with its own footer, section 1 with another; the revision removes section 0', () =>
        Promise.all([
          packageWith(sectionEnd('One', ref('footer', 'rIdGone')) + paragraph('Two'), ref('footer', 'rIdF'), [
            part('rIdGone', 'footer', 'footer2.xml', 'Removed section footer'),
            part('rIdF', 'footer', 'footer1.xml', 'Final draft'),
          ]),
          packageWith(paragraph('One') + paragraph('Two'), ref('footer', 'rIdF'), [part('rIdF', 'footer', 'footer1.xml', 'Final signed')]),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectRepresentedRedline({ then }, original, revised, result, ['word/footer1.xml']);
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-03] Header/footer edit across a first-page switch is tracked, and first and even stories pair by role')(
    'tracks a default footer edit when the revision turns on a distinct first page',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('a default footer; the revision sets w:titlePg and edits the footer', () =>
        Promise.all([
          packageWith(paragraph('Body'), ref('footer', 'rIdF'), [part('rIdF', 'footer', 'footer1.xml', 'Draft v1')]),
          packageWith(paragraph('Body'), ref('footer', 'rIdF') + '<w:titlePg/>', [part('rIdF', 'footer', 'footer1.xml', 'Draft v2')]),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectRepresentedRedline({ then }, original, revised, result, ['word/footer1.xml']);
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-03] Header/footer edit across a first-page switch is tracked, and first and even stories pair by role')(
    'tracks first-page and default header edits when the revision turns the section landscape',
    async ({ given, when, then }: AllureBddContext) => {
      const sectPr = (layout: string): string => ref('header', 'rIdD') + ref('header', 'rIdFirst', 'first') + layout + '<w:titlePg/>';
      const [original, revised] = await given('a title page header and a default header; the revision edits both and turns landscape', () =>
        Promise.all([
          packageWith(paragraph('Body'), sectPr(''), [
            part('rIdD', 'header', 'header1.xml', 'Running draft'),
            part('rIdFirst', 'header', 'header2.xml', 'Cover draft'),
          ]),
          packageWith(paragraph('Body'), sectPr(LANDSCAPE), [
            part('rIdD', 'header', 'header1.xml', 'Running final'),
            part('rIdFirst', 'header', 'header2.xml', 'Cover final'),
          ]),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectRepresentedRedline({ then }, original, revised, result, ['word/header1.xml', 'word/header2.xml']);
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-03] Header/footer edit across a first-page switch is tracked, and first and even stories pair by role')(
    'tracks an even-page footer edit when the revision adds a section',
    async ({ given, when, then }: AllureBddContext) => {
      const references = ref('footer', 'rIdOdd') + ref('footer', 'rIdEven', 'even');
      const parts = (state: string): Part[] => [
        part('rIdOdd', 'footer', 'footer1.xml', 'Odd footer'),
        part('rIdEven', 'footer', 'footer2.xml', `Even footer ${state}`),
      ];
      const [original, revised] = await given('different even pages on; the revision adds a section and edits the even footer', () =>
        Promise.all([
          packageWith(paragraph('One') + paragraph('Two'), references, parts('draft'), '<w:evenAndOddHeaders/>'),
          packageWith(sectionEnd('One', references) + paragraph('Two'), references, parts('final'), '<w:evenAndOddHeaders/>'),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectRepresentedRedline({ then }, original, revised, result, ['word/footer2.xml']);
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-04] Turning on different even pages redlines the new even story against what the original showed there')(
    'redlines the new even-page footer against the default footer the original showed on even pages',
    async ({ given, when, then }: AllureBddContext) => {
      // w:evenAndOddHeaders lives in settings.xml, which has no revision
      // markup, so the compared package keeps the revised (on) value and
      // Reject All still shows the even story on even pages. The even story
      // therefore receives the redline from the default footer the original
      // showed there, and the default footer its own edit.
      const [original, revised] = await given('one default footer; the revision turns on even pages with a new even footer and edits the default', () =>
        Promise.all([
          packageWith(paragraph('Body'), ref('footer', 'rIdF'), [part('rIdF', 'footer', 'footer1.xml', 'Draft v1')]),
          packageWith(paragraph('Body'), ref('footer', 'rIdF') + ref('footer', 'rIdE', 'even'), [
            part('rIdF', 'footer', 'footer1.xml', 'Draft v2'),
            part('rIdE', 'footer', 'footer2.xml', 'Even pages v2'),
          ], '<w:evenAndOddHeaders/>'),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectRepresentedRedline({ then }, original, revised, result, ['word/footer1.xml', 'word/footer2.xml']);
      await then('the even footer shows the original default text as deleted', async () => {
        const footer = (await (await DocxArchive.load(result.document)).getFile('word/footer2.xml'))!;
        expect(extractRoundTripComparisonText(rejectAllChanges(footer))).toBe('Draft v1');
        expect(extractRoundTripComparisonText(acceptAllChanges(footer))).toBe('Even pages v2');
      });
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-05] A story whose pages cannot come out right stays unrepresented')(
    'leaves the footer edit unrepresented when the revision turns different even pages off',
    async ({ given, when, then }: AllureBddContext) => {
      // With the setting off in the compared package, every page of Reject
      // All shows the default story, so it cannot show the original's even
      // footer on even pages and its default footer on odd ones.
      const [original, revised] = await given('default and even footers; the revision turns even pages off and edits the default', () =>
        Promise.all([
          packageWith(paragraph('Body'), ref('footer', 'rIdF') + ref('footer', 'rIdE', 'even'), [
            part('rIdF', 'footer', 'footer1.xml', 'Draft v1'),
            part('rIdE', 'footer', 'footer2.xml', 'Even pages v1'),
          ], '<w:evenAndOddHeaders/>'),
          packageWith(paragraph('Body'), ref('footer', 'rIdF'), [part('rIdF', 'footer', 'footer1.xml', 'Draft v2')]),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await then('the footer carries no revision and the change stays reported', async () => {
        expect(await revisionCounts(result.document, 'word/footer1.xml')).toEqual({ ins: 0, del: 0 });
        expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
          expect.objectContaining({ scope: 'footer', sectionIndex: 0, role: 'default' }),
        ]));
        await assertSchema(result.document);
      });
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-05] A story whose pages cannot come out right stays unrepresented')(
    'leaves the footer edit unrepresented when the revision turns even pages on with no even story',
    async ({ given, when, then }: AllureBddContext) => {
      // Reject All would leave the original's even pages blank: no story
      // exists in either document that could carry the original default
      // footer onto them.
      const [original, revised] = await given('a default footer; the revision turns even pages on without an even footer and edits the default', () =>
        Promise.all([
          packageWith(paragraph('Body'), ref('footer', 'rIdF'), [part('rIdF', 'footer', 'footer1.xml', 'Draft v1')]),
          packageWith(paragraph('Body'), ref('footer', 'rIdF'), [part('rIdF', 'footer', 'footer1.xml', 'Draft v2')], '<w:evenAndOddHeaders/>'),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await then('the footer carries no revision and the change stays reported', async () => {
        expect(await revisionCounts(result.document, 'word/footer1.xml')).toEqual({ ins: 0, del: 0 });
        expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
          expect.objectContaining({ scope: 'footer', sectionIndex: 0, role: 'default' }),
        ]));
      });
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-05] A story whose pages cannot come out right stays unrepresented')(
    'keeps refusing a text-box footer edit when the revision turns even pages on with a new even footer',
    async ({ given, when }: AllureBddContext) => {
      // Text-box stories keep the #1204 checks. Reject All would show the new
      // plain even footer where the original showed the boxed default footer;
      // the redline that could carry the box there would have to track its
      // carrier run, which the comparison leaves untracked (#647).
      const box = (text: string): string =>
        '<w:p><w:r><w:pict><v:shape id="box1" style="width:200pt;height:40pt"><v:textbox><w:txbxContent>' +
        `${paragraph(text)}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
      const [original, revised] = await given('a boxed default footer; the revision edits the box and turns on even pages with a plain even footer', () =>
        Promise.all([
          packageWith(paragraph('Body'), ref('footer', 'rIdF'), [{ ...part('rIdF', 'footer', 'footer1.xml', 'Footer line'), extraXml: box('Old box') }]),
          packageWith(paragraph('Body'), ref('footer', 'rIdF') + ref('footer', 'rIdE', 'even'), [
            { ...part('rIdF', 'footer', 'footer1.xml', 'Footer line'), extraXml: box('New box') },
            part('rIdE', 'footer', 'footer2.xml', 'Even pages'),
          ], '<w:evenAndOddHeaders/>'),
        ]));
      await when('the pair is compared, the comparison refuses instead of publishing', async () => {
        await expect(compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).rejects.toThrow(
          /accept\/reject package projection validation/u,
        );
      });
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-06] Explicit, inherited and renamed bindings of one slot pair as one story')(
    'pairs a header the revision moves to a new part name and onto an inherited reference',
    async ({ given, when, then }: AllureBddContext) => {
      // Original: both sections name header1.xml. Revised: section 0 names
      // header7.xml, section 1 inherits it, and section 1 turns landscape.
      const [original, revised] = await given('the same header slot under a different part name and binding', () =>
        Promise.all([
          packageWith(sectionEnd('One', ref('header', 'rIdH')) + paragraph('Two'), ref('header', 'rIdH'),
            [part('rIdH', 'header', 'header1.xml', 'Header draft')]),
          packageWith(sectionEnd('One', ref('header', 'rIdNew')) + paragraph('Two'), LANDSCAPE,
            [part('rIdNew', 'header', 'header7.xml', 'Header final')]),
        ]));
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectRepresentedRedline({ then }, original, revised, result, ['word/header7.xml']);
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-07] Story identity includes what its relationship ids resolve to')(
    'keeps two original footers with the same markup but different hyperlink targets apart',
    async ({ given, when, then }: AllureBddContext) => {
      // The two original footers are byte-identical XML, but rIdLink in each
      // resolves to a different URL. The revision shares one edited footer.
      // Reject All of a redline in that shared part could only restore one
      // URL, so neither section may count as represented.
      const [original, revised] = await given('identical footer markup linking to different URLs; the revision shares one edited footer', async () => {
        let original = await packageWith(sectionEnd('One', ref('footer', 'rIdA')) + paragraph('Two'), ref('footer', 'rIdC'),
          [part('rIdA', 'footer', 'footer1.xml', 'x'), part('rIdC', 'footer', 'footer2.xml', 'x')]);
        original = await withLinkedFooter(original, 'footer1', 'Old', 'https://alpha.example');
        original = await withLinkedFooter(original, 'footer2', 'Old', 'https://beta.example');
        let revised = await packageWith(sectionEnd('One', ref('footer', 'rIdB')) + paragraph('Two'), ref('footer', 'rIdB') + LANDSCAPE,
          [part('rIdB', 'footer', 'footer1.xml', 'x')]);
        revised = await withLinkedFooter(revised, 'footer1', 'New', 'https://alpha.example');
        return [original, revised] as const;
      });
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await then('the shared footer is not redlined and both footer changes stay reported', async () => {
        expect(await oddFooterLinks(original, (xml) => xml)).toEqual(['https://alpha.example', 'https://beta.example']);
        expect(await revisionCounts(result.document, 'word/footer1.xml')).toEqual({ ins: 0, del: 0 });
        expect(result.unrepresentedChanges).toEqual(expect.arrayContaining([
          expect.objectContaining({ scope: 'footer', sectionIndex: 0 }),
          expect.objectContaining({ scope: 'footer', sectionIndex: 1 }),
        ]));
        await assertSchema(result.document);
      });
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-07] Story identity includes what its relationship ids resolve to')(
    'redlines a shared linked footer whose hyperlink resolves to the same URL on both sides',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('one linked footer shared by two sections; the revision edits it and turns section 2 landscape', async () => {
        const original = await withLinkedFooter(
          await packageWith(sectionEnd('One', ref('footer', 'rIdF')) + paragraph('Two'), '', [part('rIdF', 'footer', 'footer1.xml', 'x')]),
          'footer1', 'Old', 'https://alpha.example');
        const revised = await withLinkedFooter(
          await packageWith(sectionEnd('One', ref('footer', 'rIdF')) + paragraph('Two'), LANDSCAPE, [part('rIdF', 'footer', 'footer1.xml', 'x')]),
          'footer1', 'New', 'https://alpha.example');
        return [original, revised] as const;
      });
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectRepresentedRedline({ then }, original, revised, result, ['word/footer1.xml']);
      await then('every page of both projections links to the same URL', async () => {
        expect(await oddFooterLinks(result.document, rejectAllChanges)).toEqual(['https://alpha.example', 'https://alpha.example']);
        expect(await oddFooterLinks(result.document, acceptAllChanges)).toEqual(['https://alpha.example', 'https://alpha.example']);
      });
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-07] Story identity includes what its relationship ids resolve to')(
    'keeps two original footers apart whose pictures differ only in media bytes, for relative and package-absolute targets',
    async ({ given, when, then }: AllureBddContext) => {
      for (const absolute of [false, true]) {
        const [original, revised] = await given(`same footer markup with pictures of different bytes (${absolute ? 'absolute' : 'relative'} targets)`, async () => {
          const shape = await twoFootersSharedInRevision();
          const media = (file: string): string => (absolute ? `/word/media/${file}` : `media/${file}`);
          let original = await withPictureFooter(shape.original, 'footer1', 'Old', media('a.png'), PNG_RED);
          original = await withPictureFooter(original, 'footer2', 'Old', media('b.png'), PNG_BLUE);
          const revised = await withPictureFooter(shape.revised, 'footer1', 'New', media('a.png'), PNG_RED);
          return [original, revised] as const;
        });
        const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
        await then('the shared footer is not redlined and both footer changes stay reported', async () => {
          await expectBothFootersStayReported(result);
          await assertSchema(result.document);
        });
      }
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-07] Story identity includes what its relationship ids resolve to')(
    'keeps footers apart whose pictures point at media parts missing from the package',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('two original footers whose picture targets are absent', async () => {
        const shape = await twoFootersSharedInRevision();
        let original = await withPictureFooter(shape.original, 'footer1', 'Old', 'media/a.png', undefined);
        original = await withPictureFooter(original, 'footer2', 'Old', 'media/b.png', undefined);
        const revised = await withPictureFooter(shape.revised, 'footer1', 'New', 'media/a.png', undefined);
        return [original, revised] as const;
      });
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await then('nothing that cannot be resolved counts as represented', () => expectBothFootersStayReported(result));
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-07] Story identity includes what its relationship ids resolve to')(
    'pairs two original footers that link to the same URL under different relationship ids',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('the same link under rIdLink in one footer and rIdOther in the other', async () => {
        const shape = await twoFootersSharedInRevision();
        let original = await withLinkedFooter(shape.original, 'footer1', 'Old', 'https://alpha.example');
        original = await withLinkedFooter(original, 'footer2', 'Old', 'https://alpha.example');
        const archive = await DocxArchive.load(original);
        for (const path of ['word/footer2.xml', 'word/_rels/footer2.xml.rels']) {
          archive.setFile(path, (await archive.getFile(path))!.replaceAll('rIdLink', 'rIdOther'));
        }
        original = await archive.save();
        const revised = await withLinkedFooter(shape.revised, 'footer1', 'New', 'https://alpha.example');
        return [original, revised] as const;
      });
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await expectRepresentedRedline({ then }, original, revised, result, ['word/footer1.xml']);
    },
  );

  test.openspec('[SDX-CMP-SLOTPAIR-07] Story identity includes what its relationship ids resolve to')(
    'keeps two original footers apart whose charts differ only in a drawing one relationship further away',
    async ({ given, when, then }: AllureBddContext) => {
      const [original, revised] = await given('equal chart XML whose user-shape drawings say ALPHA and BETA', async () => {
        const shape = await twoFootersSharedInRevision();
        let original = await withChartFooter(shape.original, 'footer1', 'Old', 'chart1', 'ALPHA');
        original = await withChartFooter(original, 'footer2', 'Old', 'chart2', 'BETA');
        const revised = await withChartFooter(shape.revised, 'footer1', 'New', 'chart1', 'ALPHA');
        return [original, revised] as const;
      });
      const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
      await then('the shared footer is not redlined and both footer changes stay reported', () => expectBothFootersStayReported(result));
    },
  );
});
