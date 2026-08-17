import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect } from 'vitest';
import { DEFAULT_RECONSTRUCTION_MODE } from '../comparison-defaults.js';
import type { CompareResult } from '../compare-types.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { parseCompareCliArgs, runCompareCli } from './compare-two.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'CLI Compare Two' });

const zeroStats = {
  insertions: 0,
  deletions: 0,
  modifications: 0,
  insertedRanges: 0,
  deletedRanges: 0,
  insertedAtoms: 0,
  deletedAtoms: 0,
  modifiedParagraphs: 0,
  formatChanges: 0,
  formatChangeAtoms: 0,
};

const trackedTempDirs: string[] = [];

async function createTempPair(prefix: string): Promise<{
  dir: string;
  originalPath: string;
  revisedPath: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  trackedTempDirs.push(dir);
  const originalPath = join(dir, 'original.docx');
  const revisedPath = join(dir, 'revised.docx');
  await Promise.all([
    writeFile(originalPath, 'original-bytes'),
    writeFile(revisedPath, 'revised-bytes'),
  ]);
  return { dir, originalPath, revisedPath };
}

afterAll(async () => {
  await Promise.all(trackedTempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('docx-comparison CLI argument parsing', () => {
  test('parses minimal positional arguments with defaults', async ({ given, then }: AllureBddContext) => {
    let parsed: ReturnType<typeof parseCompareCliArgs>;

    await given('only original and revised inputs', () => {
      parsed = parseCompareCliArgs(['original.docx', 'revised.docx']);
    });

    await then('defaults are applied for compare options', () => {
      expect(parsed!).toEqual({
        originalPath: 'original.docx',
        revisedPath: 'revised.docx',
        outputPath: undefined,
        options: {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
          author: 'Comparison',
          premergeRuns: true,
          comparisonStrategy: 'tagged-tree',
        },
      });
    });

    await then('the CLI default is the shared front-door default', () => {
      expect(parsed!.options.reconstructionMode).toBe(DEFAULT_RECONSTRUCTION_MODE);
    });
  });

  test('parses explicit output and option overrides', async ({ given, then }: AllureBddContext) => {
    let parsed: ReturnType<typeof parseCompareCliArgs>;

    await given('compare arguments with explicit flags', () => {
      parsed = parseCompareCliArgs([
        'a.docx',
        'b.docx',
        'out.docx',
        '--engine',
        'atomizer',
        '--mode',
        'inplace',
        '--author',
        'Junior',
        '--comparison-strategy',
        'tagged-tree',
        '--premerge-runs',
        'true',
      ]);
    });

    await then('parser returns the requested override values', () => {
      expect(parsed!).toEqual({
        originalPath: 'a.docx',
        revisedPath: 'b.docx',
        outputPath: 'out.docx',
        options: {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
          author: 'Junior',
          premergeRuns: true,
          comparisonStrategy: 'tagged-tree',
        },
      });
    });
  });

  test('returns help payload when help flag is provided', async ({ when, then }: AllureBddContext) => {
    let result: Awaited<ReturnType<typeof runCompareCli>>;

    await when('--help is passed to the compare CLI', async () => {
      result = await runCompareCli(['--help']);
    });

    await then('CLI responds with usage help text', () => {
      expect(result!).toEqual(
        expect.objectContaining({
          help: true,
        }),
      );
      if ('help' in result! && result!.help) {
        expect(result!.text).toContain('Usage: docx-comparison');
      }
    });
  });

  test('rejects unsupported option names', async ({ when }: AllureBddContext) => {
    await when('an unsupported option is passed', () => {
      expect(() => parseCompareCliArgs(['a.docx', 'b.docx', '--unknown', 'x'])).toThrow('Unknown option: --unknown');
    });
  });
});

describe('docx-comparison CLI mode reporting', () => {
  function comparisonResult(overrides: Partial<CompareResult>): CompareResult {
    return {
      document: Buffer.from('redline-bytes'),
      stats: zeroStats,
      engine: 'atomizer',
      ...overrides,
    };
  }

  test('reports the mode actually used and the fallback reason on inplace fallback', async ({
    when,
    then,
    and,
  }: AllureBddContext) => {
    const { originalPath, revisedPath } = await createTempPair('docx-comparison-fallback-');

    let requestedMode: string | undefined;
    let requestedStrategy: string | undefined;
    const result = await when('inplace is requested but the pipeline falls back to rebuild', () =>
      runCompareCli([
        originalPath,
        revisedPath,
        '--mode',
        'inplace',
        '--comparison-strategy',
        'legacy',
      ], {
        compare: async (_original, _revised, options) => {
          requestedMode = options?.reconstructionMode;
          requestedStrategy = options?.comparisonStrategy;
          return comparisonResult({
            reconstructionModeRequested: 'inplace',
            reconstructionModeUsed: 'rebuild',
            fallbackReason: 'round_trip_safety_check_failed',
          });
        },
      }),
    );

    await then('requested mode, actual mode, and fallback reason are reported separately', async () => {
      if ('help' in result && result.help) throw new Error('expected a run result');
      expect(result.mode).toBe('rebuild');
      expect(result.mode_requested).toBe('inplace');
      expect(result.fallback_reason).toBe('round_trip_safety_check_failed');
      expect(await readFile(result.output, 'utf8')).toBe('redline-bytes');
    });

    await and('the CLI forwarded the requested mode to the engine', () => {
      expect(requestedMode).toBe('inplace');
      expect(requestedStrategy).toBe('legacy');
    });
  });

  test('forwards tagged-tree when no strategy override is supplied', async ({ when, then }: AllureBddContext) => {
    const { originalPath, revisedPath } = await createTempPair('docx-comparison-default-strategy-');
    let requestedStrategy: string | undefined;

    await when('the CLI runs with its default options', () =>
      runCompareCli([originalPath, revisedPath], {
        compare: async (_original, _revised, options) => {
          requestedStrategy = options?.comparisonStrategy;
          return comparisonResult({
            reconstructionModeRequested: 'inplace',
            reconstructionModeUsed: 'inplace',
          });
        },
      }),
    );

    await then('the public default is forwarded explicitly', () => {
      expect(requestedStrategy).toBe('tagged-tree');
    });
  });

  test('reports the shared default as both requested and used when no fallback occurs', async ({
    when,
    then,
  }: AllureBddContext) => {
    const { dir, originalPath, revisedPath } = await createTempPair('docx-comparison-default-');

    const result = await when('the CLI runs without an explicit mode', () =>
      runCompareCli([originalPath, revisedPath], {
        compare: async (_original, _revised, options) =>
          comparisonResult({
            reconstructionModeRequested: options?.reconstructionMode as 'inplace' | 'rebuild',
            reconstructionModeUsed: options?.reconstructionMode as 'inplace' | 'rebuild',
          }),
      }),
    );

    await then('the shared default flows through requested mode, actual mode, and output name', () => {
      if ('help' in result && result.help) throw new Error('expected a run result');
      expect(result.mode_requested).toBe(DEFAULT_RECONSTRUCTION_MODE);
      expect(result.mode).toBe(DEFAULT_RECONSTRUCTION_MODE);
      expect(result.fallback_reason).toBeUndefined();
      expect(result.output).toBe(
        join(dir, `revised.REDLINE.atomizer.${DEFAULT_RECONSTRUCTION_MODE}.docx`),
      );
    });
  });
});
