/**
 * Tests for Jaccard fallback in paragraph group matching.
 *
 * Validates that when TF-IDF cosine similarity degenerates (e.g. with few
 * paragraphs where all shared words get IDF=0), the Jaccard word-overlap
 * fallback correctly matches paragraph groups for atom-level LCS. (#78)
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { createHash } from 'crypto';
import {
  computeGroupLcs,
  type ComparisonUnitGroup,
} from './hierarchicalLcs.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Hierarchical LCS' });

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

/** Build a minimal ComparisonUnitGroup from text content. */
function makeGroup(text: string, paragraphIndex: number): ComparisonUnitGroup {
  return {
    paragraphIndex,
    atoms: [], // atoms not needed for group-level matching
    textHash: sha1(text),
    normalizedTextHash: sha1(text.toLowerCase().replace(/\s+/g, ' ').trim()),
    textContent: text,
  };
}

describe('computeGroupLcs Jaccard fallback', () => {
  test('matches paragraphs with minor word changes when TF-IDF degenerates', async ({ given, when, then }: AllureBddContext) => {
    let origGroups: ComparisonUnitGroup[];
    let revGroups: ComparisonUnitGroup[];
    let result: ReturnType<typeof computeGroupLcs>;

    await given('two single-paragraph documents with 3 word-level changes', () => {
      origGroups = [
        makeGroup('The Company shall pay the amount of $1,000 to the Contractor on the first day of each month.', 0),
      ];
      revGroups = [
        makeGroup('The Company shall pay the amount of $1,500 to the Vendor on the fifteenth day of each month.', 0),
      ];
    });

    await when('computeGroupLcs is called', () => {
      // No precomputed TF-IDF vectors — but the function builds them internally
      // via hierarchicalCompare. For computeGroupLcs, passing undefined triggers
      // the Jaccard fallback path directly.
      result = computeGroupLcs(origGroups, revGroups);
    });

    await then('the paragraphs are matched (not left as deleted + inserted)', () => {
      expect(result.matchedGroups.length).toBe(1);
      expect(result.deletedGroupIndices.length).toBe(0);
      expect(result.insertedGroupIndices.length).toBe(0);
    });
  });

  test('does not match paragraphs with no word overlap', async ({ given, when, then }: AllureBddContext) => {
    let origGroups: ComparisonUnitGroup[];
    let revGroups: ComparisonUnitGroup[];
    let result: ReturnType<typeof computeGroupLcs>;

    await given('two paragraphs with completely different content', () => {
      origGroups = [makeGroup('Alpha beta gamma delta epsilon.', 0)];
      revGroups = [makeGroup('One two three four five six seven.', 0)];
    });

    await when('computeGroupLcs is called', () => {
      result = computeGroupLcs(origGroups, revGroups);
    });

    await then('the paragraphs are NOT matched (left as deleted + inserted)', () => {
      expect(result.matchedGroups.length).toBe(0);
      expect(result.deletedGroupIndices.length).toBe(1);
      expect(result.insertedGroupIndices.length).toBe(1);
    });
  });
});
