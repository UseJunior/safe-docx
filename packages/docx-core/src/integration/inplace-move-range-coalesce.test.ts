/**
 * Integration Tests — Inplace Move-Range Marker Coalescing
 *
 * Verifies that an in-place whole-paragraph move whose source side fragments
 * into many word-level runs is bracketed by EXACTLY ONE
 * <w:moveFromRangeStart>/<w:moveFromRangeEnd> pair (and one moveTo pair),
 * mirroring how Word (and the rebuild reconstructor) bracket a multi-run move.
 *
 * Bug: the moveFrom clone path (insertMoveFromRun) emitted a fresh range pair
 * per source atom, all reusing the same cached range id. A 9-word moved
 * paragraph produced 19 identical-id <w:moveFromRangeStart>/End pairs while the
 * moveTo side correctly produced one. A coalescing postprocess pass now keeps
 * only the first Start and last End per move group per paragraph.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/446
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { buildSyntheticDocx } from './synthetic-docx-fixture.js';
import { compareDocuments } from '../index.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';

const TEST_FEATURE = 'Inplace Move-Range Coalescing';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

// A ≥5-word paragraph so it clears moveMinimumWordCount and is detected as a move.
const MOVED_PARAGRAPH = 'The quick brown fox jumps over the lazy dog today';

function countTag(xml: string, tag: string): number {
  return (xml.match(new RegExp(`<${tag.replace(':', '\\:')}\\b`, 'g')) ?? []).length;
}

describe('Inplace move-range marker coalescing', () => {
  test('whole-paragraph move emits exactly one moveFrom/moveTo range pair despite run fragmentation', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocuments>>;
    let xml: string;

    await given('a three-paragraph doc where the first paragraph moves to the end', async () => {
      original = await buildSyntheticDocx({
        paragraphs: [MOVED_PARAGRAPH, 'Middle paragraph stays put', 'Final paragraph also stays'],
      });
      revised = await buildSyntheticDocx({
        paragraphs: ['Middle paragraph stays put', 'Final paragraph also stays', MOVED_PARAGRAPH],
      });
    });

    await when('compared in inplace mode', async () => {
      result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });
      const archive = await DocxArchive.load(result.document);
      xml = await archive.getDocumentXml();
    });

    await then('inplace reconstruction is actually used', () => {
      expect(result.reconstructionModeUsed).toBe('inplace');
    });

    await and('the move is bracketed by exactly one range pair per side', () => {
      // Regression: before the fix the fragmented moveFrom side emitted 19
      // identical-id range pairs (one per word-level run); the moveTo side one.
      expect(countTag(xml, 'w:moveFromRangeStart')).toBe(1);
      expect(countTag(xml, 'w:moveFromRangeEnd')).toBe(1);
      expect(countTag(xml, 'w:moveToRangeStart')).toBe(1);
      expect(countTag(xml, 'w:moveToRangeEnd')).toBe(1);
      // The individual per-run wrappers are preserved between the brackets.
      expect(countTag(xml, 'w:moveFrom')).toBeGreaterThan(1);
    });

    await and('the surviving range Start and End share a consistent w:id and w:name', () => {
      const start = xml.match(
        /<w:moveFromRangeStart\s+w:id="([^"]+)"\s+w:name="([^"]+)"/
      );
      const end = xml.match(/<w:moveFromRangeEnd\s+w:id="([^"]+)"/);
      expect(start).not.toBeNull();
      expect(end).not.toBeNull();
      expect(end![1]).toBe(start![1]); // moveFromRangeEnd reuses the Start's w:id
      expect(start![2]).toBe('move1'); // move name

      const toStart = xml.match(/<w:moveToRangeStart\s+w:id="([^"]+)"\s+w:name="([^"]+)"/);
      const toEnd = xml.match(/<w:moveToRangeEnd\s+w:id="([^"]+)"/);
      expect(toStart).not.toBeNull();
      expect(toEnd).not.toBeNull();
      expect(toEnd![1]).toBe(toStart![1]);
      expect(toStart![2]).toBe('move1');
    });
  });
});
