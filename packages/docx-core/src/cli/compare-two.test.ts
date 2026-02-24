import { describe, expect } from 'vitest';
import { itAllure as it, allureStep } from '../testing/allure-test.js';
import { parseCompareCliArgs, runCompareCli } from './compare-two.js';

describe('docx-comparison CLI argument parsing', () => {
  it('parses minimal positional arguments with defaults', async () => {
    let parsed: ReturnType<typeof parseCompareCliArgs>;

    await allureStep('Given only original and revised inputs', async () => {
      parsed = parseCompareCliArgs(['original.docx', 'revised.docx']);
    });

    await allureStep('Then defaults are applied for compare options', async () => {
      expect(parsed!).toEqual({
        originalPath: 'original.docx',
        revisedPath: 'revised.docx',
        outputPath: undefined,
        options: {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
          author: 'Comparison',
          premergeRuns: false,
        },
      });
    });
  });

  it('parses explicit output and option overrides', async () => {
    let parsed: ReturnType<typeof parseCompareCliArgs>;

    await allureStep('Given compare arguments with explicit flags', async () => {
      parsed = parseCompareCliArgs([
        'a.docx',
        'b.docx',
        'out.docx',
        '--engine',
        'diffmatch',
        '--mode',
        'inplace',
        '--author',
        'Junior',
        '--premerge-runs',
        'true',
      ]);
    });

    await allureStep('Then parser returns the requested override values', async () => {
      expect(parsed!).toEqual({
        originalPath: 'a.docx',
        revisedPath: 'b.docx',
        outputPath: 'out.docx',
        options: {
          engine: 'diffmatch',
          reconstructionMode: 'inplace',
          author: 'Junior',
          premergeRuns: true,
        },
      });
    });
  });

  it('returns help payload when help flag is provided', async () => {
    let result: Awaited<ReturnType<typeof runCompareCli>>;

    await allureStep('When --help is passed to the compare CLI', async () => {
      result = await runCompareCli(['--help']);
    });

    await allureStep('Then CLI responds with usage help text', async () => {
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

  it('rejects unsupported option names', async () => {
    await allureStep('When an unsupported option is passed', async () => {
      expect(() => parseCompareCliArgs(['a.docx', 'b.docx', '--unknown', 'x'])).toThrow('Unknown option: --unknown');
    });
  });
});
