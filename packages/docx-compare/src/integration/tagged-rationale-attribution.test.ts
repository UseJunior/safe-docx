/**
 * Exact operation provenance for tagged Markdoc publication.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @see #895
 */

import JSZip from 'jszip';
import {
  addTrackedRangeComments,
  buildSyntheticDocx,
  DocxDocument,
  parseXml,
} from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { compareDocumentsAtomizer } from '../index.js';
import { testAllure } from '../testing/allure-test.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEST_FEATURE = 'Refactor Tagged Tree Spine';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: TEST_FEATURE,
    story: 'Tagged Rationale Attribution',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' },
  );

async function fixture(): Promise<Awaited<ReturnType<typeof compareDocumentsAtomizer>>> {
  const source = await buildSyntheticDocx({
    paragraphs: [
      'Alpha old term remains bounded.',
      'Beta old cadence remains separate.',
    ],
  });
  const anchored = await DocxDocument.load(source);
  anchored.insertParagraphBookmarks('tagged-rationale-attribution');
  const anchoredBuffer = (await anchored.toBuffer({ cleanBookmarks: false })).buffer;
  const paragraphIds = anchored.buildDocumentView().nodes.map((node) => node.id);
  const revised = await DocxDocument.load(anchoredBuffer);
  revised.replaceTextAtRange({
    targetParagraphId: paragraphIds[0]!,
    start: 6,
    end: 9,
    replaceText: 'new',
  });
  revised.replaceTextAtRange({
    targetParagraphId: paragraphIds[1]!,
    start: 5,
    end: 8,
    replaceText: 'new',
  });
  const revisedBuffer = (await revised.toBuffer({ cleanBookmarks: false })).buffer;
  return compareDocumentsAtomizer(anchoredBuffer, revisedBuffer, {
    author: 'Attribution Test',
    date: new Date('2026-08-17T12:00:00.000Z'),
    revisionAttributionRanges: [
      {
        operationId: 'alpha',
        side: 'revised',
        startParagraphId: paragraphIds[0]!,
        start: 6,
        endParagraphId: paragraphIds[0]!,
        end: 9,
      },
      {
        operationId: 'beta',
        side: 'revised',
        startParagraphId: paragraphIds[1]!,
        start: 5,
        endParagraphId: paragraphIds[1]!,
        end: 8,
      },
    ],
  });
}

let cachedFixture: ReturnType<typeof fixture> | undefined;
function attributedFixture(): ReturnType<typeof fixture> {
  cachedFixture ??= fixture();
  return cachedFixture;
}

describe('tagged revision rationale attribution', () => {
  test.openspec('Multiple operations retain disjoint rationale ranges')(
    'maps each operation to one unique balanced and non-overlapping emitted interval',
    async () => {
      const result = await attributedFixture();
      expect(result.comparisonStrategyUsed).toBe('tagged-tree');
      expect(result.revisionAttributions?.map((entry) => entry.operationId)).toEqual([
        'alpha',
        'beta',
      ]);
      const commented = await addTrackedRangeComments(
        result.document,
        result.revisionAttributions!.map((entry) => ({
          startRevision: entry.startRevision,
          endRevision: entry.endRevision,
          author: 'Synthetic Reviewer',
          initials: 'SR',
          date: '2026-08-17T12:00:00.000Z',
          text: `Rationale for ${entry.operationId}`,
        })),
      );
      const zip = await JSZip.loadAsync(commented);
      const xml = await zip.file('word/document.xml')!.async('string');
      const document = parseXml(xml);
      const stack: string[] = [];
      const completed = new Set<string>();
      for (const element of Array.from(document.getElementsByTagName('*'))) {
        if (element.localName === 'commentRangeStart') {
          expect(stack).toHaveLength(0);
          stack.push(element.getAttributeNS(W_NS, 'id') ?? '');
        } else if (element.localName === 'commentRangeEnd') {
          const id = element.getAttributeNS(W_NS, 'id') ?? '';
          expect(stack.pop()).toBe(id);
          completed.add(id);
        }
      }
      expect(stack).toEqual([]);
      expect(completed.size).toBe(2);
    },
  );

  test.openspec('Private attribution data does not leak')(
    'removes every private operation marker before any package part is published',
    async () => {
      const result = await attributedFixture();
      const zip = await JSZip.loadAsync(result.document);
      const contents = await Promise.all(Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map((entry) => entry.async('string')));
      expect(contents.join('\n')).not.toContain('data-safe-docx-operation');
      expect(contents.join('\n')).not.toContain('safe-docx-rationale-');
    },
  );
});
