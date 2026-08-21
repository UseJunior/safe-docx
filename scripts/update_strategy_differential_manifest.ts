#!/usr/bin/env tsx

import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStrategyDifferentialFixtures } from '../packages/docx-compare/src/integration/strategy-differential-fixtures.js';
import {
  characterizeStrategyDifferential,
  type StrategyDifferentialRow,
} from '../packages/docx-compare/src/integration/strategy-differential-harness.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MANIFEST_PATH = resolve(
  REPO_ROOT,
  'packages/docx-compare/src/integration/strategy-differential-manifest.json',
);
const CORPUS_ENV = 'SAFE_DOCX_REAL_CORPUS_DIR';

interface PersistedRow extends StrategyDifferentialRow {
  legacy?: unknown;
}

interface CharacterizationManifest {
  schemaVersion: 1;
  divergences: unknown[];
  rows: PersistedRow[];
}

function parseArguments(argv: string[]): { corpusRoot: string; write: boolean } {
  const write = argv.includes('--write');
  const corpusIndex = argv.indexOf('--corpus');
  if (corpusIndex >= 0 && !argv[corpusIndex + 1]) {
    throw new Error('--corpus requires a directory');
  }
  const corpusRoot = corpusIndex >= 0 ? argv[corpusIndex + 1] : process.env[CORPUS_ENV];
  if (!corpusRoot) {
    throw new Error(`pass --corpus <directory> or set ${CORPUS_ENV}`);
  }
  return { corpusRoot: resolve(corpusRoot), write };
}

function preserveRetiredLegacyEvidence(
  row: StrategyDifferentialRow,
  previous: PersistedRow | undefined,
): PersistedRow {
  if (!previous || !Object.hasOwn(previous, 'legacy')) return row;
  return {
    fixture: row.fixture,
    approvedDivergenceIds: row.approvedDivergenceIds,
    legacy: previous.legacy,
    taggedTree: row.taggedTree,
  };
}

async function main(): Promise<void> {
  const { corpusRoot, write } = parseArguments(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as CharacterizationManifest;
  const previousRows = new Map(manifest.rows.map((row) => [row.fixture.id, row]));
  const fixtures = await loadStrategyDifferentialFixtures(corpusRoot);
  const rows: PersistedRow[] = [];

  for (const fixture of fixtures) {
    const characterized = await characterizeStrategyDifferential(fixture);
    rows.push(preserveRetiredLegacyEvidence(
      characterized,
      previousRows.get(characterized.fixture.id),
    ));
  }

  const updated = `${JSON.stringify({ ...manifest, rows }, null, 2)}\n`;
  const current = await readFile(MANIFEST_PATH, 'utf8');
  if (updated === current) {
    console.log('strategy differential manifest is current');
    return;
  }
  if (!write) {
    throw new Error('strategy differential manifest is stale; rerun with --write');
  }

  const temporaryPath = `${MANIFEST_PATH}.tmp`;
  await writeFile(temporaryPath, updated, 'utf8');
  await rename(temporaryPath, MANIFEST_PATH);
  console.log(`updated ${MANIFEST_PATH} with ${rows.length} rows`);
}

await main();
