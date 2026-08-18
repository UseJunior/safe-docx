/**
 * Real-corpus paragraph-deletion comparison gate.
 *
 * Synthetic fixtures are deliberately insufficient here: Word-authored NVCA
 * agreements contain field and bookmark layouts that previously escaped a
 * completely green suite. Each corpus source is SHA-256-pinned and exercised
 * through the sole tagged spine after removing one real paragraph.
 *
 * Known defects use exact characterization outcomes so a behavior change fails
 * the gate in either direction. A different failure is a regression; a cell
 * that unexpectedly starts passing also fails and requires its pin to be removed.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @see https://github.com/UseJunior/safe-docx/issues/658
 * @see https://github.com/UseJunior/safe-docx/issues/643
 * @see https://github.com/UseJunior/safe-docx/issues/645
 * @see https://github.com/UseJunior/safe-docx/issues/646
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { compareDocumentsAtomizer } from '../baselines/atomizer/pipeline.js';
import { testAllure } from '../testing/allure-test.js';
import {
  deleteOneRealParagraph,
  REAL_CORPUS_ENV,
  REAL_CORPUS_REQUIRED_ENV,
  resolveRealCorpusAvailability,
  type RealCorpusEntry,
} from './real-corpus-fixtures.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEST_FEATURE = 'docx-comparison';

type CellOutcome =
  | { kind: 'pass' }
  | { kind: 'bookmark-range-failure'; names: string[] }
  | { kind: 'comparison-error'; errorName: string; message: string };

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: TEST_FEATURE,
    story: 'Word-Authored Agreement Paragraph Deletion',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' },
  );
const paragraphStyleTest = test.conformance({
  spec: 'ECMA-376',
  edition: 5,
  part: 1,
  section: '17.13.5.29',
});

function elements(node: XmlDocument | XmlElement, tagName: string): XmlElement[] {
  return Array.from(node.getElementsByTagName(tagName));
}

function collapsedTargetedBookmarkNames(
  comparedDocumentXml: string,
  names: string[],
): string[] {
  const document = new DOMParser().parseFromString(comparedDocumentXml, 'text/xml');
  const collapsed: string[] = [];
  for (const name of names) {
    const start = elements(document, 'w:bookmarkStart').find(
      (candidate) =>
        (candidate.getAttribute('w:name') ?? candidate.getAttributeNS(W_NS, 'name')) === name,
    );
    if (!start) {
      collapsed.push(name);
      continue;
    }
    const id = start.getAttribute('w:id') ?? start.getAttributeNS(W_NS, 'id');
    const end = elements(document, 'w:bookmarkEnd').find(
      (candidate) =>
        (candidate.getAttribute('w:id') ?? candidate.getAttributeNS(W_NS, 'id')) === id,
    );
    if (!end) {
      collapsed.push(name);
      continue;
    }

    const paragraph = start.parentNode as XmlElement | null;
    if (paragraph?.tagName !== 'w:p' || end.parentNode !== paragraph) {
      collapsed.push(name);
      continue;
    }

    const orderedElements: XmlElement[] = [];
    const visit = (node: XmlNode): void => {
      if (node.nodeType === 1) orderedElements.push(node as XmlElement);
      for (const child of Array.from(node.childNodes)) visit(child);
    };
    visit(paragraph);
    const startIndex = orderedElements.indexOf(start);
    const endIndex = orderedElements.indexOf(end);
    const deletedTextIndex = orderedElements.findIndex(
      (element, index) =>
        index > startIndex && index < endIndex && element.tagName === 'w:delText',
    );
    if (startIndex >= endIndex || deletedTextIndex <= startIndex) collapsed.push(name);
  }
  return collapsed;
}

async function runCell(
  entry: RealCorpusEntry,
): Promise<CellOutcome> {
  const original = readFileSync(join(corpusRoot, entry.id, 'source.docx'));
  const deletion = await deleteOneRealParagraph(original, entry.id);
  try {
    const result = await compareDocumentsAtomizer(original, deletion.revised, {
      author: 'Real Corpus Gate',
      date: new Date('2026-07-26T00:00:00Z'),
    });
    const comparedZip = await JSZip.loadAsync(result.document);
    const comparedDocumentXml = await comparedZip.file('word/document.xml')!.async('string');
    const collapsedNames = collapsedTargetedBookmarkNames(
      comparedDocumentXml,
      deletion.targetedBookmarkNames,
    );
    return collapsedNames.length === 0
      ? { kind: 'pass' }
      : { kind: 'bookmark-range-failure', names: collapsedNames };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return {
      kind: 'comparison-error',
      errorName: error.constructor.name,
      message: error.message,
    };
  }
}

const corpusRoot = process.env[REAL_CORPUS_ENV] ?? '';
const corpusAvailability = resolveRealCorpusAvailability(corpusRoot);
if (!corpusAvailability.available) {
  console.warn(corpusAvailability.skipWarning);
}

describe('real-corpus gate availability', () => {
  test('an unset corpus directory resolves to a logged skip warning naming the variable', () => {
    const resolution = resolveRealCorpusAvailability('');
    expect(resolution.available).toBe(false);
    expect(resolution.skipWarning).toContain('SKIP');
    expect(resolution.skipWarning).toContain(REAL_CORPUS_ENV);
  });

  if (process.env[REAL_CORPUS_REQUIRED_ENV] === '1') {
    test('required CI corpus is complete and SHA-256 verified', () => {
      expect(corpusAvailability.skipWarning).toBeNull();
      expect(corpusAvailability.available).toBe(true);
    });
  }
});

describe.skipIf(!corpusAvailability.available)('real-corpus paragraph deletion matrix', () => {
  for (const entry of corpusAvailability.entries) {
    test(
      `${entry.id} × tagged-spine × paragraph-deletion`,
      async () => {
        expect(await runCell(entry)).toEqual({ kind: 'pass' });
      },
      120_000,
    );
  }
});

describe.skipIf(!corpusAvailability.available)('real-corpus paragraph style no-phantom matrix', () => {
  for (const entry of corpusAvailability.entries) {
    paragraphStyleTest.openspec('[SDX-CMP-PSTYLE-07] Unchanged real paragraph styles produce no phantom markup')(
        `${entry.id} × tagged-spine × unchanged paragraph styles`,
        async () => {
          const source = readFileSync(join(corpusRoot, entry.id, 'source.docx'));
          const author = 'Real Corpus Paragraph Style Gate';
          const result = await compareDocumentsAtomizer(source, source, {
            author,
            date: new Date('2026-07-28T00:00:00Z'),
          });
          expect(result.stats.formatChanges).toBe(0);

          const comparedZip = await JSZip.loadAsync(result.document);
          const comparedDocumentXml = await comparedZip
            .file('word/document.xml')!
            .async('string');
          const comparedDocument = new DOMParser().parseFromString(
            comparedDocumentXml,
            'text/xml',
          );
          const authoredPPrChanges = elements(comparedDocument, 'w:pPrChange')
            .filter((change) =>
              (change.getAttribute('w:author') ??
                change.getAttributeNS(W_NS, 'author')) === author,
            );
          expect(authoredPPrChanges).toHaveLength(0);
        },
        120_000,
      );
  }
});
