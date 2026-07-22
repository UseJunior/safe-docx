import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import type { ComparisonUnitAtom } from '@usejunior/docx-core';
import { CorrelationStatus } from '@usejunior/docx-core';
import { el } from '../../testing/dom-test-helpers.js';
import { computeAtomizerStats } from './pipeline.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Atomizer Stats',
});

function atom(
  text: string,
  correlationStatus: CorrelationStatus,
  paragraphIndex?: number,
  ancestorElements: Element[] = []
): ComparisonUnitAtom {
  return {
    contentElement: el('w:t', {}, undefined, text),
    ancestorElements,
    ancestorUnids: [],
    part: { uri: 'word/document.xml', contentType: 'text/xml' },
    sha1Hash: `hash-${paragraphIndex}-${text}-${correlationStatus}`,
    correlationStatus,
    paragraphIndex,
  };
}

describe('atomizer comparison stats', () => {
  test('counts contiguous revision ranges separately from atom totals', async ({
    given,
    when,
    then,
    and,
    attachPrettyJson,
  }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];
    let stats: ReturnType<typeof computeAtomizerStats>;

    await given('one paragraph with a multi-atom replacement and a format-only span', () => {
      atoms = [
        atom('{', CorrelationStatus.Deleted, 0),
        atom('mnda_term', CorrelationStatus.Deleted, 0),
        atom('}', CorrelationStatus.Deleted, 0),
        atom('two', CorrelationStatus.Inserted, 0),
        atom(' ', CorrelationStatus.Inserted, 0),
        atom('(2)', CorrelationStatus.Inserted, 0),
        atom(' ', CorrelationStatus.Inserted, 0),
        atom('years', CorrelationStatus.Inserted, 0),
        atom('.', CorrelationStatus.Equal, 0),
        atom('bold', CorrelationStatus.FormatChanged, 0),
        atom(' text', CorrelationStatus.FormatChanged, 0),
      ];
    });

    await when('stats are computed from the merged atom stream', async () => {
      stats = computeAtomizerStats(atoms!);
      await attachPrettyJson('Stats', stats);
    });

    await then('insertions and deletions count coalesced ranges, not word atoms', () => {
      expect(stats.insertions).toBe(1);
      expect(stats.deletions).toBe(1);
      expect(stats.insertedRanges).toBe(1);
      expect(stats.deletedRanges).toBe(1);
      expect(stats.insertedAtoms).toBe(5);
      expect(stats.deletedAtoms).toBe(3);
    });

    await and('modified paragraphs and format changes are reported separately', () => {
      expect(stats.modifications).toBe(1);
      expect(stats.modifiedParagraphs).toBe(1);
      expect(stats.formatChanges).toBe(1);
      expect(stats.formatChangeAtoms).toBe(2);
    });
  });

  test('starts a new range after equal content or a paragraph boundary', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];
    let stats: ReturnType<typeof computeAtomizerStats>;

    await given('inserted atoms separated by equal content and by paragraph index', () => {
      atoms = [
        atom('alpha', CorrelationStatus.Inserted, 0),
        atom('beta', CorrelationStatus.Inserted, 0),
        atom('same', CorrelationStatus.Equal, 0),
        atom('gamma', CorrelationStatus.Inserted, 0),
        atom('delta', CorrelationStatus.Inserted, 1),
      ];
    });

    await when('stats are computed from the merged atom stream', () => {
      stats = computeAtomizerStats(atoms!);
    });

    await then('each contiguous inserted paragraph run is counted as a range', () => {
      expect(stats.insertions).toBe(3);
      expect(stats.insertedRanges).toBe(3);
      expect(stats.insertedAtoms).toBe(4);
    });
  });

  test('uses paragraph element identity when paragraph indices are absent', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let atoms: ComparisonUnitAtom[];
    let stats: ReturnType<typeof computeAtomizerStats>;

    await given('two changed paragraphs at the same ancestor depth without paragraphIndex values', () => {
      const firstParagraph = el('w:p');
      const secondParagraph = el('w:p');
      atoms = [
        atom('old-a', CorrelationStatus.Deleted, undefined, [firstParagraph]),
        atom('new-a', CorrelationStatus.Inserted, undefined, [firstParagraph]),
        atom('old-b', CorrelationStatus.Deleted, undefined, [secondParagraph]),
        atom('new-b', CorrelationStatus.Inserted, undefined, [secondParagraph]),
      ];
    });

    await when('stats fall back to paragraph element identity', () => {
      stats = computeAtomizerStats(atoms!);
    });

    await then('paragraphs remain distinct for range and modification counts', () => {
      expect(stats.modifiedParagraphs).toBe(2);
      expect(stats.deletions).toBe(2);
      expect(stats.insertions).toBe(2);
    });
  });
});
