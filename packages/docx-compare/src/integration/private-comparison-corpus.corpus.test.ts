/**
 * Hash-pinned safety gates for comparison pairs that may be used in private CI but
 * cannot be redistributed with the public package.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import {
  assertCharacterizationSafety,
  assertExpectedPackageParts,
  characterizeStrategyDifferential,
  type StrategyDifferentialFixture,
} from './strategy-differential-harness.js';

const PRIVATE_CORPUS_ENV = 'SAFE_DOCX_PRIVATE_COMPARISON_CORPUS_DIR';
const PRIVATE_CORPUS_REQUIRED_ENV = 'SAFE_DOCX_PRIVATE_COMPARISON_CORPUS_REQUIRED';
const INTEGRATION_DIR = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(INTEGRATION_DIR, 'private-comparison-corpus-manifest.json');

interface PrivateCorpusEntry {
  id: string;
  classification: 'licensed-template';
  redistribution: 'prohibited';
  original: string;
  revised: string;
  originalSha256: string;
  revisedSha256: string;
  capabilityTags: string[];
}

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as PrivateCorpusEntry[];
const corpusRoot = process.env[PRIVATE_CORPUS_ENV] ?? '';
const missingFiles = corpusRoot
  ? manifest.flatMap((entry) => [entry.original, entry.revised])
      .filter((path) => !existsSync(resolve(corpusRoot, path)))
  : manifest.flatMap((entry) => [entry.original, entry.revised]);
const available = corpusRoot.length > 0 && missingFiles.length === 0;

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function loadFixture(entry: PrivateCorpusEntry): Promise<StrategyDifferentialFixture> {
  const [original, revised] = await Promise.all([
    readFile(resolve(corpusRoot, entry.original)),
    readFile(resolve(corpusRoot, entry.revised)),
  ]);
  expect(sha256(original), `${entry.id} original identity`).toBe(entry.originalSha256);
  expect(sha256(revised), `${entry.id} revised identity`).toBe(entry.revisedSha256);
  expect(entry.redistribution).toBe('prohibited');
  return {
    id: `private/${entry.id}`,
    original,
    revised,
    capabilityTags: entry.capabilityTags,
    expectedPackageParts: ['word/document.xml', 'word/_rels/document.xml.rels'],
    approvedDivergenceIds: ['TD-ATOM-STATS-SEMANTICS-001'],
  };
}

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'Refactor Tagged Tree Spine',
    story: 'Private Comparison Corpus',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' },
  );

describe('private comparison corpus availability', () => {
  test('fails loudly when private evidence is required but unavailable', () => {
    if (process.env[PRIVATE_CORPUS_REQUIRED_ENV] === '1') {
      expect(
        available,
        `set ${PRIVATE_CORPUS_ENV} to the hash-pinned private corpus; missing: ${missingFiles.join(', ')}`,
      ).toBe(true);
    }
  });
});

describe.skipIf(!available)('private comparison corpus safety', () => {
  for (const entry of manifest) {
    test(`preserves projections and package safety for ${entry.id}`, async () => {
      const fixture = await loadFixture(entry);
      const row = await characterizeStrategyDifferential(fixture);
      assertCharacterizationSafety(row, new Set(['tagged-tree.atomStatisticsSemantics']));
      assertExpectedPackageParts(fixture, row);
      expect(row.taggedTree.forbiddenPayloadLeaks).toEqual([]);
      expect(row.taggedTree.unsupportedStoryDiagnostics).toEqual([]);
    }, 180_000);
  }
});
