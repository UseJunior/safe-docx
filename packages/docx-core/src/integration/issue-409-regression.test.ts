import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocuments } from '@usejunior/docx-compare';
import { parseXml } from '../primitives/xml.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Issue #409 Empty Paragraph Matching' });

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function splitRunParagraph(): string {
  return (
    `<w:p>` +
    `<w:r><w:t>of </w:t></w:r>` +
    `<w:r><w:t>Disclosure.</w:t></w:r>` +
    `</w:p>`
  );
}

function mergedRunParagraph(): string {
  return paragraph('of Disclosure.');
}

function emptyParagraph(): string {
  return `<w:p/>`;
}

async function documentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const document = zip.file('word/document.xml');
  if (!document) {
    throw new Error('word/document.xml missing from DOCX');
  }
  return document.async('string');
}

function countTag(xml: string, tagName: 'w:ins' | 'w:del'): number {
  return (xml.match(new RegExp(`<${tagName}\\b`, 'g')) ?? []).length;
}

function paragraphHasRevision(paragraphElement: Element): boolean {
  return (
    paragraphElement.getElementsByTagName('w:ins').length > 0 ||
    paragraphElement.getElementsByTagName('w:del').length > 0
  );
}

function paragraphVisibleText(paragraphElement: Element): string {
  const pieces: string[] = [];
  for (const tagName of ['w:t', 'w:delText']) {
    const nodes = paragraphElement.getElementsByTagName(tagName);
    for (let i = 0; i < nodes.length; i++) {
      pieces.push(nodes[i]?.textContent ?? '');
    }
  }
  return pieces.join('');
}

function emptyParagraphRevisionCount(xml: string): number {
  const doc = parseXml(xml);
  const paragraphs = doc.getElementsByTagName('w:p');
  let count = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i] as Element;
    if (paragraphHasRevision(p) && paragraphVisibleText(p) === '') {
      count++;
    }
  }
  return count;
}

describe('Issue #409 — empty paragraph atom context', () => {
  test('run-boundary churn near real edits does not emit empty-paragraph delete/insert pairs', async ({ given, when, then, and }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocuments>>;
    let xml: string;

    await given('a document where neighboring paragraph text is preserved but run boundaries change', async () => {
      original = await buildDocxFromBodyXml(
        splitRunParagraph() +
          emptyParagraph() +
          paragraph('alpha beta gamma') +
          emptyParagraph() +
          paragraph('tail omega'),
      );
      revised = await buildDocxFromBodyXml(
        mergedRunParagraph() +
          emptyParagraph() +
          paragraph('alpha beta gamma') +
          emptyParagraph() +
          paragraph('tail theta'),
      );
    });

    await when('comparing in atomizer rebuild mode', async () => {
      result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'rebuild',
      });
      xml = await documentXml(result.document);
    });

    await then('only the real text edit is emitted as a tracked change', () => {
      expect(result.stats.insertions).toBe(1);
      expect(result.stats.deletions).toBe(1);
    });

    await and('no tracked revision region is attached to an empty paragraph', () => {
      expect(emptyParagraphRevisionCount(xml)).toBe(0);
    });
  });

  test('a newly inserted empty paragraph does not churn later identical empty paragraphs', async ({ given, when, then }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocuments>>;
    let xml: string;

    await given('a revised document with one genuine new empty paragraph before later unchanged content', async () => {
      original = await buildDocxFromBodyXml(
        paragraph('one') + paragraph('two') + emptyParagraph() + paragraph('tail'),
      );
      revised = await buildDocxFromBodyXml(
        paragraph('one') + emptyParagraph() + paragraph('two') + emptyParagraph() + paragraph('tail'),
      );
    });

    await when('comparing in atomizer rebuild mode', async () => {
      result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'rebuild',
      });
      xml = await documentXml(result.document);
    });

    await then('only one insertion region is emitted', () => {
      expect(countTag(xml, 'w:ins')).toBe(1);
      expect(countTag(xml, 'w:del')).toBe(0);
      expect(result.stats.insertions).toBe(1);
      expect(result.stats.deletions).toBe(0);
    });
  });

  test('identical documents with empty paragraphs stay revision-free', async ({ given, when, then }: AllureBddContext) => {
    let doc: Buffer;
    let result: Awaited<ReturnType<typeof compareDocuments>>;
    let xml: string;

    await given('identical documents containing empty paragraphs', async () => {
      doc = await buildDocxFromBodyXml(
        mergedRunParagraph() + emptyParagraph() + paragraph('alpha beta gamma') + emptyParagraph(),
      );
    });

    await when('comparing in atomizer rebuild mode', async () => {
      result = await compareDocuments(doc, doc, {
        engine: 'atomizer',
        reconstructionMode: 'rebuild',
      });
      xml = await documentXml(result.document);
    });

    await then('no tracked changes are emitted', () => {
      expect(countTag(xml, 'w:ins')).toBe(0);
      expect(countTag(xml, 'w:del')).toBe(0);
      expect(result.stats.insertions).toBe(0);
      expect(result.stats.deletions).toBe(0);
      expect(result.stats.modifications).toBe(0);
    });
  });
});
