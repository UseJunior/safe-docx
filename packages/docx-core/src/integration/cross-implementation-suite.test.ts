/**
 * docx-platform-tests self-check (cross-implementation conformance suite).
 *
 * Drives the REAL suite runner (open-agreements/docx-platform-tests) against
 * the safe-docx conformance adapter (`src/cli/conformance-adapter.ts`) via a
 * temporary adapter registry. Every scenario using an implemented operation
 * and supported input shape must report `pass`; operations and shapes outside
 * that set must report `unsupported`. A supported-shape disagreement fails this test —
 * the suite's assertions derive from cited standards clauses, so a failure is
 * a conformance finding, not a flake.
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
 * mismatch → exit 3) and the suite-gating tests (skip-on-absent resolution,
 * pin-mismatch warning) need no suite checkout and always run.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect } from 'vitest';
import { classifyConformanceSupport } from '../cli/conformance-adapter.js';
import { OOXML, W } from '../primitives/namespaces.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { buildDocxFromBodyXml, paragraphWithText } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

// Named const (not an inline literal) so `scripts/validate_allure_test_labels.mjs`
// can map the `.openspec([XIMPL-*])` tags deterministically to a feature.
const TEST_FEATURE = 'Cross-Implementation Conformance Suite';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const liveSuiteTest = test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '11.3.3' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.15.3.4' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.31' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.36' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.29' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.34' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.38' },
);

const INTEGRATION_DIR = dirname(import.meta.url.replace('file://', ''));
const PROJECT_ROOT = join(INTEGRATION_DIR, '../../../..');
const ADAPTER_ENTRY = join(INTEGRATION_DIR, '../cli/conformance-adapter.ts');
const TSX_BIN = join(PROJECT_ROOT, 'node_modules/.bin/tsx');
const PIN_FILE = join(INTEGRATION_DIR, 'docx-platform-tests.pin.json');

const SUITE_DIR = process.env.DOCX_PLATFORM_TESTS_DIR ?? '';

interface SuiteAvailability {
  available: boolean;
  runnerTsx: string;
  skipWarning: string | null;
}

function resolveSuiteAvailability(suiteDir: string): SuiteAvailability {
  const runnerTsx = suiteDir ? join(suiteDir, 'runner/node_modules/.bin/tsx') : '';
  const available = suiteDir !== '' && existsSync(suiteDir) && existsSync(runnerTsx);
  return {
    available,
    runnerTsx,
    skipWarning: available
      ? null
      : '[cross-implementation-suite] SKIP: set DOCX_PLATFORM_TESTS_DIR to a ' +
        'docx-platform-tests checkout with runner dependencies installed ' +
        '(git clone open-agreements/docx-platform-tests && cd runner && npm ci).',
  };
}

interface SuiteResults {
  results: Array<{
    scenarioId: string;
    oracleKind: string;
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

interface ScenarioManifest {
  scenarioId: string;
  inputDocumentPath: string;
  operationDescriptor: TestOperationDescriptor;
}

const COMPATIBILITY_MODE_SCENARIO_ID = 'composeCompatibilityMode15WritesCompatSetting';
const CONTENT_CONTROL_SCENARIO_IDS = [
  'unrelatedTextEditPreservesInlineContentControlStructure',
  'unrelatedTextEditPreservesOpaqueInlineContentControl',
] as const;
const BLOCK_CONTENT_CONTROL_SCENARIO_IDS = [
  'unrelatedTextEditPreservesBlockContentControlStructure',
  'unrelatedTextEditPreservesOpaqueBlockContentControl',
] as const;
const EXPECTED_SUPPORTED_OPERATIONS: ReadonlySet<string> = new Set([
  'acceptAllTrackedChanges',
  'composeDocumentWithCompatibilityMode',
  'rejectAllTrackedChanges',
  'replaceFirstTextOccurrence',
]);

interface TestOperationDescriptor {
  operationName: string;
  bodyText?: unknown;
  compatibilityMode?: unknown;
}

interface ExpectedSupportDecision {
  supported: boolean;
  reason?: string;
}

interface ScenarioDefinition {
  operation: TestOperationDescriptor;
  inputPath: string;
}

function scenarioManifestPaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return scenarioManifestPaths(path);
    return entry.name === 'scenario.json' ? [path] : [];
  });
}

function loadScenarioDefinitions(suiteDir: string): Map<string, ScenarioDefinition> {
  return new Map(
    scenarioManifestPaths(join(suiteDir, 'scenarios')).map((path) => {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as ScenarioManifest;
      return [
        manifest.scenarioId,
        {
          operation: manifest.operationDescriptor,
          inputPath: join(dirname(path), manifest.inputDocumentPath),
        },
      ];
    }),
  );
}

async function inputHasTableRowRevision(inputPath: string, markerName: 'del' | 'ins'): Promise<boolean> {
  const documentXml = await readZipText(readFileSync(inputPath), 'word/document.xml');
  expect(documentXml, `${inputPath} has no word/document.xml`).not.toBeNull();
  const document = parseXml(documentXml!);
  return Array.from(document.getElementsByTagNameNS(OOXML.W_NS, W.tr)).some((row) =>
    Array.from(row.children).some(
      (child) =>
        child.namespaceURI === OOXML.W_NS &&
        child.localName === W.trPr &&
        Array.from(child.children).some(
          (property) => property.namespaceURI === OOXML.W_NS && property.localName === markerName,
        ),
    ),
  );
}

async function expectedScenarioSupport(
  definition: ScenarioDefinition,
): Promise<ExpectedSupportDecision> {
  const { operation } = definition;
  if (!EXPECTED_SUPPORTED_OPERATIONS.has(operation.operationName)) {
    return { supported: false, reason: 'operation is outside the test contract' };
  }
  if (operation.operationName === 'composeDocumentWithCompatibilityMode') {
    const validDescriptor =
      typeof operation.compatibilityMode === 'number' &&
      Number.isInteger(operation.compatibilityMode) &&
      operation.compatibilityMode === 15 &&
      typeof operation.bodyText === 'string';
    return validDescriptor
      ? { supported: true }
      : { supported: false, reason: 'compatibility descriptor is not supported mode-15 input' };
  }
  if (
    operation.operationName === 'acceptAllTrackedChanges' &&
    await inputHasTableRowRevision(definition.inputPath, 'del')
  ) {
    return { supported: false, reason: 'deleted table-row acceptance is outside the test contract' };
  }
  if (
    operation.operationName === 'rejectAllTrackedChanges' &&
    await inputHasTableRowRevision(definition.inputPath, 'ins')
  ) {
    return { supported: false, reason: 'inserted table-row rejection is outside the test contract' };
  }
  return { supported: true };
}

async function expectedScenarioDecisions(
  definitions: Map<string, ScenarioDefinition>,
): Promise<Map<string, ExpectedSupportDecision>> {
  return new Map(
    await Promise.all(
      [...definitions].map(async ([scenarioId, definition]) => [
        scenarioId,
        await expectedScenarioSupport(definition),
      ] as const),
    ),
  );
}

function outcomeMismatches(
  results: SuiteResults,
  definitions: Map<string, ScenarioDefinition>,
  decisions: Map<string, ExpectedSupportDecision>,
) {
  return results.results
    .map((scenario) => {
      const definition = definitions.get(scenario.scenarioId);
      const support = decisions.get(scenario.scenarioId);
      const outcome = scenario.outcomes['safe-docx'];
      let expectedStatuses = new Set<string>();
      if (definition && support) {
        if (!support.supported) {
          expectedStatuses = new Set(['unsupported']);
        } else if (scenario.oracleKind === 'ecma-conformance') {
          expectedStatuses = new Set(['pass', 'pass-divergent']);
        } else if (scenario.oracleKind === 'metamorphic-invariant') {
          expectedStatuses = new Set(['invariant-pass']);
        }
      }
      return {
        scenario,
        operationName: definition?.operation.operationName,
        outcome,
        expectedStatus: expectedStatuses.size > 0
          ? [...expectedStatuses].join(' or ')
          : 'a known scenario with an explicit support decision',
        matches: expectedStatuses.has(outcome?.status ?? ''),
      };
    })
    .filter(({ matches }) => !matches);
}

const { available: suiteAvailable, runnerTsx: RUNNER_TSX, skipWarning } =
  resolveSuiteAvailability(SUITE_DIR);
if (skipWarning) {
  console.warn(skipWarning);
}
const describeMaybe = suiteAvailable ? describe : describe.skip;

function pinMismatchWarning(pinnedCommitSha: string, actualSha: string): string | null {
  if (actualSha === pinnedCommitSha) return null;
  return `[cross-implementation-suite] suite checkout is at ${actualSha}, pinned ${pinnedCommitSha}; running anyway`;
}

function warnOnPinMismatch(): void {
  const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8')) as { pinnedCommitSha: string };
  const head = spawnSync('git', ['-C', SUITE_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const actualSha = head.status === 0 ? head.stdout.trim() : 'unknown';
  const warning = pinMismatchWarning(pin.pinnedCommitSha, actualSha);
  if (warning) {
    console.warn(warning);
  }
}

describeMaybe('Cross-implementation conformance suite self-check', () => {
  // coverage-rationale: one real runner invocation jointly proves checkout, revision behavior, compatibility mode, and honest outcome policy.
  liveSuiteTest
    .openspec('[XIMPL-01] Suite checkout present and safe-docx agrees')
    .openspec('[XIMPL-04] acceptAllTrackedChanges round-trip through the adapter')
    .openspec('[XIMPL-07] Compatibility mode generation validates and declines honestly')
    .openspec('[XIMPL-08] Supported and unsupported suite outcomes remain honest')
    .openspec('[XIMPL-09] Both neutral content-control scenarios pass at the reviewed pin')(
    'safe-docx adapter passes every docx-platform-tests scenario',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      const workDir = mkdtempSync(join(tmpdir(), 'ximpl-'));
      try {
        const registryPath = join(workDir, 'adapters.json');
        const resultsPath = join(workDir, 'results.json');
        let results: SuiteResults = { results: [] };
        let scenarioDefinitions = new Map<string, ScenarioDefinition>();
        let supportDecisions = new Map<string, ExpectedSupportDecision>();

        await given('a temp registry pointing the suite runner at the safe-docx adapter', async () => {
          warnOnPinMismatch();
          scenarioDefinitions = loadScenarioDefinitions(SUITE_DIR);
          supportDecisions = await expectedScenarioDecisions(scenarioDefinitions);
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

        await then('supported scenarios pass and unsupported operations remain explicit', async () => {
          expect(results.results.length).toBeGreaterThan(0);
          expect(results.results).toHaveLength(scenarioDefinitions.size);
          const mismatches = outcomeMismatches(results, scenarioDefinitions, supportDecisions);
          const detail = mismatches
            .map(
              ({ scenario, operationName, outcome, expectedStatus }) =>
                `${scenario.scenarioId} (${operationName ?? 'missing operation'}): ` +
                `expected ${expectedStatus}, got ${outcome?.status ?? 'missing'} ` +
                (outcome?.reason ?? '') +
                (outcome?.assertionResults ?? [])
                  .filter((a) => !a.passed)
                  .map((a) => `\n  ${a.assertionKind}: ${a.detail}`)
                  .join(''),
            )
            .join('\n');
          expect(mismatches.length, detail).toBe(0);
        });

        await then('the compatibility mode 15 scenario explicitly passes', async () => {
          const outcomes = new Map(
            results.results.map((scenario) => [scenario.scenarioId, scenario.outcomes['safe-docx']]),
          );
          expect(outcomes.get(COMPATIBILITY_MODE_SCENARIO_ID)?.status).toBe('pass');
        });

        await then('both ordinary content-control scenarios explicitly pass without implying rebuild coverage', async () => {
          const scenarios = new Map(
            results.results.map((scenario) => [scenario.scenarioId, scenario]),
          );
          const normative = scenarios.get(CONTENT_CONTROL_SCENARIO_IDS[0]);
          const metamorphic = scenarios.get(CONTENT_CONTROL_SCENARIO_IDS[1]);
          expect(normative?.oracleKind).toBe('ecma-conformance');
          expect(['pass', 'pass-divergent']).toContain(normative?.outcomes['safe-docx']?.status);
          expect(metamorphic?.oracleKind).toBe('metamorphic-invariant');
          expect(metamorphic?.outcomes['safe-docx']?.status).toBe('invariant-pass');
        });

        await then('both block content-control scenarios report only their oracle-specific pass statuses', async () => {
          const scenarios = new Map(
            results.results.map((scenario) => [scenario.scenarioId, scenario]),
          );
          const normative = scenarios.get(BLOCK_CONTENT_CONTROL_SCENARIO_IDS[0]);
          const metamorphic = scenarios.get(BLOCK_CONTENT_CONTROL_SCENARIO_IDS[1]);
          expect(normative?.oracleKind).toBe('ecma-conformance');
          expect(['pass', 'pass-divergent']).toContain(normative?.outcomes['safe-docx']?.status);
          expect(metamorphic?.oracleKind).toBe('metamorphic-invariant');
          expect(metamorphic?.outcomes['safe-docx']?.status).toBe('invariant-pass');
        });
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});

describe('Conformance adapter support classification', () => {
  test.openspec('[XIMPL-08] Supported and unsupported suite outcomes remain honest')(
    'renamed-equivalent table-row shapes stay unsupported while ordinary revisions stay supported',
    async ({ given, then }: AllureBddContext) => {
      let deletedRow!: Buffer;
      let insertedRow!: Buffer;
      let ordinary!: Buffer;

      await given('input packages classified only by their OOXML shape', async () => {
        const row = (marker: 'del' | 'ins') =>
          `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid>` +
          `<w:tr><w:trPr><w:${marker} w:id="7" w:author="Reviewer"/></w:trPr>` +
          `<w:tc><w:tcPr/><w:p><w:r><w:t>Renamed equivalent</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
        deletedRow = await buildDocxFromBodyXml(row('del'));
        insertedRow = await buildDocxFromBodyXml(row('ins'));
        ordinary = await buildDocxFromBodyXml(paragraphWithText('Ordinary revision input'));
      });

      await then('support follows operation plus row-property markers, never a scenario ID', async () => {
        await expect(
          classifyConformanceSupport({ operationName: 'acceptAllTrackedChanges' }, deletedRow),
        ).resolves.toMatchObject({ supported: false });
        await expect(
          classifyConformanceSupport({ operationName: 'rejectAllTrackedChanges' }, insertedRow),
        ).resolves.toMatchObject({ supported: false });
        await expect(
          classifyConformanceSupport({ operationName: 'acceptAllTrackedChanges' }, ordinary),
        ).resolves.toEqual({ supported: true });
        await expect(
          classifyConformanceSupport({ operationName: 'rejectAllTrackedChanges' }, ordinary),
        ).resolves.toEqual({ supported: true });
        await expect(
          classifyConformanceSupport({ operationName: 'rejectAllTrackedChanges' }, deletedRow),
        ).resolves.toEqual({ supported: true });
        await expect(
          classifyConformanceSupport({ operationName: 'acceptAllTrackedChanges' }, insertedRow),
        ).resolves.toEqual({ supported: true });
      });
    },
  );

  test.openspec('[XIMPL-08] Supported and unsupported suite outcomes remain honest')(
    'the independent oracle catches a simulated production support regression',
    async ({ given, then }: AllureBddContext) => {
      let definitions!: Map<string, ScenarioDefinition>;
      let decisions!: Map<string, ExpectedSupportDecision>;

      await given('an ordinary replace scenario that the test contract independently supports', async () => {
        definitions = new Map([
          ['renamedEquivalentReplace', {
            operation: { operationName: 'replaceFirstTextOccurrence' },
            inputPath: 'unused-for-replace-operation.docx',
          }],
        ]);
        decisions = await expectedScenarioDecisions(definitions);
      });

      await then('a simulated production unsupported outcome is reported as a mismatch', async () => {
        const results: SuiteResults = {
          results: [{
            scenarioId: 'renamedEquivalentReplace',
            oracleKind: 'ecma-conformance',
            outcomes: { 'safe-docx': { status: 'unsupported', reason: 'simulated narrowing' } },
          }],
        };
        expect(decisions.get('renamedEquivalentReplace')).toEqual({ supported: true });
        expect(outcomeMismatches(results, definitions, decisions)).toHaveLength(1);
      });
    },
  );

  test.openspec('[XIMPL-08] Supported and unsupported suite outcomes remain honest')(
    'oracle classes reject cross-class pass statuses and errors cannot masquerade as unsupported',
    async ({ then }: AllureBddContext) => {
      const definitions = new Map<string, ScenarioDefinition>([
        ['normative', { operation: { operationName: 'replaceFirstTextOccurrence' }, inputPath: 'unused' }],
        ['metamorphic', { operation: { operationName: 'replaceFirstTextOccurrence' }, inputPath: 'unused' }],
        ['unknown-oracle', { operation: { operationName: 'replaceFirstTextOccurrence' }, inputPath: 'unused' }],
        ['unsupported', { operation: { operationName: 'unknownOperation' }, inputPath: 'unused' }],
      ]);
      const decisions = await expectedScenarioDecisions(definitions);

      await then('each wrong-class or error outcome is reported as a mismatch', () => {
        const results: SuiteResults = {
          results: [
            {
              scenarioId: 'normative',
              oracleKind: 'ecma-conformance',
              outcomes: { 'safe-docx': { status: 'invariant-pass' } },
            },
            {
              scenarioId: 'metamorphic',
              oracleKind: 'metamorphic-invariant',
              outcomes: { 'safe-docx': { status: 'pass' } },
            },
            {
              scenarioId: 'unknown-oracle',
              oracleKind: 'future-oracle',
              outcomes: { 'safe-docx': { status: 'pass' } },
            },
            {
              scenarioId: 'unsupported',
              oracleKind: 'ecma-conformance',
              outcomes: { 'safe-docx': { status: 'error', reason: 'simulated adapter error' } },
            },
          ],
        };
        expect(outcomeMismatches(results, definitions, decisions)).toHaveLength(4);
      });
    },
  );
});

describe('Suite gating behavior', () => {
  test.openspec('[XIMPL-02] Suite checkout absent')(
    'an unset or missing DOCX_PLATFORM_TESTS_DIR resolves to skip with a logged warning',
    async ({ given, when, then }: AllureBddContext) => {
      let removedCheckout = '';
      let unsetResolution: SuiteAvailability;
      let missingResolution: SuiteAvailability;

      await given('a deleted directory that is guaranteed not to exist', async () => {
        removedCheckout = mkdtempSync(join(tmpdir(), 'ximpl-absent-'));
        rmSync(removedCheckout, { recursive: true, force: true });
        expect(existsSync(removedCheckout)).toBe(false);
      });

      await when('availability is resolved for an unset and for a missing checkout', async () => {
        unsetResolution = resolveSuiteAvailability('');
        missingResolution = resolveSuiteAvailability(removedCheckout);
      });

      await then('both resolve unavailable with a warning naming the env variable', async () => {
        for (const resolution of [unsetResolution!, missingResolution!]) {
          expect(resolution.available).toBe(false);
          expect(resolution.skipWarning).toContain('SKIP');
          expect(resolution.skipWarning).toContain('DOCX_PLATFORM_TESTS_DIR');
        }
      });
    },
  );

  test.openspec('[XIMPL-03] Checkout ahead of the pin')(
    'a checkout SHA differing from the pin warns naming both SHAs and does not abort',
    async ({ given, when, then }: AllureBddContext) => {
      let pinnedSha = '';
      let warning: string | null = null;

      await given('the committed pin file', async () => {
        pinnedSha = (JSON.parse(readFileSync(PIN_FILE, 'utf8')) as { pinnedCommitSha: string })
          .pinnedCommitSha;
        expect(pinnedSha).toMatch(/^[0-9a-f]{40}$/);
      });

      await when('the pin check sees a checkout at a different SHA', async () => {
        warning = pinMismatchWarning(pinnedSha, 'f'.repeat(40));
      });

      await then('it returns a warning naming both SHAs and stays silent on a match', async () => {
        expect(warning).toContain(pinnedSha);
        expect(warning).toContain('f'.repeat(40));
        expect(warning).toContain('running anyway');
        expect(pinMismatchWarning(pinnedSha, pinnedSha)).toBeNull();
      });
    },
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

  test.openspec('[XIMPL-07] Compatibility mode generation validates and declines honestly')(
    'compatibility mode generation rejects malformed descriptors and declines unsupported modes',
    async ({ given, when, then }: AllureBddContext) => {
      const workDir = mkdtempSync(join(tmpdir(), 'ximpl-compat-proto-'));
      try {
        const operationPath = join(workDir, 'operation.json');
        const outputPath = join(workDir, 'output.docx');
        let malformed!: SpawnSyncReturns<string>;
        let invalidBody!: SpawnSyncReturns<string>;
        let unsupported!: SpawnSyncReturns<string>;

        await given('malformed and unsupported compatibility mode descriptors', async () => {});

        await when('the adapter receives a nonnumeric mode and then mode 14', async () => {
          writeFileSync(
            operationPath,
            JSON.stringify({
              operationName: 'composeDocumentWithCompatibilityMode',
              compatibilityMode: '15',
              bodyText: 'Invalid mode type',
            }),
          );
          malformed = spawnSync(
            TSX_BIN,
            [
              ADAPTER_ENTRY,
              '--protocol-version', '1',
              '--operation', operationPath,
              '--input', join(workDir, 'unused.docx'),
              '--output', outputPath,
            ],
            { encoding: 'utf8', timeout: 60_000 },
          );

          writeFileSync(
            operationPath,
            JSON.stringify({
              operationName: 'composeDocumentWithCompatibilityMode',
              compatibilityMode: 15,
              bodyText: 15,
            }),
          );
          invalidBody = spawnSync(
            TSX_BIN,
            [
              ADAPTER_ENTRY,
              '--protocol-version', '1',
              '--operation', operationPath,
              '--input', join(workDir, 'unused.docx'),
              '--output', outputPath,
            ],
            { encoding: 'utf8', timeout: 60_000 },
          );

          writeFileSync(
            operationPath,
            JSON.stringify({
              operationName: 'composeDocumentWithCompatibilityMode',
              compatibilityMode: 14,
              bodyText: 'Unsupported mode',
            }),
          );
          unsupported = spawnSync(
            TSX_BIN,
            [
              ADAPTER_ENTRY,
              '--protocol-version', '1',
              '--operation', operationPath,
              '--input', join(workDir, 'unused.docx'),
              '--output', outputPath,
            ],
            { encoding: 'utf8', timeout: 60_000 },
          );
        });

        await then('malformed inputs exit 1 and unsupported mode exits 2 without output', async () => {
          expect(malformed.status, malformed.stderr).toBe(1);
          expect(malformed.stderr).toContain('integer compatibilityMode');
          expect(invalidBody.status, invalidBody.stderr).toBe(1);
          expect(invalidBody.stderr).toContain('string bodyText');
          expect(unsupported.status, unsupported.stderr).toBe(2);
          expect(unsupported.stdout).toContain('only implements compatibilityMode 15');
          expect(existsSync(outputPath)).toBe(false);
        });
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
    120_000,
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
