/**
 * A content control's own properties (`w:sdtPr`: its alias, tag, data binding)
 * changed inside a footnote or endnote definition whose text, inline
 * references and formatting are otherwise unchanged. CT_SdtPr admits no
 * revision element, so, as in the main story, the redline carries the
 * revised properties and the change is listed in `unrepresentedChanges`
 * (`contentControl` scope, naming the note story); it is never dropped
 * silently. The text around it, and an ordinary body edit beside it, are
 * still tracked, and Accept All / Reject All reproduce the revised / original
 * text with both the docx-compare and the docx-core appliers.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.38
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.29
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.10
 * @see https://github.com/UseJunior/safe-docx/issues/1507
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { acceptChanges, buildSyntheticDocx, DocxArchive, parseXml, rejectChanges, serializeXml } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments, formatUnrepresentedChangeWarnings } from '../index.js';
import { extractRoundTripComparisonText } from '../fieldComparisonSemantics.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const TEST_FEATURE = 'Note Content Control Properties';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE, severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.38' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.29' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.10' },
  );

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const schemaScript = fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url));
const OPTIONS = { author: 'Comparison', date: new Date('2026-11-15T00:00:00.000Z') };

type Story = 'footnote' | 'endnote' | 'body';
const control = (alias: string, tag: string, text: string): string =>
  `<w:sdt><w:sdtPr><w:alias w:val="${alias}"/><w:tag w:val="${tag}"/><w:id w:val="7"/></w:sdtPr>` +
  `<w:sdtContent><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:sdtContent></w:sdt>`;

async function build(story: Story, alias: string, tag: string, bodyText: string): Promise<Buffer> {
  const note = story === 'body' ? {} : story === 'footnote'
    ? { footnoteOnParagraph: 0, footnoteText: 'placeholder' }
    : { endnoteOnParagraph: 0, endnoteText: 'placeholder' };
  const docx = await buildSyntheticDocx({ paragraphs: [bodyText, 'Second paragraph.'], ...note });
  const zip = await JSZip.loadAsync(docx);
  const path = story === 'body' ? 'word/document.xml' : `word/${story}s.xml`;
  const xml = await zip.file(path)!.async('string');
  const next = story === 'body'
    ? xml.replace('<w:body>', `<w:body>${control(alias, tag, 'Controlled text')}`)
    : xml.replace(
      new RegExp(`(<w:${story} w:id="1">)[\\s\\S]*?(</w:${story}>)`),
      `$1<w:p><w:r><w:t xml:space="preserve">Note lead.</w:t></w:r></w:p>${control(alias, tag, 'Controlled text')}$2`,
    );
  expect(next).not.toBe(xml);
  zip.file(path, next);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-note-sdtpr-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const partOf = (story: Story): string => story === 'body' ? 'word/document.xml' : `word/${story}s.xml`;
const read = async (buffer: Buffer, path: string): Promise<string> => (await DocxArchive.load(buffer)).getFile(path) as Promise<string>;
const aliases = (xml: string): string[] => Array.from(parseXml(xml).getElementsByTagNameNS(W, 'alias'))
  .map((alias) => alias.getAttributeNS(W, 'val') ?? '');

async function docxCoreProjection(buffer: Buffer, path: string, mode: 'accept' | 'reject'): Promise<string> {
  const doc = parseXml(await read(buffer, path));
  if (mode === 'accept') acceptChanges(doc); else rejectChanges(doc);
  return serializeXml(doc);
}

const CASES: Array<{ story: Story; property: 'alias' | 'tag' }> = [
  { story: 'footnote', property: 'alias' },
  { story: 'footnote', property: 'tag' },
  { story: 'endnote', property: 'alias' },
  { story: 'endnote', property: 'tag' },
  { story: 'body', property: 'alias' },
  { story: 'body', property: 'tag' },
];

describe('content-control property changes inside a footnote or endnote', () => {
  for (const { story, property } of CASES) {
    for (const bodyEdit of [false, true]) {
      test(
        `a w:${property} change on a control in the ${story}${bodyEdit ? ', beside a body edit,' : ''} is listed and accept/reject are exact`,
        async () => {
          const original = await build(story, 'Draft', 'clause', 'First.');
          const revised = await build(
            story,
            property === 'alias' ? 'Final' : 'Draft',
            property === 'tag' ? 'clause-final' : 'clause',
            bodyEdit ? 'First, amended.' : 'First.',
          );
          const result = await compareDocuments(original, revised, OPTIONS);
          const listed = (result.unrepresentedChanges ?? []).filter((change) => change.scope === 'contentControl');
          expect(listed).toHaveLength(1);
          expect(listed[0]!.kind).toBe('changed');
          expect(listed[0]!.contentControl).toMatchObject({
            element: 'sdtPr',
            index: 0,
            id: '7',
            alias: property === 'alias' ? 'Final' : 'Draft',
            tag: property === 'tag' ? 'clause-final' : 'clause',
            ...(story === 'body' ? {} : { story, partPath: partOf(story) }),
          });
          if (story === 'body') expect(listed[0]!.contentControl!.story).toBeUndefined();
          const warnings = formatUnrepresentedChangeWarnings(result.unrepresentedChanges);
          expect(warnings.some((warning) => warning.includes('w:sdtPr'))).toBe(true);
          if (story !== 'body') {
            expect(warnings.some((warning) => warning.includes(`${story} `) && warning.includes(partOf(story)))).toBe(true);
          }
          // The redline carries the revised properties (no revision can hold them).
          expect(aliases(await read(result.document, partOf(story)))).toEqual([property === 'alias' ? 'Final' : 'Draft']);
          await assertSchema(result.document);

          for (const path of new Set(['word/document.xml', partOf(story)])) {
            const compared = await read(result.document, path);
            const expectedAccepted = extractRoundTripComparisonText(await read(revised, path));
            const expectedRejected = extractRoundTripComparisonText(await read(original, path));
            expect(extractRoundTripComparisonText(acceptAllChanges(compared))).toBe(expectedAccepted);
            expect(extractRoundTripComparisonText(rejectAllChanges(compared))).toBe(expectedRejected);
            expect(extractRoundTripComparisonText(await docxCoreProjection(result.document, path, 'accept'))).toBe(expectedAccepted);
            expect(extractRoundTripComparisonText(await docxCoreProjection(result.document, path, 'reject'))).toBe(expectedRejected);
          }
        },
        60_000,
      );
    }
  }

  test(
    'an unchanged control in a footnote lists nothing',
    async () => {
      const original = await build('footnote', 'Draft', 'clause', 'First.');
      const revised = await build('footnote', 'Draft', 'clause', 'First, amended.');
      const result = await compareDocuments(original, revised, OPTIONS);
      expect((result.unrepresentedChanges ?? []).filter((change) => change.scope === 'contentControl')).toEqual([]);
      await assertSchema(result.document);
    },
    60_000,
  );
});
