/**
 * Revised-base standalone package shadow over the committed strategy corpus.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 */

import { describe, expect } from 'vitest';
import {
  compareDocumentsAtomizer,
  type TaggedPackageShadowReport,
} from '../baselines/atomizer/pipeline.js';
import { testAllure } from '../testing/allure-test.js';
import { REAL_CORPUS_ENV, resolveRealCorpusAvailability } from './real-corpus-fixtures.js';
import { loadStrategyDifferentialFixtures } from './strategy-differential-fixtures.js';

const REQUIRED_ENV = 'SAFE_DOCX_STANDALONE_TAGGED_PACKAGE_REQUIRED';
const corpusRoot = process.env[REAL_CORPUS_ENV] ?? '';
const availability = resolveRealCorpusAvailability(corpusRoot);
const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'refactor-tagged-tree-spine',
    story: 'Standalone Tagged Package',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' },
  );

describe('standalone tagged package corpus shadow', () => {
  const corpusTest = availability.available || process.env[REQUIRED_ENV] === '1'
    ? test
    : test.skip;
  corpusTest(
    'matches every normalized authoritative package part in the required corpus',
    async () => {
      if (process.env[REQUIRED_ENV] === '1') {
        expect(availability.skipWarning).toBeNull();
        expect(availability.available).toBe(true);
      }
      const fixtures = await loadStrategyDifferentialFixtures(corpusRoot);
      for (const fixture of fixtures) {
        let report: TaggedPackageShadowReport | undefined;
        const result = await compareDocumentsAtomizer(fixture.original, fixture.revised, {
          author: 'Strategy Differential',
          date: new Date('2026-08-17T12:00:00.000Z'),
          standaloneTaggedPackageShadowObserver: (value) => { report = value; },
        });
        expect(result.comparisonStrategyUsed, fixture.id).toBe('tagged-tree');
        expect(report, `${fixture.id}: shadow did not execute`).toBeDefined();
        expect(report?.missingParts, `${fixture.id}: missing parts`).toEqual([]);
        expect(report?.unexpectedParts, `${fixture.id}: unexpected parts`).toEqual([]);
        expect(report?.differentParts, `${fixture.id}: different parts`).toEqual([]);
        expect(
          report?.standaloneHasNoLegacyAssemblyInputs,
          `${fixture.id}: legacy assembly dependency`,
        ).toBe(true);
      }
    },
    600_000,
  );
});
