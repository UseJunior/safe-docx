import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { buildTaggedTreeShadowXml } from '../tagged/taggedTreeShadow.js';
import { compareSourceProjectedFormattingFidelity } from '../tagged/formattingFidelity.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const ORIGINAL = resolve(ROOT, 'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx');
const REVISED = resolve(ROOT, 'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx');

describe('public ILPA tagged-tree redline minimality', () => {
  const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Tagged-tree corpus minimality' });
  test('preserves the four reported common-text anchors and exact source projections', async () => {
    const [original, revised] = await Promise.all([readFile(ORIGINAL), readFile(REVISED)]);
    const originalXml = await (await DocxArchive.load(original)).getDocumentXml();
    const revisedXml = await (await DocxArchive.load(revised)).getDocumentXml();
    const taggedXml = buildTaggedTreeShadowXml({
      originalXml,
      revisedXml,
      author: 'Corpus minimality',
      date: new Date('2026-08-14T12:00:00Z'),
      detectFormatChanges: true,
      detectMoves: true,
    });
    const fidelity = compareSourceProjectedFormattingFidelity(originalXml, revisedXml, taggedXml);
    expect(fidelity.accept.score).toBe(1);
    expect(fidelity.reject.score).toBe(1);

    const document = parseXml(taggedXml);
    const paragraphs = Array.from(document.getElementsByTagName('w:p'));
    const revisionText = (paragraph: Element, kind: 'ins' | 'del'): string =>
      Array.from(paragraph.getElementsByTagName(`w:${kind}`)).map((node) => node.textContent ?? '').join('');
    const liveText = (paragraph: Element): string => Array.from(paragraph.getElementsByTagName('w:t'))
      .filter((node) => !['ins', 'del'].includes((node.parentNode?.parentNode as Element | null)?.localName ?? ''))
      .map((node) => node.textContent ?? '').join('');

    const headings = paragraphs.filter((paragraph) =>
      (paragraph.textContent ?? '').toUpperCase().includes('DEFINITIONS AND INTERPRETATION'));
    expect(headings.length).toBeGreaterThanOrEqual(2);
    for (const heading of headings) {
      expect(revisionText(heading, 'ins').trim().toUpperCase()).not.toBe('DEFINITIONS AND INTERPRETATION');
      expect(revisionText(heading, 'del').trim().toUpperCase()).not.toBe('DEFINITIONS AND INTERPRETATION');
      const inserted = revisionText(heading, 'ins').trim().toUpperCase();
      const deleted = revisionText(heading, 'del').trim().toUpperCase();
      if (inserted || deleted) expect(inserted).not.toBe(deleted);
    }
    const recital = paragraphs.find((paragraph) => (paragraph.textContent ?? '').includes('WHEREAS, the Fund was formed'))!;
    expect(liveText(recital)).toContain('Agreement of Limited');
    expect(revisionText(recital, 'ins')).not.toContain('Agreement of Limited');
    expect(revisionText(recital, 'del')).not.toContain('Agreement of Limited');
    const party = paragraphs.find((paragraph) => (paragraph.textContent ?? '').includes('such party to the Fund;'))!;
    expect(liveText(party)).toContain('such party to the Fund;');
    expect(revisionText(party, 'ins')).not.toContain('such party to the Fund;');
    expect(revisionText(party, 'del')).not.toContain('such party to the Fund;');
  // V8 coverage instrumentation can push this real ILPA comparison past three
  // minutes on CI while the uninstrumented suite remains substantially faster.
  }, 300_000);
});
