import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { acceptAllChanges, compareDocumentsAtomizer as compareDocuments, rejectAllChanges } from '@usejunior/docx-compare';
import { parseXml } from '../primitives/xml.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Issue #456 proofErr-only paragraph matching' });

type ReconstructionMode = 'rebuild' | 'inplace';

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function emptyParagraph(): string {
  return `<w:p/>`;
}

function proofErrOnlyParagraph(): string {
  return `<w:p><w:proofErr w:type="spellStart"/><w:proofErr w:type="spellEnd"/></w:p>`;
}

async function documentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const document = zip.file('word/document.xml');
  if (!document) {
    throw new Error('word/document.xml missing from DOCX');
  }
  return document.async('string');
}

function countTag(xml: string, tagName: 'w:p' | 'w:ins' | 'w:del' | 'w:proofErr'): number {
  return (xml.match(new RegExp(`<${tagName}\\b`, 'g')) ?? []).length;
}

function documentParagraphCount(xml: string): number {
  const doc = parseXml(xml);
  return doc.getElementsByTagName('w:p').length;
}

async function compareBodyXml(
  originalBodyXml: string,
  revisedBodyXml: string,
  _reconstructionMode: ReconstructionMode,
  _comparisonStrategy?: 'tagged-tree' | 'legacy',
): Promise<{ result: Awaited<ReturnType<typeof compareDocuments>>; xml: string }> {
  const original = await buildDocxFromBodyXml(originalBodyXml);
  const revised = await buildDocxFromBodyXml(revisedBodyXml);
  const result = await compareDocuments(original, revised);
  return { result, xml: await documentXml(result.document) };
}

const proofErrFixture = paragraph('alpha') + proofErrOnlyParagraph() + paragraph('omega');
const strippedFixture = paragraph('alpha') + emptyParagraph() + paragraph('omega');
const withoutMiddleFixture = paragraph('alpha') + paragraph('omega');

