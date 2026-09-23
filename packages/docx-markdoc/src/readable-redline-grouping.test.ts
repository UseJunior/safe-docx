import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { buildSyntheticDocx, parseXml } from '@usejunior/docx-core';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { buildDocxFromBodyXml } from '../../docx-core/src/testing/ooxml-fixtures.js';
import { compileMarkdoc } from './compile.js';
import { importDocxToMarkdoc } from './import.js';
import { requireMarkdoc } from './markdoc.js';

const TEST_FEATURE = 'Readable redline coalescing';
const revisionTest = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 998 readability-aware revision grouping',
  severity: 'critical',
})
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' });

async function fixture(
  policy?: 'token-minimal' | 'readable-whitespace',
  markdocPolicy?: 'token-minimal' | 'readable-whitespace',
  before = 'The old red term applies.',
  after = 'The new blue term applies.',
) {
  const source = await buildSyntheticDocx({ paragraphs: [before] });
  const imported = await importDocxToMarkdoc(source);
  const paragraph = requireMarkdoc(imported.markdoc).scaffold[0]!;
  const change = [
    `{% change id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" operation="rewrite" format="inherit-source-paragraph" %}`,
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
  const result = await compileMarkdoc(imported.anchoredSource, markdoc,
    policy ? { revisionGrouping: { policy } } : {});
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
  return compileMarkdoc(imported.anchoredSource, markdoc, {
    revisionGrouping: { policy: 'readable-whitespace' },
  });
}

describe('readable redline grouping', () => {
  revisionTest('[SDX-MDOC-139][SDX-MDOC-143] token-minimal remains the default', async () => {
    const { result, xml } = await fixture();
    expect(result.certificate.revisionGrouping).toEqual({
      policy: 'token-minimal', source: 'default', coalescedSpaceTokens: 0, groupedChains: 0,
    });
    expect(xml.match(/<w:del\b/gu)?.length).toBe(2);
    expect(xml.match(/<w:ins\b/gu)?.length).toBe(2);
  });

  revisionTest('[SDX-MDOC-141][SDX-MDOC-142] readable mode emits one phrase-level replacement pair', async () => {
    const { result, xml } = await fixture('readable-whitespace');
    expect(result.certificate.passed).toBe(true);
    expect(result.certificate.revisionGrouping).toEqual({
      policy: 'readable-whitespace', source: 'api', coalescedSpaceTokens: 1, groupedChains: 1,
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
    const { result } = await fixture('readable-whitespace', undefined, 'old red', 'new blue');
    expect(result.certificate.revisionGrouping).toMatchObject({ groupedChains: 1, coalescedSpaceTokens: 1 });
  });

  revisionTest('[SDX-MDOC-140][SDX-MDOC-141] runtime policy overrides declarative policy with provenance', async () => {
    const declarative = await fixture(undefined, 'readable-whitespace');
    expect(declarative.result.certificate.revisionGrouping.source).toBe('markdoc');
    expect(declarative.result.certificate.revisionGrouping.groupedChains).toBe(1);
    const overridden = await fixture('token-minimal', 'readable-whitespace');
    expect(overridden.result.certificate.revisionGrouping).toEqual({
      policy: 'token-minimal', source: 'api', coalescedSpaceTokens: 0, groupedChains: 0,
    });
  });

  revisionTest('[SDX-MDOC-146] does not attribute preserved pre-existing grouping to this build', async () => {
    const source = await buildDocxFromBodyXml(
      '<w:p><w:r><w:t xml:space="preserve">Keep </w:t></w:r>'
      + '<w:del w:id="1" w:author="Prior" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>aa bb</w:delText></w:r></w:del>'
      + '<w:ins w:id="2" w:author="Prior" w:date="2026-01-01T00:00:00Z"><w:r><w:t>cc dd</w:t></w:r></w:ins></w:p>',
    );
    const imported = await importDocxToMarkdoc(source);

    for (const policy of ['token-minimal', 'readable-whitespace'] as const) {
      const result = await compileMarkdoc(imported.anchoredSource, imported.markdoc, {
        revisionGrouping: { policy },
      });
      expect(result.certificate.revisionGrouping).toEqual({
        policy, source: 'api', coalescedSpaceTokens: 0, groupedChains: 0,
      });
      expect(result.certificate.existingRevisionsPreserved).toBe(true);
    }
  });

  revisionTest('[SDX-MDOC-141] rejects an invalid runtime policy before comparison', async () => {
    await expect(fixture('coarse' as 'token-minimal')).rejects.toThrow(/token-minimal or readable-whitespace/u);
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
      const { result } = await fixture('readable-whitespace', undefined, before, after);
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
