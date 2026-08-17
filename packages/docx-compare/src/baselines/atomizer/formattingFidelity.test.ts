/**
 * Traceability tests for the formatting-fidelity comparison check.
 *
 * The check is the formatting oracle the rebuild-elimination campaign needs:
 * both existing oracles (round-trip text projections, LibreOffice
 * paragraphShape) are formatting-blind, so rebuild's formatting loss passes
 * every prior gate silently.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/363
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { DocxArchive } from '@usejunior/docx-core';
import { compareDocumentsAtomizer } from './pipeline.js';
import {
  compareFormattingFidelity,
  compareProjectedFormattingFidelity,
  compareSourceProjectedFormattingFidelity,
} from './formattingFidelity.js';

const TEST_FEATURE = 'add-formatting-fidelity-comparison-check';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const humanReadableTest = test.allure({
  tags: ['human-readable'],
  parameters: { audience: 'developers' },
});

function docXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${bodyXml}</w:body></w:document>`
  );
}

describe('Formatting-fidelity comparison check', () => {
  humanReadableTest.openspec('format-neutral empty body placeholders preserve fidelity')(
    'Scenario: a format-neutral empty body placeholder scores perfect fidelity',
    (_: AllureBddContext) => {
      const withoutParagraph = docXml('<w:sectPr/>');
      const withPlaceholder = docXml('<w:p/><w:sectPr/>');

      const report = compareFormattingFidelity(withoutParagraph, withPlaceholder);

      expect(report.score).toBe(1);
      expect(report.unalignedExpectedParagraphs).toBe(0);
      expect(report.unalignedActualParagraphs).toBe(0);
      expect(report.divergences).toEqual([]);
    },
  );

  humanReadableTest.openspec('identical document views score perfect formatting fidelity')(
    'Scenario: identical document views score perfect formatting fidelity',
    (_: AllureBddContext) => {
      const view = docXml(
        `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
          `<w:r><w:rPr><w:b/></w:rPr><w:t>Bold heading</w:t></w:r></w:p>` +
          `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>` +
          `<w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="DDDDDD"/></w:tcPr>` +
          `<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
          `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>`,
      );

      const report = compareFormattingFidelity(view, view);

      expect(report.score).toBe(1);
      expect(report.divergences).toEqual([]);
      expect(report.unalignedExpectedParagraphs).toBe(0);
      expect(report.unalignedActualParagraphs).toBe(0);
    },
  );

  humanReadableTest.openspec('dropped run bold is reported as a char-weighted run divergence')(
    'Scenario: dropped run bold is reported as a char-weighted run divergence',
    (_: AllureBddContext) => {
      const expected = docXml(
        `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold text</w:t></w:r>` +
          `<w:r><w:t> stays plain</w:t></w:r></w:p>`,
      );
      const actual = docXml(
        `<w:p><w:r><w:t>Bold text</w:t></w:r><w:r><w:t> stays plain</w:t></w:r></w:p>`,
      );

      const report = compareFormattingFidelity(expected, actual);

      expect(report.score).toBeLessThan(1);
      expect(report.runFormatting.divergent).toBe('Bold text'.length);
      expect(report.runFormatting.compared).toBe('Bold text stays plain'.length);
      const bold = report.divergences.find((d) => d.property === 'bold');
      expect(bold).toMatchObject({
        scope: 'run',
        kind: 'removed',
        paragraphIndex: 0,
        textSample: 'Bold text',
      });
    },
  );

  humanReadableTest.openspec('differing run splits with identical formatting do not reduce fidelity')(
    'Scenario: differing run splits with identical formatting do not reduce fidelity',
    (_: AllureBddContext) => {
      const expected = docXml(
        `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Hello world</w:t></w:r></w:p>`,
      );
      // Same text and formatting, split into three runs (what rebuild vs
      // inplace legitimately produce differently).
      const actual = docXml(
        `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Hel</w:t></w:r>` +
          `<w:r><w:rPr><w:i/></w:rPr><w:t>lo wo</w:t></w:r>` +
          `<w:r><w:rPr><w:i/></w:rPr><w:t>rld</w:t></w:r></w:p>`,
      );

      const report = compareFormattingFidelity(expected, actual);

      expect(report.score).toBe(1);
      expect(report.divergences).toEqual([]);
    },
  );

  humanReadableTest.openspec('dropped paragraph alignment is reported as a paragraph divergence')(
    'Scenario: dropped paragraph alignment is reported as a paragraph divergence',
    (_: AllureBddContext) => {
      const expected = docXml(
        `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Centered</w:t></w:r></w:p>`,
      );
      const actual = docXml(`<w:p><w:r><w:t>Centered</w:t></w:r></w:p>`);

      const report = compareFormattingFidelity(expected, actual);

      expect(report.paragraphFormatting.divergent).toBe(1);
      const alignment = report.divergences.find((d) => d.property === 'alignment');
      expect(alignment).toMatchObject({ scope: 'paragraph', kind: 'removed', paragraphIndex: 0 });
      expect(report.score).toBeLessThan(1);
    },
  );

  humanReadableTest.openspec('dropped table cell shading is reported as a table divergence')(
    'Scenario: dropped table cell shading is reported as a table divergence',
    (_: AllureBddContext) => {
      const table = (tcPr: string): string =>
        `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>` +
        `<w:tr><w:tc>${tcPr}<w:p><w:r><w:t>cell text</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
      const expected = docXml(table(`<w:tcPr><w:shd w:val="clear" w:fill="FF0000"/></w:tcPr>`));
      const actual = docXml(table(''));

      const report = compareFormattingFidelity(expected, actual);

      expect(report.tableFormatting.compared).toBe(1);
      expect(report.tableFormatting.divergent).toBe(1);
      const shading = report.divergences.find((d) => d.scope === 'table');
      expect(shading).toMatchObject({ property: 'w:shd', kind: 'removed', textSample: 'cell text' });
      expect(report.score).toBeLessThan(1);
    },
  );

  humanReadableTest.openspec('changed page size is reported as a section divergence')(
    'Scenario: changed page size is reported as a section divergence',
    (_: AllureBddContext) => {
      const body = (pgSz: string): string =>
        `<w:p><w:r><w:t>content</w:t></w:r></w:p><w:sectPr>${pgSz}</w:sectPr>`;
      const expected = docXml(body(`<w:pgSz w:w="11906" w:h="16838"/>`));
      const actual = docXml(body(`<w:pgSz w:w="12240" w:h="15840"/>`));

      const report = compareFormattingFidelity(expected, actual);

      expect(report.sectionFormatting.divergent).toBe(1);
      const pgSz = report.divergences.find((d) => d.scope === 'section');
      expect(pgSz).toMatchObject({ property: 'w:pgSz', kind: 'changed', paragraphIndex: -1 });
      expect(report.score).toBeLessThan(1);
    },
  );

  humanReadableTest.openspec('namespace declaration placement does not register as formatting divergence')(
    'Scenario: namespace declaration placement does not register as formatting divergence',
    (_: AllureBddContext) => {
      const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      // inplace-style: r: bound once on the root, inherited by w:headerReference.
      const expected =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
        ` xmlns:r="${R_NS}"><w:body>` +
        `<w:p><w:r><w:t>content</w:t></w:r></w:p>` +
        `<w:sectPr><w:headerReference r:id="rId8" w:type="default"/></w:sectPr>` +
        `</w:body></w:document>`;
      // rebuild-style: the same binding declared inline on the element itself,
      // with an identical r:id (the false "changed" divergence from #369).
      const actual = docXml(
        `<w:p><w:r><w:t>content</w:t></w:r></w:p>` +
          `<w:sectPr><w:headerReference r:id="rId8" w:type="default" xmlns:r="${R_NS}"/></w:sectPr>`,
      );

      const report = compareFormattingFidelity(expected, actual);

      expect(report.sectionFormatting.divergent).toBe(0);
      expect(report.divergences).toEqual([]);
      expect(report.score).toBe(1);
    },
  );

  humanReadableTest.openspec('unaligned paragraph content lowers alignment coverage not formatting tallies')(
    'Scenario: unaligned paragraph content lowers alignment coverage not formatting tallies',
    (_: AllureBddContext) => {
      const expected = docXml(
        `<w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Beta</w:t></w:r></w:p>`,
      );
      const actual = docXml(
        `<w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Gamma</w:t></w:r></w:p>`,
      );

      const report = compareFormattingFidelity(expected, actual);

      expect(report.unalignedExpectedParagraphs).toBe(1);
      expect(report.unalignedActualParagraphs).toBe(1);
      // Only the aligned "Alpha" paragraph enters the formatting tallies …
      expect(report.paragraphFormatting.compared).toBe(1);
      expect(report.paragraphFormatting.divergent).toBe(0);
      expect(report.runFormatting.compared).toBe('Alpha'.length);
      expect(report.divergences).toEqual([]);
      // … while the content mismatch degrades the score through coverage.
      expect(report.score).toBeCloseTo(0.5, 5);
    },
  );

  humanReadableTest.openspec('projected fidelity ignores revision markup granularity differences')(
    'Scenario: projected fidelity ignores revision markup granularity differences',
    (_: AllureBddContext) => {
      // The same tracked insertion, encoded as one w:ins wrapper …
      const coarse = docXml(
        `<w:p><w:r><w:t>Existing </w:t></w:r>` +
          `<w:ins w:id="1" w:author="A" w:date="2026-06-01T00:00:00Z">` +
          `<w:r><w:rPr><w:b/></w:rPr><w:t>new bold</w:t></w:r></w:ins></w:p>`,
      );
      // … and as two w:ins wrappers with split runs.
      const fine = docXml(
        `<w:p><w:r><w:t>Existing </w:t></w:r>` +
          `<w:ins w:id="2" w:author="A" w:date="2026-06-01T00:00:00Z">` +
          `<w:r><w:rPr><w:b/></w:rPr><w:t>new </w:t></w:r></w:ins>` +
          `<w:ins w:id="3" w:author="A" w:date="2026-06-01T00:00:00Z">` +
          `<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:ins></w:p>`,
      );

      const result = compareProjectedFormattingFidelity(coarse, fine);

      expect(result.accept.divergences).toEqual([]);
      expect(result.reject.divergences).toEqual([]);
      expect(result.score).toBe(1);
    },
  );

  test('source-projected fidelity treats the two source sides as authoritative', () => {
    const original = docXml('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>old</w:t></w:r></w:p>');
    const revised = docXml('<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>new</w:t></w:r></w:p>');
    const candidate = docXml(
      '<w:p><w:pPr><w:jc w:val="right"/><w:pPrChange w:id="1"><w:pPr><w:jc w:val="center"/></w:pPr></w:pPrChange></w:pPr>' +
      '<w:del w:id="2"><w:r><w:rPr><w:b/></w:rPr><w:delText>old</w:delText></w:r></w:del>' +
      '<w:ins w:id="3"><w:r><w:rPr><w:i/></w:rPr><w:t>new</w:t></w:r></w:ins></w:p>',
    );

    const result = compareSourceProjectedFormattingFidelity(original, revised, candidate);
    expect(result.accept.score).toBe(1);
    expect(result.reject.score).toBe(1);
    expect(result.score).toBe(1);
  });

  humanReadableTest.openspec('pipeline inplace and rebuild candidates are measurable end-to-end')(
    'Scenario: pipeline inplace and rebuild candidates are measurable end-to-end',
    async (_: AllureBddContext) => {
      const original = await buildDocxFromBodyXml(
        `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
          `<w:r><w:rPr><w:b/></w:rPr><w:t>Heading stays put</w:t></w:r></w:p>` +
          `<w:p><w:r><w:t>The quick brown fox.</w:t></w:r></w:p>`,
      );
      const revised = await buildDocxFromBodyXml(
        `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
          `<w:r><w:rPr><w:b/></w:rPr><w:t>Heading stays put</w:t></w:r></w:p>` +
          `<w:p><w:r><w:t>The quick red fox.</w:t></w:r></w:p>`,
      );

      const options = { author: 'Fidelity Test', date: new Date('2026-06-01T00:00:00Z') };
      const inplace = await compareDocumentsAtomizer(original, revised, {
        ...options,
        reconstructionMode: 'inplace',
      });
      const rebuild = await compareDocumentsAtomizer(original, revised, {
        ...options,
        reconstructionMode: 'rebuild',
      });
      const inplaceXml = await (await DocxArchive.load(inplace.document)).getDocumentXml();
      const rebuildXml = await (await DocxArchive.load(rebuild.document)).getDocumentXml();

      const result = compareProjectedFormattingFidelity(inplaceXml, rebuildXml);

      for (const report of [result.accept, result.reject]) {
        expect(report.score).toBeGreaterThanOrEqual(0);
        expect(report.score).toBeLessThanOrEqual(1);
        expect(report.runFormatting.compared).toBeGreaterThan(0);
        expect(report.paragraphFormatting.compared).toBeGreaterThan(0);
      }
      expect(result.score).toBe(Math.min(result.accept.score, result.reject.score));
    },
  );
});
