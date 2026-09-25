import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { buildSyntheticDocx, parseXml } from '@usejunior/docx-core';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { buildDocxFromBodyXml } from '../../docx-core/src/testing/ooxml-fixtures.js';
import { compileMarkdoc } from './compile.js';
import { importDocxToMarkdoc } from './import.js';
import { requireMarkdoc } from './markdoc.js';
import type { CompileOptions } from './types.js';

const TEST_FEATURE = 'Readable redline coalescing';
const revisionTest = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 998 readability-aware revision grouping',
  severity: 'critical',
})
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' });

async function fixture(
  before = 'The old red term applies.',
  after = 'The new blue term applies.',
  markdocPolicy?: 'token-minimal' | 'readable-whitespace',
  options: CompileOptions = {},
  changeAttributes = '',
) {
  const source = await buildSyntheticDocx({ paragraphs: [before] });
  const imported = await importDocxToMarkdoc(source);
  const paragraph = requireMarkdoc(imported.markdoc).scaffold[0]!;
  const change = [
    `{% change id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="rewrite" format="inherit-source-paragraph"${changeAttributes} %}`,
    '{% before %}', before, '{% /before %}',
    '{% after %}', after, '{% /after %}',
    '{% /change %}',
  ].join('\n');
  let markdoc = imported.markdoc.replace(
    new RegExp(`\\{% para id="${paragraph.id}"[\\s\\S]*?\\{% /para %\\}`),
    change,
  );
  if (markdocPolicy) {
    markdoc = markdoc.replace(/(\{% source[^\n]+\/%\})/u, `$1\n\n{% compilation revision-grouping="${markdocPolicy}" /%}`);
  }
  const result = await compileMarkdoc(imported.anchoredSource, markdoc, options);
  const archive = await JSZip.loadAsync(result.tracked);
  const xml = await archive.file('word/document.xml')!.async('string');
  return { result, xml };
}

async function customRunFixture(bodyXml: string, before: string, afterMarkup: string) {
  const imported = await importDocxToMarkdoc(await buildDocxFromBodyXml(bodyXml));
  const paragraph = requireMarkdoc(imported.markdoc).scaffold[0]!;
  const change = [
    `{% change id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="custom" format="inherit-source-paragraph" %}`,
    '{% before %}', before, '{% /before %}',
    '{% after %}', afterMarkup, '{% /after %}',
    '{% /change %}',
  ].join('\n');
  const markdoc = imported.markdoc.replace(
    new RegExp(`\\{% para id="${paragraph.id}"[\\s\\S]*?\\{% /para %\\}`), change,
  );
  return compileMarkdoc(imported.anchoredSource, markdoc);
}

