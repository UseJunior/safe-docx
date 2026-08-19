/**
 * Committed legacy/tagged characterization over checked-in fixtures, the ILPA
 * pair, and the SHA-256-pinned public NVCA corpus.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import {
  REAL_CORPUS_ENV,
  resolveRealCorpusAvailability,
} from './real-corpus-fixtures.js';
import { loadStrategyDifferentialFixtures } from './strategy-differential-fixtures.js';
import {
  assertCharacterizationSafety,
  assertExpectedPackageParts,
  characterizeStrategyDifferential,
  type ApprovedDivergenceDimension,
  type StrategyDifferentialRow,
} from './strategy-differential-harness.js';

const TEST_FEATURE = 'Refactor Tagged Tree Spine';
const REQUIRED_ENV = 'SAFE_DOCX_STRATEGY_DIFFERENTIAL_REQUIRED';
const INTEGRATION_DIR = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(INTEGRATION_DIR, 'strategy-differential-manifest.json');
const corpusRoot = process.env[REAL_CORPUS_ENV] ?? '';
const availability = resolveRealCorpusAvailability(corpusRoot);

interface DivergenceRecord {
  id: string;
  status: 'active' | 'resolved';
  issue: string;
  summary: string;
  dimensions: ApprovedDivergenceDimension[];
}

interface CharacterizationManifest {
  schemaVersion: 1;
  divergences: DivergenceRecord[];
  rows: Array<StrategyDifferentialRow & { legacy: unknown }>;
}

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as CharacterizationManifest;
const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: TEST_FEATURE,
    story: 'Strategy Differential Manifest',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' },
  );

describe('strategy differential manifest contract', () => {
  test.openspec('Missing corpus evidence fails loudly')(
    'names the missing required corpus instead of silently reporting success',
    () => {
      const missing = resolveRealCorpusAvailability('');
      expect(missing.available).toBe(false);
      expect(missing.skipWarning).toContain(REAL_CORPUS_ENV);
      if (process.env[REQUIRED_ENV] === '1') {
        expect(availability.skipWarning).toBeNull();
        expect(availability.available).toBe(true);
      }
    },
  );

  test.openspec('A behavior fix closes an explicit divergence')(
    'keeps active and resolved divergence IDs explicit and unique',
    () => {
      expect(manifest.schemaVersion).toBe(1);
      const ids = manifest.divergences.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(manifest.divergences).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'TD-FUZZY-MOVE-001', status: 'resolved' }),
        expect.objectContaining({ id: 'TD-LEGACY-ILPA-REJECT-001', status: 'active' }),
        expect.objectContaining({ id: 'TD-LEGACY-MOVE-PROJECTION-001', status: 'active' }),
        expect.objectContaining({ id: 'TD-NUMBERING-001', status: 'resolved' }),
        expect.objectContaining({ id: 'TD-CONSUMER-COMPAT-001', status: 'resolved' }),
        expect.objectContaining({ id: 'TD-PAGEREF-CACHE-001', status: 'resolved' }),
        expect.objectContaining({ id: 'TD-ATOM-STATS-SEMANTICS-001', status: 'active' }),
      ]));
      for (const divergence of manifest.divergences) {
        expect(divergence.issue).toMatch(/^#\d+$/u);
        expect(divergence.summary.length).toBeGreaterThan(20);
        expect(divergence.dimensions.length).toBeGreaterThan(0);
      }
    },
  );
});

describe('strategy differential committed rows', () => {
  const corpusTest = availability.available ? test : test.skip;
  corpusTest(
    'matches the reviewed manifest for every required fixture',
    async () => {
      const fixtures = await loadStrategyDifferentialFixtures(corpusRoot);
      const rows: StrategyDifferentialRow[] = [];
      for (const fixture of fixtures) {
        try {
          const row = await characterizeStrategyDifferential(fixture);
          rows.push(row);
        } catch (error) {
          throw new Error(
            `${fixture.id}: strategy characterization failed`,
            { cause: error },
          );
        }
      }

      const activeDivergences = new Map(
        manifest.divergences
          .filter((entry) => entry.status === 'active')
          .map((entry) => [entry.id, entry] as const),
      );
      for (const [index, row] of rows.entries()) {
        const approvedDimensions = new Set(
          row.approvedDivergenceIds.flatMap(
            (id) => activeDivergences.get(id)?.dimensions ?? [],
          ),
        );
        assertCharacterizationSafety(row, approvedDimensions);
        assertExpectedPackageParts(fixtures[index]!, row);
      }

      for (const row of rows) {
        for (const divergenceId of row.approvedDivergenceIds) {
          expect(activeDivergences.has(divergenceId), divergenceId).toBe(true);
        }
      }

      const expectedRows = manifest.rows.map((row) => ({
        fixture: row.fixture,
        approvedDivergenceIds: row.approvedDivergenceIds,
        taggedTree: row.taggedTree,
      }));
      expect(rows).toEqual(expectedRows);
    },
    600_000,
  );
});
