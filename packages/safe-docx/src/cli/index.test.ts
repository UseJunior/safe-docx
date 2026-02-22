import { describe, expect, vi } from 'vitest';
import { allureStep } from '../testing/allure-test.js';
import { createProgram } from './index.js';
import type { CompareCommandArgs } from './commands/compare.js';

describe('safe-docx CLI routing', () => {
  it('defaults to serve command when no subcommand is provided', async () => {
    const serve = vi.fn(async () => undefined);
    const compare = vi.fn(async () => ({
      output: '/tmp/out.docx',
      engine: 'atomizer',
      mode: 'rebuild' as const,
      bytes: 12,
      stats: {},
    }));

    const output: string[] = [];

    await allureStep('Given a CLI program with injected handlers', async () => {
      const program = createProgram({
        serve,
        compare,
        write: (line) => output.push(line),
      });

      await allureStep('When parseAsync is invoked without extra args', async () => {
        await program.parseAsync(['node', 'safe-docx']);
      });
    });

    await allureStep('Then serve is invoked and compare is not called', async () => {
      expect(serve).toHaveBeenCalledTimes(1);
      expect(compare).not.toHaveBeenCalled();
      expect(output).toEqual([]);
    });
  });

  it('routes compare command with parsed options', async () => {
    const serve = vi.fn(async () => undefined);
    const compare = vi.fn(async (args: CompareCommandArgs) => ({
      output: args.outputPath ?? '/tmp/default.docx',
      engine: args.engine ?? 'atomizer',
      mode: (args.mode as 'inplace' | 'rebuild') ?? 'rebuild',
      bytes: 99,
      stats: { ok: true },
    }));

    const output: string[] = [];
    const program = createProgram({
      serve,
      compare,
      write: (line) => output.push(line),
    });

    await allureStep('Given compare command argv with explicit options', async () => {
      await program.parseAsync([
        'node',
        'safe-docx',
        'compare',
        'original.docx',
        'revised.docx',
        'result.docx',
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

    await allureStep('Then compare handler receives normalized argument values', async () => {
      expect(compare).toHaveBeenCalledTimes(1);
      expect(compare).toHaveBeenCalledWith({
        originalPath: 'original.docx',
        revisedPath: 'revised.docx',
        outputPath: 'result.docx',
        engine: 'diffmatch',
        mode: 'inplace',
        author: 'Junior',
        premergeRuns: true,
      });
      expect(serve).not.toHaveBeenCalled();
      expect(output).toHaveLength(1);
      expect(output[0]).toContain('"output":"result.docx"');
    });
  });

  it('shows help text and does not invoke command handlers', async () => {
    const serve = vi.fn(async () => undefined);
    const compare = vi.fn(async () => ({
      output: '/tmp/out.docx',
      engine: 'atomizer',
      mode: 'rebuild' as const,
      bytes: 1,
      stats: {},
    }));

    const output: string[] = [];
    const program = createProgram({
      serve,
      compare,
      write: (line) => output.push(line),
    });

    await allureStep('When help is requested', async () => {
      await program.parseAsync(['node', 'safe-docx', '--help']);
    });

    await allureStep('Then CLI help is emitted and no handler executes', async () => {
      expect(output).toHaveLength(1);
      expect(output[0]).toContain('safe-docx CLI');
      expect(output[0]).toContain('compare <original> <revised> [output]');
      expect(serve).not.toHaveBeenCalled();
      expect(compare).not.toHaveBeenCalled();
    });
  });

  it('rejects unknown commands with actionable message', async () => {
    const program = createProgram({
      serve: vi.fn(async () => undefined),
      compare: vi.fn(async () => ({
        output: '/tmp/out.docx',
        engine: 'atomizer',
        mode: 'rebuild' as const,
        bytes: 1,
        stats: {},
      })),
      write: () => undefined,
    });

    await allureStep('When an unsupported command is passed', async () => {
      await expect(program.parseAsync(['node', 'safe-docx', 'unknown'])).rejects.toThrow(
        'Unknown command: unknown. Use --help to see available commands.',
      );
    });
  });
});