describe('readable redline grouping', () => {
  revisionTest('[SDX-MDOC-139][SDX-MDOC-142] readable grouping is the sole default', async () => {
    const { result, xml } = await fixture();
    expect(result.certificate.passed).toBe(true);
    expect(result.certificate.rejectAllEqualsSource).toBe(true);
    expect(result.certificate.acceptAllEqualsClean).toBe(true);
    expect(result.certificate.rejectAllFormattingEqualsSource).toBe(true);
    expect(result.certificate.acceptAllFormattingEqualsClean).toBe(true);
    expect(result.certificate.revisionGrouping).toEqual({
      policy: 'readable-whitespace', source: 'default', coalescedSpaceTokens: 1, groupedChains: 1,
    });
    const document = parseXml(xml);
    const contentDeletions = Array.from(document.getElementsByTagNameNS('*', 'del'))
      .filter((wrapper) => (wrapper.textContent ?? '') !== '');
    const contentInsertions = Array.from(document.getElementsByTagNameNS('*', 'ins'))
      .filter((wrapper) => (wrapper.textContent ?? '') !== '');
    expect(contentDeletions).toHaveLength(1);
    expect(contentDeletions[0]!.textContent).toBe('old red');
    expect(contentInsertions.map((wrapper) => wrapper.textContent)).toEqual(['new blue']);
    expect(xml).toMatch(/<w:delText xml:space="preserve"> <\/w:delText>/u);
    expect(xml).toMatch(/<w:t xml:space="preserve"> <\/w:t>/u);
  });

  revisionTest('[SDX-MDOC-142] groups an eligible chain spanning the whole paragraph', async () => {
    const { result } = await fixture('old red', 'new blue');
    expect(result.certificate.revisionGrouping).toMatchObject({ groupedChains: 1, coalescedSpaceTokens: 1 });
  });

  revisionTest('[SDX-MDOC-140] rejects former declarative selectors before mutation', async () => {
    for (const policy of ['token-minimal', 'readable-whitespace'] as const) {
      await expect(fixture(undefined, undefined, policy)).rejects.toMatchObject({
        code: 'INVALID_MARKDOC',
        issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('revision-grouping') })]),
      });
    }
  });

  revisionTest('[SDX-MDOC-141] rejects own runtime selectors even when undefined', async () => {
    for (const value of [{ policy: 'token-minimal' }, undefined]) {
      const options = { revisionGrouping: value } as unknown as CompileOptions;
      await expect(fixture(undefined, undefined, undefined, options))
        .rejects.toMatchObject({ code: 'REVISION_GROUPING_REMOVED' });
    }
  });

  revisionTest('[SDX-MDOC-143] minimal-hunk validation still rejects ambiguous formatting', async () => {
    await expect(fixture(undefined, undefined, undefined, {}, ' underline="single"'))
      .rejects.toMatchObject({ code: 'AMBIGUOUS_RUN_FORMAT_SCOPE' });
  });

  revisionTest('[SDX-MDOC-146] does not attribute preserved pre-existing grouping to this build', async () => {
    const source = await buildDocxFromBodyXml(
      '<w:p><w:r><w:t xml:space="preserve">Keep </w:t></w:r>'
      + '<w:del w:id="1" w:author="Prior" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>aa bb</w:delText></w:r></w:del>'
      + '<w:ins w:id="2" w:author="Prior" w:date="2026-01-01T00:00:00Z"><w:r><w:t>cc dd</w:t></w:r></w:ins></w:p>',
    );
    const imported = await importDocxToMarkdoc(source);

    const result = await compileMarkdoc(imported.anchoredSource, imported.markdoc);
    expect(result.certificate.revisionGrouping).toEqual({
      policy: 'readable-whitespace', source: 'default', coalescedSpaceTokens: 0, groupedChains: 0,
    });
    expect(result.certificate.existingRevisionsPreserved).toBe(true);
  });

  revisionTest('[SDX-MDOC-144][SDX-MDOC-145] punctuation, structural whitespace, and lone fragments remain ungrouped', async () => {
    const cases: Array<[string, string]> = [
      ['The old, red term.', 'The new, blue term.'],
      ['The old\tred term.', 'The new\tblue term.'],
      ['The old term.', 'The new term.'],
      ['The old red term.', 'The new very red term.'],
      ['The old old red term.', 'The new old blue term.'],
    ];
    for (const [before, after] of cases) {
      const { result } = await fixture(before, after);
      expect(result.certificate.revisionGrouping.groupedChains).toBe(0);
      expect(result.certificate.revisionGrouping.coalescedSpaceTokens).toBe(0);
    }
  });

  revisionTest('[SDX-MDOC-144] incompatible run formatting and retained-format bridges stop grouping', async () => {
    const incompatible = await customRunFixture(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>old</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>red</w:t></w:r></w:p>',
      'old red',
      'new blue',
    );
    expect(incompatible.certificate.revisionGrouping.groupedChains).toBe(0);

    const retained = await customRunFixture(
      '<w:p><w:r><w:t>old</w:t></w:r><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r><w:r><w:t>red</w:t></w:r></w:p>',
      'old red',
      'new{% retain-format highlight="none" %} {% /retain-format %}blue',
    );
    expect(retained.certificate.revisionGrouping.groupedChains).toBe(0);
    expect(retained.certificate.retainedFormatting.passed).toBe(true);
  });
});
