import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';
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
  reconstructionMode: ReconstructionMode
): Promise<{ result: Awaited<ReturnType<typeof compareDocuments>>; xml: string }> {
  const original = await buildDocxFromBodyXml(originalBodyXml);
  const revised = await buildDocxFromBodyXml(revisedBodyXml);
  const result = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode,
  });
  return { result, xml: await documentXml(result.document) };
}

const proofErrFixture = paragraph('alpha') + proofErrOnlyParagraph() + paragraph('omega');
const strippedFixture = paragraph('alpha') + emptyParagraph() + paragraph('omega');
const withoutMiddleFixture = paragraph('alpha') + paragraph('omega');

describe('Issue #456 — proofErr-only paragraph atomization', () => {
  for (const mode of ['rebuild', 'inplace'] as const) {
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

      await then('no tracked changes are emitted', () => {
        expect(countTag(xml, 'w:ins')).toBe(0);
        expect(countTag(xml, 'w:del')).toBe(0);
        expect(result.stats.insertions).toBe(0);
        expect(result.stats.deletions).toBe(0);
        expect(result.stats.modifications).toBe(0);
      });

      await and('the empty middle paragraph remains present', () => {
        expect(documentParagraphCount(xml)).toBe(3);
        expect(countTag(xml, 'w:p')).toBe(3);
        expect(countTag(xml, 'w:proofErr')).toBe(mode === 'inplace' ? 2 : 0);
      });
    });

    test(`${mode} comparison against a stripped counterpart does not report phantom changes`, async ({
      given,
      when,
      then,
      and,
    }: AllureBddContext) => {
      let result: Awaited<ReturnType<typeof compareDocuments>>;
      let xml: string;

      await given('a proofErr-only paragraph and the same paragraph with proofErr stripped', async () => {});

      await when(`compared in ${mode} mode`, async () => {
        ({ result, xml } = await compareBodyXml(proofErrFixture, strippedFixture, mode));
      });

      await then('no tracked changes are emitted', () => {
        expect(countTag(xml, 'w:ins')).toBe(0);
        expect(countTag(xml, 'w:del')).toBe(0);
        expect(result.stats.insertions).toBe(0);
        expect(result.stats.deletions).toBe(0);
        expect(result.stats.modifications).toBe(0);
      });

      await and('the middle paragraph remains present', () => {
        expect(documentParagraphCount(xml)).toBe(3);
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

      await then('one paragraph-mark deletion is emitted', () => {
        expect(countTag(xml, 'w:ins')).toBe(0);
        expect(countTag(xml, 'w:del')).toBe(1);
        expect(result.stats.insertions).toBe(0);
        expect(result.stats.deletions).toBe(1);
      });

      await and('the deleted paragraph remains in the output with mode-specific proofErr retention', () => {
        expect(documentParagraphCount(xml)).toBe(3);
        expect(countTag(xml, 'w:proofErr')).toBe(mode === 'inplace' ? 2 : 0);
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

      await then('one paragraph-mark insertion is emitted', () => {
        expect(countTag(xml, 'w:ins')).toBe(1);
        expect(countTag(xml, 'w:del')).toBe(0);
        expect(result.stats.insertions).toBe(1);
        expect(result.stats.deletions).toBe(0);
      });

      await and('the inserted paragraph remains in the output with mode-specific proofErr retention', () => {
        expect(documentParagraphCount(xml)).toBe(3);
        expect(countTag(xml, 'w:proofErr')).toBe(mode === 'inplace' ? 2 : 0);
      });
    });
  }
});
