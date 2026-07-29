/**
 * Characterization tests for the inPlaceModifier atom handlers.
 *
 * The per-status handlers (handleInserted / handleDeleted / handleMovedSource /
 * handleMovedDestination / handleFormatChanged / handleEqual) and the
 * whole-paragraph marker + created-paragraph bookkeeping in inPlaceModifier.ts
 * are reachable only through the full inplace reconstruction path, not by
 * calling the handlers in isolation. These tests drive real DOCX pairs through
 * `compareDocuments({ reconstructionMode: 'inplace' })` so each handler branch
 * runs against a genuine revised tree, and assert on the tracked-changes markup
 * the handler is responsible for emitting.
 */

import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import {
  acceptAllChanges,
  compareDocuments,
  extractTextWithParagraphs,
  normalizeText,
  rejectAllChanges,
} from '../../index.js';
import { findAllByTagName, parseXml } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Inplace Modifier Handlers' });
const formatTest = test.conformance({
  spec: 'ECMA-376',
  edition: 5,
  part: 1,
  section: '17.13.5.31',
});

function para(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

async function documentXml(docx: Buffer): Promise<string> {
  const part = (await JSZip.loadAsync(docx)).file('word/document.xml');
  if (!part) throw new Error('comparison result omitted word/document.xml');
  return part.async('string');
}

function count(xml: string, tag: string): number {
  return (xml.match(new RegExp(`<${tag.replace(':', '\\:')}\\b`, 'g')) ?? []).length;
}

function owningRun(change: Element): Element | null {
  let current: Node | null = change.parentNode;
  while (current) {
    if (current.nodeType === 1 && (current as Element).tagName === 'w:r') {
      return current as Element;
    }
    current = current.parentNode;
  }
  return null;
}

type InplaceResult = Awaited<ReturnType<typeof compareDocuments>>;

async function compareFull(
  originalBody: string,
  revisedBody: string,
  reconstructionMode: 'inplace' | 'rebuild',
): Promise<{ xml: string; result: InplaceResult }> {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  const result = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode,
  });
  expect(result.reconstructionModeUsed).toBe(reconstructionMode);
  return { xml: await documentXml(result.document), result };
}

async function inplaceCompareFull(
  originalBody: string,
  revisedBody: string,
): Promise<{ xml: string; result: InplaceResult }> {
  return compareFull(originalBody, revisedBody, 'inplace');
}

async function inplaceCompare(originalBody: string, revisedBody: string): Promise<string> {
  return (await inplaceCompareFull(originalBody, revisedBody)).xml;
}

