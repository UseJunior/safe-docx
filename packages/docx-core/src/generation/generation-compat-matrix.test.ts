import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const TEST_FEATURE = 'add-docx-generation';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');
const CHECKLIST_PATH = join(PACKAGE_ROOT, 'docs', 'generation-manual-compat-checklist.md');

/**
 * Every generated review artifact, discovered from the test sources that
 * write them — the artifact set and the matrix can therefore never drift
 * silently: adding a writeIntegrationArtifact call without a matrix row
 * fails this scenario.
 */
function discoverArtifactClasses(): string[] {
  const sources: string[] = [];
  const generationDir = join(PACKAGE_ROOT, 'src', 'generation');
  for (const name of readdirSync(generationDir)) {
    if (name.endsWith('.test.ts')) sources.push(join(generationDir, name));
  }
  sources.push(join(PACKAGE_ROOT, 'src', 'integration', 'generation-package-structure.test.ts'));

  const names = new Set<string>();
  for (const file of sources) {
    const content = readFileSync(file, 'utf-8');
    for (const match of content.matchAll(/writeIntegrationArtifact\('([^']+\.docx)'/g)) {
      names.add(match[1]!);
    }
  }
  return Array.from(names).sort();
}

describe('Traceability: manual compatibility matrix coverage', () => {
  test.openspec('[SDX-GEN-092] the manual compatibility matrix tracks every artifact class')(
    'Scenario: the manual compatibility matrix tracks every artifact class',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let artifacts!: string[];
      await given('the set of generated review artifacts, discovered from the test sources that write them', async () => {
        artifacts = discoverArtifactClasses();
        await attachPrettyJson('artifact-classes', artifacts);
        expect(artifacts.length).toBeGreaterThanOrEqual(6);
      });

      let checklist!: string;
      let matrixRows!: string[];
      await when('the manual compatibility checklist is read', async () => {
        checklist = readFileSync(CHECKLIST_PATH, 'utf-8');
        matrixRows = checklist.split('\n').filter((line) => line.startsWith('| `generation-'));
        expect(matrixRows.length).toBeGreaterThan(0);
      });

      await then('every artifact class has a matrix row', async () => {
        for (const artifact of artifacts) {
          expect(matrixRows.some((row) => row.includes(`\`${artifact}\``)), `missing matrix row for ${artifact}`).toBe(true);
        }
        expect(matrixRows).toHaveLength(artifacts.length);
      });

      await then('the matrix covers Word for Mac, Pages, Google Docs, and LibreOffice observations', async () => {
        const headerLine = checklist.split('\n').find((line) => line.includes('| Artifact |'));
        expect(headerLine).toBeTruthy();
        for (const reader of ['Word for Mac', 'Pages', 'Google Docs import', 'LibreOffice']) {
          expect(headerLine!).toContain(reader);
        }
        // Each row carries an observation cell per reader column (artifact,
        // revision, then the four readers).
        for (const row of matrixRows) {
          expect(row.split('|').filter((cell) => cell.trim().length > 0).length).toBe(6);
        }
      });
    },
  );
});
