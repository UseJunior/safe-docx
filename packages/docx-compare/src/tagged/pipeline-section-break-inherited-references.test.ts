/**
 * Deleting a paragraph-level section break the way Word does it: the content
 * before the break joins the following section, and when that section has no
 * header/footer references of its own Word copies the removed section's
 * references onto it. The following section already showed those parts by
 * inheritance, so Reject All must show the original's headers and footers on
 * every section and Accept All the revised document's, with no publication
 * failure for naming explicitly what the original inherited.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @see https://github.com/UseJunior/safe-docx/issues/1203
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
import { compareDocumentsAtomizer, TaggedPublicationSafetyError } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import {
  isBlankStoryPart,
  pageStorySlots,
  resolveEffectiveStoryBindings,
} from './effectiveStoryBindings.js';

const TEST_FEATURE = 'Section Break Removal Carrying Inherited Headers';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
  );

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-11T00:00:00.000Z') };
const PAGE_SETUP =
  '<w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

type Kind = 'header' | 'footer';
interface Part { id: string; kind: Kind; target: string; text: string }

const paragraph = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const ref = (kind: Kind, id: string, role = 'default'): string =>
  `<w:${kind}Reference w:type="${role}" r:id="${id}"/>`;
const sectionEnd = (text: string, references: string, extra = ''): string =>
  `<w:p><w:pPr><w:sectPr>${references}${PAGE_SETUP}${extra}</w:sectPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

async function packageWith(body: string, finalReferences: string, parts: Part[]): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(body, [], { namespaces: { r: R_NS } }));
  archive.setDocumentXml((await archive.getDocumentXml())
    .replace('<w:sectPr/>', `<w:sectPr>${finalReferences}${PAGE_SETUP}</w:sectPr>`));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_NS}">` +
      parts.map((entry) => `<Relationship Id="${entry.id}" Type="${R_NS}/${entry.kind}" Target="${entry.target}"/>`).join('') +
      '</Relationships>',
  );
  for (const entry of parts) {
    const root = entry.kind === 'header' ? 'w:hdr' : 'w:ftr';
    archive.setFile(`word/${entry.target}`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${root} xmlns:w="${W_NS}">${paragraph(entry.text)}</${root}>`);
  }
  const contentTypes = (await archive.getFile('[Content_Types].xml'))!;
  archive.setFile('[Content_Types].xml', contentTypes.replace('</Types>', parts.map((entry) =>
    `<Override PartName="/word/${entry.target}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${entry.kind}+xml"/>`,
  ).join('') + '</Types>'));
  return archive.save();
}

type Projection = (xml: string) => string;

/** `<section>:<kind>:<page>=<text>` for every first, odd and even page; `-` for a blank story. */
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
      : extractRoundTripComparisonText(projected).trim();
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

async function bodyTextAfterDocxCore(buffer: Buffer, mode: 'accept' | 'reject'): Promise<string> {
  const document = await DocxDocument.load(buffer);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return bodyText((await document.toBuffer()).buffer);
}

const bodyText = async (buffer: Buffer, project: Projection = (xml) => xml): Promise<string> =>
  extractRoundTripComparisonText(project(await (await DocxArchive.load(buffer)).getDocumentXml()));

const sectionCount = async (buffer: Buffer, project: Projection = (xml) => xml): Promise<number> =>
  parseXml(project(await (await DocxArchive.load(buffer)).getDocumentXml()))
    .getElementsByTagNameNS(W_NS, 'sectPr').length;

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1203-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const PARTS: Part[] = [
  { id: 'rIdCoverHeader', kind: 'header', target: 'header1.xml', text: 'Cover header' },
  { id: 'rIdCoverFooter', kind: 'footer', target: 'footer1.xml', text: 'Cover footer' },
  { id: 'rIdBodyHeader', kind: 'header', target: 'header2.xml', text: 'Agreement header' },
  { id: 'rIdBodyFooter', kind: 'footer', target: 'footer2.xml', text: 'Agreement footer' },
];
const BODY_REFERENCES = ref('header', 'rIdBodyHeader') + ref('footer', 'rIdBodyFooter');

/**
 * Three sections: a cover with its own header/footer, the agreement with its
 * own, and a final exhibit section with no references (it inherits the
 * agreement's). The revision deletes the agreement's section break as Word
 * does: the exhibit section takes over the agreement's references.
 */