describe('inPlaceModifier handlers (inplace reconstruction path)', () => {
  test('handleInserted: a word inserted mid-paragraph is wrapped in w:ins', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml: string;

    await given('a paragraph that gains a word in the revised document', () => {});

    await when('the documents are compared in inplace mode', async () => {
      xml = await inplaceCompare(
        para('the brown fox'),
        para('the quick brown fox'),
      );
    });

    await then('the inserted word is tracked as an insertion', () => {
      expect(count(xml, 'w:ins')).toBeGreaterThanOrEqual(1);
      expect(xml).toContain('quick');
    });
  });

  test('handleDeleted: a word removed mid-paragraph is wrapped in w:del', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml: string;

    await given('a paragraph that loses a word in the revised document', () => {});

    await when('the documents are compared in inplace mode', async () => {
      xml = await inplaceCompare(
        para('the quick brown fox'),
        para('the brown fox'),
      );
    });

    await then('the deleted word is tracked as a deletion with its text preserved', () => {
      expect(count(xml, 'w:del')).toBeGreaterThanOrEqual(1);
      expect(xml).toContain('<w:delText');
      expect(xml).toContain('quick');
    });
  });

  test('handleInserted (whole paragraph): an added paragraph is fully tracked as inserted', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let xml: string;

    await given('a document that gains a whole paragraph', () => {});

    await when('the documents are compared in inplace mode', async () => {
      xml = await inplaceCompare(
        `${para('First paragraph stays')}${para('Third paragraph stays')}`,
        `${para('First paragraph stays')}${para('Second paragraph is new')}${para('Third paragraph stays')}`,
      );
    });

    await then('the new paragraph content is inserted', () => {
      expect(count(xml, 'w:ins')).toBeGreaterThanOrEqual(1);
      expect(xml).toContain('Second paragraph is new');
    });

    await and('a paragraph-mark insertion marker is emitted for reject-all idempotency', () => {
      // Whole-paragraph inserts carry a pPr-level ins marker so Reject All can
      // drop the paragraph entirely.
      expect(xml).toMatch(/<w:rPr>[\s\S]*<w:ins\b/);
    });
  });

  test('handleDeleted (whole paragraph): a removed paragraph is cloned back as deleted', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let xml: string;

    await given('a document that loses a whole paragraph', () => {});

    await when('the documents are compared in inplace mode', async () => {
      xml = await inplaceCompare(
        `${para('First paragraph stays')}${para('Second paragraph goes away')}${para('Third paragraph stays')}`,
        `${para('First paragraph stays')}${para('Third paragraph stays')}`,
      );
    });

    await then('the deleted paragraph text is cloned back as per-word delText runs', () => {
      expect(count(xml, 'w:del')).toBeGreaterThanOrEqual(1);
      expect(xml).toContain('<w:delText');
      // The cloned deletion is fragmented into per-word runs, so the words
      // appear individually rather than as one contiguous string.
      expect(xml).toContain('>Second<');
      expect(xml).toContain('>away<');
    });

    await and('a paragraph-mark deletion marker is emitted for accept-all idempotency', () => {
      // The removed paragraph carries a pPr-level w:del so Accept All collapses it.
      expect(xml).toMatch(/<w:pPr>[\s\S]*?<w:del\b/);
    });

    await and('the surviving paragraphs are still present', () => {
      expect(xml).toContain('First paragraph stays');
      expect(xml).toContain('Third paragraph stays');
    });
  });

  test('handleFormatChanged: a run that only changes formatting is counted as a format revision', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let xml: string;
    let result: InplaceResult;

    await given('a run whose text is unchanged but gains bold formatting', () => {});

    await when('the documents are compared in inplace mode', async () => {
      ({ xml, result } = await inplaceCompareFull(
        '<w:p><w:r><w:t>Formatting target text</w:t></w:r></w:p>',
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Formatting target text</w:t></w:r></w:p>',
      ));
    });

    await then('the format change is detected and counted as a formatting revision', () => {
      expect(result.stats.formatChanges).toBeGreaterThanOrEqual(1);
    });

    await and('the revised bold formatting is applied to the run without deleting the text', () => {
      expect(xml).toContain('<w:b/>');
      expect(normalizeText(extractTextWithParagraphs(xml))).toBe('Formatting target text');
      expect(count(xml, 'w:delText')).toBe(0);
    });
  });

  formatTest(
    'one-word edits do not emit run-property revisions on whitespace-only runs',
    async ({ given, when, then, and }: AllureBddContext) => {
      let comparisons: Array<{ xml: string; result: InplaceResult }>;
      const original =
        '<w:p><w:r><w:t>Alpha</w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve"> old </w:t></w:r><w:r><w:t>Beta</w:t></w:r></w:p>';
      const revised =
        '<w:p><w:r><w:t xml:space="preserve">Alpha </w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>new</w:t></w:r><w:r><w:t xml:space="preserve"> Beta</w:t></w:r></w:p>';

      await given(
        'a one-word replacement whose equivalent underline boundaries place adjacent spaces in different runs',
        () => {},
      );

      await when('the documents are compared in both reconstruction modes', async () => {
        comparisons = await Promise.all([
          compareFull(original, revised, 'inplace'),
          compareFull(original, revised, 'rebuild'),
        ]);
      });

      await then('no generated format revision belongs to a whitespace-only run', () => {
        for (const { xml } of comparisons) {
          const doc = parseXml(xml);
          const whitespaceChanges = findAllByTagName(doc.documentElement, 'w:rPrChange')
            .filter((change) => (owningRun(change)?.textContent ?? '').trim() === '');
          expect(whitespaceChanges).toHaveLength(0);
        }
      });

      await and('the text replacement remains the only content change', () => {
        for (const { xml, result } of comparisons) {
          expect(result.stats.insertions).toBeGreaterThan(0);
          expect(result.stats.deletions).toBeGreaterThan(0);
          expect(result.stats.formatChanges).toBe(0);
          expect(normalizeText(extractTextWithParagraphs(acceptAllChanges(xml)))).toBe(
            'Alpha new Beta',
          );
          expect(normalizeText(extractTextWithParagraphs(rejectAllChanges(xml)))).toBe(
            'Alpha old Beta',
          );
        }
      });
    },
  );

  formatTest(
    'identical currency text with different run boundaries remains untracked',
    async ({ given, when, then, and }: AllureBddContext) => {
      let xml: string;
      let result: InplaceResult;

      await given('an identical currency amount split differently across runs', () => {});

      await when('the documents are compared in inplace mode', async () => {
        ({ xml, result } = await inplaceCompareFull(
          '<w:p><w:r><w:t>$</w:t></w:r><w:r><w:t>1,250.00</w:t></w:r></w:p>',
          '<w:p><w:r><w:t>$1,</w:t></w:r><w:r><w:t>250.00</w:t></w:r></w:p>',
        ));
      });

      await then('the identical amount produces no content or format revisions', () => {
        expect(result.stats.insertions).toBe(0);
        expect(result.stats.deletions).toBe(0);
        expect(result.stats.formatChanges).toBe(0);
      });

      await and('the combined document contains no tracked-change wrappers', () => {
        expect(count(xml, 'w:ins')).toBe(0);
        expect(count(xml, 'w:del')).toBe(0);
        expect(count(xml, 'w:rPrChange')).toBe(0);
        expect(normalizeText(extractTextWithParagraphs(xml))).toBe('$1,250.00');
      });
    },
  );

  formatTest(
    'text replacements do not clone one format revision into both change wrappers',
    async ({ given, when, then, and }: AllureBddContext) => {
      let xml: string;
      let result: InplaceResult;

      await given('one run with surrounding text edits and a character-spacing change', () => {});

      await when('the documents are compared in inplace mode', async () => {
        ({ xml, result } = await inplaceCompareFull(
          '<w:p><w:r><w:rPr><w:spacing w:val="1"/></w:rPr><w:t>Alpha legacy stable middle Omega ending</w:t></w:r></w:p>',
          '<w:p><w:r><w:t>Intro Alpha stable middle Omega revised</w:t></w:r></w:p>',
        ));
      });

      await then('genuine equal-text formatting changes remain tracked', () => {
        expect(result.stats.formatChanges).toBeGreaterThan(0);
        expect(count(xml, 'w:rPrChange')).toBeGreaterThan(0);
      });

      await and('inserted and deleted text do not inherit redundant format snapshots', () => {
        const doc = parseXml(xml);
        for (const wrapper of [
          ...findAllByTagName(doc.documentElement, 'w:ins'),
          ...findAllByTagName(doc.documentElement, 'w:del'),
        ]) {
          expect(findAllByTagName(wrapper, 'w:rPrChange')).toHaveLength(0);
        }
      });

      await and('format revision IDs are unique after word-level run splitting', () => {
        const doc = parseXml(xml);
        const ids = findAllByTagName(doc.documentElement, 'w:rPrChange')
          .map((change) => change.getAttribute('w:id'));
        expect(new Set(ids).size).toBe(ids.length);
      });

      await and('accept and reject recover the revised and original text exactly', () => {
        const accepted = normalizeText(extractTextWithParagraphs(acceptAllChanges(xml)));
        const rejected = normalizeText(extractTextWithParagraphs(rejectAllChanges(xml)));
        expect(accepted).toBe('Intro Alpha stable middle Omega revised');
        expect(rejected).toBe('Alpha legacy stable middle Omega ending');
      });
    },
  );

  test('handleMovedSource/Destination: a reordered paragraph is bracketed by move markers', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let xml: string;

    await given('a three-paragraph document whose first paragraph moves to the end', () => {});

    await when('the documents are compared in inplace mode', async () => {
      xml = await inplaceCompare(
        `${para('The quick brown fox jumps over the lazy dog today')}${para('Middle paragraph stays put')}${para('Final paragraph also stays')}`,
        `${para('Middle paragraph stays put')}${para('Final paragraph also stays')}${para('The quick brown fox jumps over the lazy dog today')}`,
      );
    });

    await then('the move is tracked with moveFrom/moveTo range markers', () => {
      expect(count(xml, 'w:moveFromRangeStart')).toBeGreaterThanOrEqual(1);
      expect(count(xml, 'w:moveToRangeStart')).toBeGreaterThanOrEqual(1);
    });
  });

  test('handleEqual + mixed handlers: an in-place word replacement deletes then inserts', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let xml: string;

    await given('a paragraph whose last word is replaced', () => {});

    await when('the documents are compared in inplace mode', async () => {
      xml = await inplaceCompare(
        para('hello cruel world'),
        para('hello lovely world'),
      );
    });

    await then('the replacement produces both a deletion and an insertion', () => {
      expect(count(xml, 'w:del')).toBeGreaterThanOrEqual(1);
      expect(count(xml, 'w:ins')).toBeGreaterThanOrEqual(1);
    });

    await and('the unchanged words survive as equal content', () => {
      expect(xml).toContain('hello');
      expect(xml).toContain('world');
      expect(xml).toContain('lovely');
      expect(xml).toContain('cruel');
    });
  });
});
