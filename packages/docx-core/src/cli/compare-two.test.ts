import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { parseCompareCliArgs, runCompareCli } from './compare-two.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'CLI Compare Two' });

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
          reconstructionMode: 'rebuild',
          author: 'Comparison',
          premergeRuns: true,
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
        '--engine',
        'atomizer',
        '--mode',
        'inplace',
        '--author',
        'Junior',
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
