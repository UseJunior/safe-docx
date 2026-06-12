/**
 * docx-platform-tests self-check (cross-implementation conformance suite).
 *
 * Drives the REAL suite runner (open-agreements/docx-platform-tests) against
 * the safe-docx conformance adapter (`src/cli/conformance-adapter.ts`) via a
 * temporary adapter registry, and asserts every suite scenario reports
 * `pass`. safe-docx disagreeing with a suite expectation fails this test —
 * the suite's assertions derive from cited ECMA-376 clauses, so a failure
 * here is a conformance finding, not a flake.
 *
 * Gating (Lean-differential-harness pattern): the suite checkout is located
 * via the DOCX_PLATFORM_TESTS_DIR environment variable; when it is unset,
 * missing, or its runner dependencies are not installed, the gated suite is
 * SKIPPED with a clear message so `npm test` stays green on machines without
 * the checkout. CI clones the suite at the SHA recorded in
 * `docx-platform-tests.pin.json`; a checkout at a different SHA warns (both
 * SHAs named) but still runs.
 *
 * The protocol-behavior tests (unsupported operation → exit 2, protocol
 * mismatch → exit 3) need no suite checkout and always run.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

// Named const (not an inline literal) so `scripts/validate_allure_test_labels.mjs`
// can map the `.openspec([XIMPL-*])` tags deterministically to a feature.
const TEST_FEATURE = 'Cross-Implementation Conformance Suite';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' });

const INTEGRATION_DIR = dirname(import.meta.url.replace('file://', ''));
const PROJECT_ROOT = join(INTEGRATION_DIR, '../../../..');
const ADAPTER_ENTRY = join(INTEGRATION_DIR, '../cli/conformance-adapter.ts');
const TSX_BIN = join(PROJECT_ROOT, 'node_modules/.bin/tsx');
const PIN_FILE = join(INTEGRATION_DIR, 'docx-platform-tests.pin.json');

const SUITE_DIR = process.env.DOCX_PLATFORM_TESTS_DIR ?? '';
const RUNNER_TSX = SUITE_DIR ? join(SUITE_DIR, 'runner/node_modules/.bin/tsx') : '';

interface SuiteResults {
  results: Array<{
    scenarioId: string;
    outcomes: Record<
      string,
      {
        status: string;
        reason?: string;
        assertionResults?: Array<{ assertionKind: string; passed: boolean; detail: string }>;
      }
    >;
  }>;
}

const suiteAvailable =
  SUITE_DIR !== '' && existsSync(SUITE_DIR) && existsSync(RUNNER_TSX);
if (!suiteAvailable) {
  console.warn(
    '[cross-implementation-suite] SKIP: set DOCX_PLATFORM_TESTS_DIR to a ' +
      'docx-platform-tests checkout with runner dependencies installed ' +
      '(git clone open-agreements/docx-platform-tests && cd runner && npm ci).',
  );
}
const describeMaybe = suiteAvailable ? describe : describe.skip;

function warnOnPinMismatch(): void {
  const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8')) as { pinnedCommitSha: string };
  const head = spawnSync('git', ['-C', SUITE_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const actualSha = head.status === 0 ? head.stdout.trim() : 'unknown';
  if (actualSha !== pin.pinnedCommitSha) {
    console.warn(
      `[cross-implementation-suite] suite checkout is at ${actualSha}, pinned ${pin.pinnedCommitSha}; running anyway`,
    );
  }
}

describeMaybe('Cross-implementation conformance suite self-check', () => {
  test
    .openspec('[XIMPL-01] Suite checkout present and safe-docx agrees')
    .openspec('[XIMPL-02] Suite checkout absent')
    .openspec('[XIMPL-03] Checkout ahead of the pin')
    .openspec('[XIMPL-04] acceptAllTrackedChanges round-trip through the adapter')(
    'safe-docx adapter passes every docx-platform-tests scenario',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      const workDir = mkdtempSync(join(tmpdir(), 'ximpl-'));
      try {
        const registryPath = join(workDir, 'adapters.json');
        const resultsPath = join(workDir, 'results.json');
        let results: SuiteResults = { results: [] };

        await given('a temp registry pointing the suite runner at the safe-docx adapter', async () => {
          warnOnPinMismatch();
          writeFileSync(
            registryPath,
            JSON.stringify({
              protocolVersion: 1,
              adapters: [
                { adapterName: 'safe-docx', adapterCommand: [TSX_BIN, ADAPTER_ENTRY] },
              ],
            }),
          );
        });

        await when('the real suite runner executes every scenario through the adapter', async () => {
          const run = spawnSync(
            RUNNER_TSX,
            ['src/run.ts', '--registry', registryPath, '--results', resultsPath],
            { cwd: join(SUITE_DIR, 'runner'), encoding: 'utf8', timeout: 120_000 },
          );
          expect(run.status, `runner failed:\n${run.stdout}\n${run.stderr}`).toBe(0);
          results = JSON.parse(readFileSync(resultsPath, 'utf8')) as SuiteResults;
          await attachPrettyJson('suite-results', results);
        });

        await then('every scenario outcome for safe-docx is pass', async () => {
          expect(results.results.length).toBeGreaterThan(0);
          const failures = results.results
            .map((scenario) => ({ scenario, outcome: scenario.outcomes['safe-docx'] }))
            .filter(({ outcome }) => outcome?.status !== 'pass');
          const detail = failures
            .map(
              ({ scenario, outcome }) =>
                `${scenario.scenarioId}: ${outcome?.status ?? 'missing'} ` +
                (outcome?.reason ?? '') +
                (outcome?.assertionResults ?? [])
                  .filter((a) => !a.passed)
                  .map((a) => `\n  ${a.assertionKind}: ${a.detail}`)
                  .join(''),
            )
            .join('\n');
          expect(failures.length, detail).toBe(0);
        });
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});

describe('Conformance adapter protocol behavior', () => {
  test.openspec('[XIMPL-05] Unknown operation declined honestly')(
    'unknown operations exit 2 with a one-line reason and no output',
    async ({ given, when, then }: AllureBddContext) => {
      const workDir = mkdtempSync(join(tmpdir(), 'ximpl-proto-'));
      try {
        const operationPath = join(workDir, 'operation.json');
        const outputPath = join(workDir, 'output.docx');
        let result: SpawnSyncReturns<string>;

        await given('an operation descriptor outside the implemented set', async () => {
          writeFileSync(operationPath, JSON.stringify({ operationName: 'rewriteEntireDocumentInLatin' }));
        });

        await when('the adapter is invoked with protocol v1', async () => {
          result = spawnSync(
            TSX_BIN,
            [
              ADAPTER_ENTRY,
              '--protocol-version', '1',
              '--operation', operationPath,
              '--input', join(workDir, 'does-not-exist.docx'),
              '--output', outputPath,
            ],
            { encoding: 'utf8', timeout: 60_000 },
          );
        });

        await then('it exits 2, explains itself on stdout, and writes nothing', async () => {
          expect(result!.status, result!.stderr).toBe(2);
          expect(result!.stdout.trim()).toContain('does not implement');
          expect(existsSync(outputPath)).toBe(false);
        });
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  test.openspec('[XIMPL-06] Protocol version mismatch exits with code 3')(
    'an unknown protocol version exits 3',
    async ({ given, when, then }: AllureBddContext) => {
      const workDir = mkdtempSync(join(tmpdir(), 'ximpl-ver-'));
      try {
        const operationPath = join(workDir, 'operation.json');
        let result: SpawnSyncReturns<string>;

        await given('a valid operation descriptor', async () => {
          writeFileSync(operationPath, JSON.stringify({ operationName: 'acceptAllTrackedChanges' }));
        });

        await when('the adapter is invoked with protocol v999', async () => {
          result = spawnSync(
            TSX_BIN,
            [
              ADAPTER_ENTRY,
              '--protocol-version', '999',
              '--operation', operationPath,
              '--input', join(workDir, 'unused.docx'),
              '--output', join(workDir, 'unused-out.docx'),
            ],
            { encoding: 'utf8', timeout: 60_000 },
          );
        });

        await then('it exits 3 and names the protocol it speaks', async () => {
          expect(result!.status, result!.stderr).toBe(3);
          expect(result!.stdout).toContain('protocol v1');
        });
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
