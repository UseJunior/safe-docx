import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect } from 'vitest';
import type { CompareResult } from '../compare-types.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { buildDocxWithDefaultFooter } from '../testing/footer-story-fixture.js';
import { parseCompareCliArgs, runCompareCli } from './compare-two.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'CLI Compare Two' });

const zeroStats = {
  atomMetricVersion: 'tagged-token-v1' as const,
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
          author: 'Comparison',
        },
      });
    });
  });

  test('parses explicit output and option overrides', async ({ given, then }: AllureBddContext) => {
    let parsed: ReturnType<typeof parseCompareCliArgs>;

    await given('compare arguments with explicit flags', () => {
      parsed = parseCompareCliArgs([
        'a.docx',
        'b.docx',
        'out.docx',
        '--author',
        'Junior',
      ]);
    });

    await then('parser returns the requested override values', () => {
      expect(parsed!).toEqual({
        originalPath: 'a.docx',
        revisedPath: 'b.docx',
        outputPath: 'out.docx',
        options: {
          author: 'Junior',
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
    await when('an unsupported or retired option is passed', () => {
      for (const option of [
        '--unknown',
        '--engine',
        '--mode',
        '--comparison-strategy',
        '--premerge-runs',
        '--max-word-refinement-change-ranges',
      ]) {
        expect(() => parseCompareCliArgs(['a.docx', 'b.docx', option, 'x']))
          .toThrow(`Unknown option: ${option}`);
      }
    });
  });
});

describe('docx-comparison CLI fixed tagged publication', () => {
  function comparisonResult(overrides: Partial<CompareResult>): CompareResult {
    return {
      document: Buffer.from('redline-bytes'),
      stats: zeroStats,
      engine: 'tagged-tree',
      ...overrides,
    };
  }

  test('forwards only author and reports revised package provenance', async ({
    when,
    then,
    and,
  }: AllureBddContext) => {
    const { dir, originalPath, revisedPath } = await createTempPair('docx-comparison-fixed-');
    let receivedOptions: unknown;

    const result = await when('the CLI runs with the retained author option', () =>
      runCompareCli([originalPath, revisedPath, '--author', 'Junior'], {
        compare: async (_original, _revised, options) => {
          receivedOptions = options;
          return comparisonResult({});
        },
      }),
    );

    await then('only the retained author option reaches the public comparison API', () => {
      expect(receivedOptions).toEqual({ author: 'Junior' });
    });
    await and('the output names and reports the fixed revised package base', async () => {
      if ('help' in result && result.help) throw new Error('expected a run result');
      expect(result.package_base).toBe('revised');
      expect(result.output).toBe(join(dir, 'revised.REDLINE.docx'));
      expect(await readFile(result.output, 'utf8')).toBe('redline-bytes');
    });
    await and('a fully represented comparison carries no unrepresented-change fields', () => {
      expect(result).not.toHaveProperty('unrepresented_changes');
      expect(result).not.toHaveProperty('warnings');
    });
  });
});

describe('docx-comparison CLI unrepresented changes (#1029)', () => {
  test('reports a removed footer as unrepresented_changes plus a warning', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    const dir = await mkdtemp(join(tmpdir(), 'docx-comparison-unrepresented-'));
    trackedTempDirs.push(dir);
    const originalPath = join(dir, 'original.docx');
    const revisedPath = join(dir, 'revised.docx');

    await given('an original with a default footer and a revision that removes it', async () => {
      await Promise.all([
        writeFile(originalPath, await buildDocxWithDefaultFooter('Body text', 'Confidential')),
        writeFile(revisedPath, await buildDocxWithDefaultFooter('Body text, revised', null)),
      ]);
    });

    const result = await when('the real comparison runs through the CLI', () =>
      runCompareCli([originalPath, revisedPath]),
    );
    if ('help' in result && result.help) throw new Error('expected a run result');

    await then('the structured unrepresented change reaches the caller', () => {
      expect(result.unrepresented_changes).toEqual([
        { scope: 'footer', kind: 'removed', sectionIndex: 0, role: 'default' },
      ]);
    });
    await and('a human-readable warning names the unrepresented part', () => {
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('removed default footer in section 1');
      expect(result.warnings![0]).toContain('no tracked-change markup');
    });
    await and('the redline still carries the represented body change', () => {
      const stats = result.stats as { insertions: number; deletions: number };
      expect(stats.insertions + stats.deletions).toBeGreaterThan(0);
    });
  });
});