async function carriedReferencesPair(revisedAgreementText = 'Agreement'): Promise<{ original: Buffer; revised: Buffer }> {
  const cover = sectionEnd('Cover', ref('header', 'rIdCoverHeader') + ref('footer', 'rIdCoverFooter'));
  return {
    original: await packageWith(cover + sectionEnd('Agreement', BODY_REFERENCES) + paragraph('Exhibit'), '', PARTS),
    revised: await packageWith(cover + paragraph(revisedAgreementText) + paragraph('Exhibit'), BODY_REFERENCES, PARTS),
  };
}

async function expectFullRedline(
  { then }: Pick<AllureBddContext, 'then'>,
  original: Buffer,
  revised: Buffer,
  compared: Buffer,
): Promise<void> {
  await then('Accept All removes the section break and Reject All restores it', async () => {
    expect(await sectionCount(compared, acceptAllChanges)).toBe(await sectionCount(revised));
    expect(await sectionCount(compared, rejectAllChanges)).toBe(await sectionCount(original));
  });
  await then('every page shows the revised headers/footers after Accept All and the original ones after Reject All, with both appliers', async () => {
    const expectedAccepted = await shownPages(revised);
    const expectedRejected = await shownPages(original);
    expect(await shownPages(compared, acceptAllChanges)).toEqual(expectedAccepted);
    expect(await shownPages(compared, rejectAllChanges)).toEqual(expectedRejected);
    expect(await shownAfterDocxCore(compared, 'accept')).toEqual(expectedAccepted);
    expect(await shownAfterDocxCore(compared, 'reject')).toEqual(expectedRejected);
  });
  await then('body text round-trips with both appliers', async () => {
    expect(await bodyText(compared, acceptAllChanges)).toBe(await bodyText(revised));
    expect(await bodyText(compared, rejectAllChanges)).toBe(await bodyText(original));
    expect(await bodyTextAfterDocxCore(compared, 'accept')).toBe(await bodyText(revised));
    expect(await bodyTextAfterDocxCore(compared, 'reject')).toBe(await bodyText(original));
  });
  await then('the compared package passes the emitted-document schema gate', () => assertSchema(compared));
}

describe('section break removal that carries inherited header/footer references (#1203)', () => {
  test('redlines the deleted section break when the following section takes over its references', async ({ given, when, then }: AllureBddContext) => {
    const { original, revised } = await given('a final section that inherits the headers of the section whose break is deleted', () =>
      carriedReferencesPair());
    const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    await expectFullRedline({ then }, original, revised, result.document);
    await then('no header or footer change is reported as unrepresented', () => {
      expect((result.unrepresentedChanges ?? []).filter((change) => change.scope === 'header' || change.scope === 'footer'))
        .toEqual([]);
    });
  });

  test('redlines a body edit next to the deleted section break', async ({ given, when, then }: AllureBddContext) => {
    const { original, revised } = await given('the same section break removal plus an edit to the joined paragraph', () =>
      carriedReferencesPair('Agreement as amended'));
    const result = await when('the pair is compared', () => compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS));
    await expectFullRedline({ then }, original, revised, result.document);
    await then('the edit is a tracked insertion', () => {
      expect(result.stats.insertions).toBeGreaterThan(0);
    });
  });

  test('still refuses a carried reference that changes what the final section shows', async ({ given, when, then }: AllureBddContext) => {
    // The revised final section names the cover header instead of the
    // agreement header it inherited: Reject All cannot restore the original
    // header there (a section property change cannot carry references, #944),
    // so the comparison must say so rather than publish it silently.
    const cover = sectionEnd('Cover', ref('header', 'rIdCoverHeader') + ref('footer', 'rIdCoverFooter'));
    const original = await given('the agreement section break', () =>
      packageWith(cover + sectionEnd('Agreement', BODY_REFERENCES) + paragraph('Exhibit'), '', PARTS));
    const revised = await given('a revision that deletes it and binds the cover header to the final section', () =>
      packageWith(cover + paragraph('Agreement') + paragraph('Exhibit'),
        ref('header', 'rIdCoverHeader') + ref('footer', 'rIdBodyFooter'), PARTS));
    const outcome = await when('the pair is compared', () =>
      compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS).then(() => undefined, (error: unknown) => error));
    await then('the formatting-fidelity gate still fails the publication', () => {
      expect(outcome).toBeInstanceOf(TaggedPublicationSafetyError);
      expect((outcome as TaggedPublicationSafetyError).failedChecks).toEqual(['formattingFidelity']);
      expect((outcome as TaggedPublicationSafetyError).formattingFidelity.reject.divergences).toEqual([
        expect.objectContaining({ scope: 'section', sectionIndex: 2, property: 'w:headerReference' }),
      ]);
    });
  });
});