describe('Issue #456 — proofErr-only paragraph atomization', () => {
  for (const mode of ['inplace'] as const) {
    test(`${mode} identity comparison preserves the proofErr-only paragraph without changes`, async ({
      given,
      when,
      then,
      and,
    }: AllureBddContext) => {
      let result: Awaited<ReturnType<typeof compareDocuments>>;
      let xml: string;

      await given('identical documents with a proofErr-only middle paragraph', async () => {});

      await when(`compared in ${mode} mode`, async () => {
        ({ result, xml } = await compareBodyXml(proofErrFixture, proofErrFixture, mode));
      });

      await then('the public result reports no semantic changes', () => {
        expect(result.stats.insertions).toBe(0);
        expect(result.stats.deletions).toBe(0);
        expect(result.stats.modifications).toBe(0);
      });

      await and('accept and reject both reproduce the identical source behavior', () => {
        for (const projected of [acceptAllChanges(xml), rejectAllChanges(xml)]) {
          expect(documentParagraphCount(projected)).toBe(3);
          expect(countTag(projected, 'w:proofErr')).toBe(2);
        }
      });
    });

    test(`${mode} comparison against a stripped counterpart does not report phantom changes`, async ({
      given,
      when,
      then,
      and,
    }: AllureBddContext) => {
      let xml: string;

      await given('a proofErr-only paragraph and the same paragraph with proofErr stripped', async () => {});

      await when(`compared in ${mode} mode`, async () => {
        ({ xml } = await compareBodyXml(proofErrFixture, strippedFixture, mode));
      });

      await then('accept reproduces the stripped revised side', () => {
        const accepted = acceptAllChanges(xml);
        expect(documentParagraphCount(accepted)).toBe(3);
        expect(countTag(accepted, 'w:proofErr')).toBe(0);
      });

      await and('reject reproduces the proofErr-bearing original side', () => {
        const rejected = rejectAllChanges(xml);
        expect(documentParagraphCount(rejected)).toBe(3);
        expect(countTag(rejected, 'w:proofErr')).toBe(2);
      });
    });

    test(`${mode} comparison reports a deleted proofErr-only paragraph`, async ({
      given,
      when,
      then,
      and,
    }: AllureBddContext) => {
      let result: Awaited<ReturnType<typeof compareDocuments>>;
      let xml: string;

      await given('an original proofErr-only paragraph removed from the revised document', async () => {});

      await when(`compared in ${mode} mode`, async () => {
        ({ result, xml } = await compareBodyXml(proofErrFixture, withoutMiddleFixture, mode));
      });

      await then('the deletion is reported through the public stats', () => {
        expect(result.stats.insertions).toBe(0);
        expect(result.stats.deletions).toBe(2);
        expect(countTag(xml, 'w:del')).toBe(2);
      });

      await and('accept and reject reproduce the revised and original sides', () => {
        const accepted = acceptAllChanges(xml);
        const rejected = rejectAllChanges(xml);
        expect(documentParagraphCount(accepted)).toBe(2);
        expect(countTag(accepted, 'w:proofErr')).toBe(0);
        expect(documentParagraphCount(rejected)).toBe(3);
        expect(countTag(rejected, 'w:proofErr')).toBe(2);
      });
    });

    test(`${mode} comparison reports an inserted proofErr-only paragraph`, async ({
      given,
      when,
      then,
      and,
    }: AllureBddContext) => {
      let result: Awaited<ReturnType<typeof compareDocuments>>;
      let xml: string;

      await given('a revised proofErr-only paragraph inserted between unchanged paragraphs', async () => {});

      await when(`compared in ${mode} mode`, async () => {
        ({ result, xml } = await compareBodyXml(withoutMiddleFixture, proofErrFixture, mode));
      });

      await then('the insertion is reported through the public stats', () => {
        expect(result.stats.insertions).toBe(2);
        expect(result.stats.deletions).toBe(0);
        expect(countTag(xml, 'w:ins')).toBe(2);
      });

      await and('accept and reject reproduce the revised and original sides', () => {
        const accepted = acceptAllChanges(xml);
        const rejected = rejectAllChanges(xml);
        expect(documentParagraphCount(accepted)).toBe(3);
        expect(countTag(accepted, 'w:proofErr')).toBe(2);
        expect(documentParagraphCount(rejected)).toBe(2);
        expect(countTag(rejected, 'w:proofErr')).toBe(0);
      });
    });
  }
});

describe('Issue #456 — tagged default source projections', () => {
  test('proofErr-only identity/add/remove cases project exactly to their source sides', async () => {
    const cases = [
      { original: proofErrFixture, revised: proofErrFixture, acceptParagraphs: 3, acceptProof: 2, rejectParagraphs: 3, rejectProof: 2 },
      { original: proofErrFixture, revised: strippedFixture, acceptParagraphs: 3, acceptProof: 0, rejectParagraphs: 3, rejectProof: 2 },
      { original: proofErrFixture, revised: withoutMiddleFixture, acceptParagraphs: 2, acceptProof: 0, rejectParagraphs: 3, rejectProof: 2 },
      { original: withoutMiddleFixture, revised: proofErrFixture, acceptParagraphs: 3, acceptProof: 2, rejectParagraphs: 2, rejectProof: 0 },
    ];
    for (const fixture of cases) {
      const { xml } = await compareBodyXml(fixture.original, fixture.revised, 'inplace', 'tagged-tree');
      const accepted = acceptAllChanges(xml);
      const rejected = rejectAllChanges(xml);
      expect(documentParagraphCount(accepted)).toBe(fixture.acceptParagraphs);
      expect(countTag(accepted, 'w:proofErr')).toBe(fixture.acceptProof);
      expect(documentParagraphCount(rejected)).toBe(fixture.rejectParagraphs);
      expect(countTag(rejected, 'w:proofErr')).toBe(fixture.rejectProof);
    }
  });
});
