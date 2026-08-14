import { describe, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { runTaggedTreeShadow } from './taggedTreeShadow.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { DocxArchive } from '@usejunior/docx-core';

const TEST_FEATURE = 'refactor-tagged-tree-redline-construction';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = (value: string) =>
  `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:body></w:document>`;

describe('tagged-tree offline evaluation', () => {
  test('reports without mutating caller-owned legacy output',
    async ({ given, when, then, and }: AllureBddContext) => {
      const legacy = xml('legacy bytes remain caller-owned');
      let report!: ReturnType<typeof runTaggedTreeShadow>;
      await given('an explicit offline evaluation and a legacy candidate', () => undefined);
      await when('the tagged tree is constructed and serialized beside it', () => {
        report = runTaggedTreeShadow({
          originalXml: xml('old'), revisedXml: xml('new'), legacyXml: legacy,
          author: 'Comparator', date: new Date('2026-08-14T12:00:00Z'), fixtureIdentity: 'unit-replacement',
        });
      });
      await then('the report records that the legacy output remains authoritative', () => {
        expect(report.legacyOutputUnchanged).toBe(true);
        expect(legacy).toBe(xml('legacy bytes remain caller-owned'));
      });
      await and('source projections are equivalent even if formatting differs from the legacy candidate', () => {
        expect(report.divergingProjections).not.toContain('accept');
        expect(report.divergingProjections).not.toContain('reject');
      });
    },
  );

  test.openspec('Tagged-tree is default with legacy rollback')(
    'uses tagged publication by default while retaining explicit legacy rollback',
    async ({ given, when, then, and }: AllureBddContext) => {
      let pipelineSource = '';
      await given('the ordinary comparison pipeline source', () => undefined);
      await when('its runtime dependencies are inspected', () => {
        pipelineSource = readFileSync(new URL('./pipeline.ts', import.meta.url), 'utf8');
      });
      await then('the tagged-tree builder is the ordinary default', () => {
        expect(pipelineSource).toContain("comparisonStrategy = 'tagged-tree'");
        expect(pipelineSource).toContain("comparisonStrategy === 'tagged-tree'");
        expect(pipelineSource).not.toContain('runTaggedTreeShadow');
        expect(pipelineSource).not.toContain('SAFE_DOCX_TAGGED_TREE');
      });
      await and('the legacy rollback and runtime checks remain in the pipeline', () => {
        expect(pipelineSource).toContain("'tagged-tree' | 'legacy'");
        expect(pipelineSource).toContain('evaluateRoundTripSafety');
      });
    },
  );

  test.openspec('Divergence is recorded with fixture identity')(
    'uses a stable opaque hash when no corpus identity is supplied',
    async ({ when, then, and }: AllureBddContext) => {
      const input = {
        originalXml: xml('A'), revisedXml: xml('B'), legacyXml: xml('B'),
        author: 'Comparator', date: new Date('2026-08-14T12:00:00Z'),
      };
      const first = runTaggedTreeShadow(input);
      const second = runTaggedTreeShadow(input);
      await when('the same fixture pair is evaluated twice', () => undefined);
      await then('the report carries the same opaque identity', () => {
        expect(first.fixtureIdentity).toMatch(/^[0-9a-f]{24}$/);
        expect(second.fixtureIdentity).toBe(first.fixtureIdentity);
      });
      await and('the divergence classification and projection names are machine readable', () => {
        expect(['projection-equivalent', 'projection-inequivalent']).toContain(first.classification);
        expect(first.divergingProjections.every((value) => ['accept', 'reject', 'formatting'].includes(value))).toBe(true);
      });
    },
  );

  test('proves direct paragraph and run formatting against source projections', async () => {
    const originalBody = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>SYNTHETIC OLD</w:t></w:r></w:p>';
    const revisedBody = '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>SYNTHETIC NEW</w:t></w:r></w:p>';
    const original = await buildDocxFromBodyXml(originalBody);
    const revised = await buildDocxFromBodyXml(revisedBody);
    const legacy = await compareDocumentsAtomizer(original, revised, {
      author: 'Safe DOCX Synthetic Test', date: new Date('2026-08-14T12:00:00Z'),
    });
    const legacyXml = await (await DocxArchive.load(legacy.document)).getDocumentXml();
    const report = runTaggedTreeShadow({
      originalXml: xml('SYNTHETIC OLD').replace('<w:p>', '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>').replace('<w:r>', '<w:r><w:rPr><w:b/></w:rPr>'),
      revisedXml: xml('SYNTHETIC NEW').replace('<w:p>', '<w:p><w:pPr><w:jc w:val="right"/></w:pPr>').replace('<w:r>', '<w:r><w:rPr><w:i/></w:rPr>'),
      legacyXml,
      author: 'Safe DOCX Synthetic Test', date: new Date('2026-08-14T12:00:00Z'),
      fixtureIdentity: 'synthetic-paragraph-formatting-divergence',
    });

    expect(report.divergingProjections).not.toContain('accept');
    expect(report.divergingProjections).not.toContain('reject');
    expect(report.divergingProjections).not.toContain('formatting');
    expect(report.fidelityScore).toBe(1);
    expect(report.diagnostics).toEqual([]);
    expect(report.classification).toBe('projection-equivalent');
  });
});
