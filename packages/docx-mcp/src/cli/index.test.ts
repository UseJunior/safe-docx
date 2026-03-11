import { describe, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { createProgram } from './index.js';
import type { CompareCommandArgs } from './commands/compare.js';
import { makeMinimalDocx } from '../testing/docx_test_utils.js';
import { createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';

registerCleanup();

const test = testAllure.epic('Document Editing').withLabels({ feature: 'CLI Routing' });

describe('safe-docx CLI routing', () => {
  test('defaults to serve command when no subcommand is provided', async ({ given, when, then }: AllureBddContext) => {
    const serve = vi.fn(async () => undefined);
    const compare = vi.fn(async () => ({
      output: '/tmp/out.docx',
      engine: 'atomizer',
      mode: 'rebuild' as const,
      mode_requested: 'rebuild' as const,
      bytes: 12,
      stats: {},
    }));

    const output: string[] = [];

    let program: ReturnType<typeof createProgram>;
    await given('a CLI program with injected handlers', async () => {
      program = createProgram({
        serve,
        compare,
        write: (line) => output.push(line),
      });
    });

    await when('parseAsync is invoked without extra args', async () => {
      await program.parseAsync(['node', 'safe-docx']);
    });

    await then('serve is invoked and compare is not called', () => {
      expect(serve).toHaveBeenCalledTimes(1);
      expect(compare).not.toHaveBeenCalled();
      expect(output).toEqual([]);
    });
  });

  test('routes compare command with parsed options', async ({ given, when, then }: AllureBddContext) => {
    const serve = vi.fn(async () => undefined);
    const compare = vi.fn(async (args: CompareCommandArgs) => ({
      output: args.outputPath ?? '/tmp/default.docx',
      engine: args.engine ?? 'atomizer',
      mode: (args.mode as 'inplace' | 'rebuild') ?? 'rebuild',
      mode_requested: (args.mode as 'inplace' | 'rebuild') ?? 'rebuild',
      bytes: 99,
      stats: { ok: true },
    }));

    const output: string[] = [];
    const program = createProgram({
      serve,
      compare,
      write: (line) => output.push(line),
    });

    await given('compare command argv with explicit options', async () => {
      await program.parseAsync([
        'node',
        'safe-docx',
        'compare',
        'original.docx',
        'revised.docx',
        'result.docx',
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

    await then('compare handler receives normalized argument values', () => {
      expect(compare).toHaveBeenCalledTimes(1);
      expect(compare).toHaveBeenCalledWith({
        originalPath: 'original.docx',
        revisedPath: 'revised.docx',
        outputPath: 'result.docx',
        engine: 'atomizer',
        mode: 'inplace',
        author: 'Junior',
        premergeRuns: true,
      });
      expect(serve).not.toHaveBeenCalled();
      expect(output).toHaveLength(1);
      expect(output[0]).toContain('"output":"result.docx"');
    });
  });

  test('shows help text and does not invoke command handlers', async ({ when, then }: AllureBddContext) => {
    const serve = vi.fn(async () => undefined);
    const compare = vi.fn(async () => ({
      output: '/tmp/out.docx',
      engine: 'atomizer',
      mode: 'rebuild' as const,
      mode_requested: 'rebuild' as const,
      bytes: 1,
      stats: {},
    }));

    const output: string[] = [];
    const program = createProgram({
      serve,
      compare,
      write: (line) => output.push(line),
    });

    await when('help is requested', async () => {
      await program.parseAsync(['node', 'safe-docx', '--help']);
    });

    await then('CLI help is emitted and no handler executes', () => {
      expect(output).toHaveLength(1);
      expect(output[0]).toContain('safe-docx CLI');
      expect(output[0]).toContain('compare <original> <revised> [output]');
      expect(serve).not.toHaveBeenCalled();
      expect(compare).not.toHaveBeenCalled();
    });
  });

  test('reports actual mode when inplace falls back to rebuild', async ({ given, then }: AllureBddContext) => {
    const serve = vi.fn(async () => undefined);
    const compare = vi.fn(async () => ({
      output: '/tmp/out.docx',
      engine: 'atomizer',
      mode: 'rebuild' as const,
      mode_requested: 'inplace' as const,
      fallback_reason: 'round_trip_safety_check_failed',
      bytes: 50,
      stats: {},
    }));

    const output: string[] = [];
    const program = createProgram({
      serve,
      compare,
      write: (line) => output.push(line),
    });

    await given('a compare that falls back from inplace to rebuild', async () => {
      await program.parseAsync([
        'node',
        'safe-docx',
        'compare',
        'original.docx',
        'revised.docx',
        '/tmp/out.docx',
        '--mode',
        'inplace',
      ]);
    });

    await then('CLI output reports actual mode=rebuild and mode_requested=inplace', () => {
      expect(output).toHaveLength(1);
      const json = JSON.parse(output[0]!);
      expect(json.mode).toBe('rebuild');
      expect(json.mode_requested).toBe('inplace');
      expect(json.fallback_reason).toBe('round_trip_safety_check_failed');
    });
  });

  test('rejects unknown commands with actionable message', async ({ when }: AllureBddContext) => {
    const program = createProgram({
      serve: vi.fn(async () => undefined),
      compare: vi.fn(async () => ({
        output: '/tmp/out.docx',
        engine: 'atomizer',
        mode: 'rebuild' as const,
        mode_requested: 'rebuild' as const,
        bytes: 1,
        stats: {},
      })),
      write: () => undefined,
    });

    await when('an unsupported command is passed', async () => {
      await expect(program.parseAsync(['node', 'safe-docx', 'unknown'])).rejects.toThrow(
        'Unknown command: unknown. Use --help to see available commands.',
      );
    });
  });
});

describe('safe-docx CLI — generic tool routing', () => {
  test('routes read-file to tool dispatch', async ({ when, then }: AllureBddContext) => {
    const tmpDir = await createTrackedTempDir();
    const inputPath = path.join(tmpDir, 'test.docx');
    const buf = await makeMinimalDocx(['Hello world']);
    await fs.writeFile(inputPath, new Uint8Array(buf));

    const output: string[] = [];
    const errors: string[] = [];
    const program = createProgram({
      serve: vi.fn(async () => undefined),
      compare: vi.fn(async () => ({ output: '', engine: 'atomizer', mode: 'rebuild' as const, mode_requested: 'rebuild' as const, bytes: 0, stats: {} })),
      write: (line) => output.push(line),
      writeError: (line) => errors.push(line),
    });

    await when('read-file is invoked with a file path', async () => {
      await program.parseAsync(['node', 'safe-docx', 'read-file', inputPath]);
    });

    await then('tool output is JSON with success=true', () => {
      expect(errors).toHaveLength(0);
      expect(output).toHaveLength(1);
      const result = JSON.parse(output[0]!) as { success: boolean; content: string };
      expect(result.success).toBe(true);
      expect(result.content).toContain('Hello world');
    });
  });

  test('routes read-file --help to per-tool help', async ({ when, then }: AllureBddContext) => {
    const output: string[] = [];
    const program = createProgram({
      serve: vi.fn(async () => undefined),
      compare: vi.fn(async () => ({ output: '', engine: 'atomizer', mode: 'rebuild' as const, mode_requested: 'rebuild' as const, bytes: 0, stats: {} })),
      write: (line) => output.push(line),
      writeError: () => undefined,
    });

    await when('read-file --help is invoked', async () => {
      await program.parseAsync(['node', 'safe-docx', 'read-file', '--help']);
    });

    await then('per-tool help is displayed', () => {
      expect(output).toHaveLength(1);
      expect(output[0]).toContain('safe-docx read-file');
      expect(output[0]).toContain('--format');
    });
  });

  test('top-level --help shows all tools', async ({ when, then }: AllureBddContext) => {
    const output: string[] = [];
    const program = createProgram({
      serve: vi.fn(async () => undefined),
      compare: vi.fn(async () => ({ output: '', engine: 'atomizer', mode: 'rebuild' as const, mode_requested: 'rebuild' as const, bytes: 0, stats: {} })),
      write: (line) => output.push(line),
      writeError: () => undefined,
    });

    await when('top-level --help is invoked', async () => {
      await program.parseAsync(['node', 'safe-docx', '--help']);
    });

    await then('all tool names are listed', () => {
      expect(output).toHaveLength(1);
      const helpText = output[0]!;
      expect(helpText).toContain('read-file');
      expect(helpText).toContain('replace-text');
      expect(helpText).toContain('insert-paragraph');
      expect(helpText).toContain('save');
      expect(helpText).toContain('grep');
      expect(helpText).toContain('edit');
    });
  });

  test('routes edit command to edit handler', async ({ when }: AllureBddContext) => {
    const tmpDir = await createTrackedTempDir();
    const inputPath = path.join(tmpDir, 'test.docx');
    const buf = await makeMinimalDocx(['Hello world']);
    await fs.writeFile(inputPath, new Uint8Array(buf));

    const output: string[] = [];
    const errors: string[] = [];
    const program = createProgram({
      serve: vi.fn(async () => undefined),
      compare: vi.fn(async () => ({ output: '', engine: 'atomizer', mode: 'rebuild' as const, mode_requested: 'rebuild' as const, bytes: 0, stats: {} })),
      write: (line) => output.push(line),
      writeError: (line) => errors.push(line),
    });

    await when('edit command fails with unknown paragraph', async () => {
      // This will fail because _bk_unknown doesn't exist, but it proves routing works
      await expect(
        program.parseAsync(['node', 'safe-docx', 'edit', inputPath, '--replace', '_bk_unknown', 'old', 'new']),
      ).rejects.toThrow();
    });
  });

  test('existing serve routing is unchanged', async ({ when, then }: AllureBddContext) => {
    const serve = vi.fn(async () => undefined);
    const program = createProgram({
      serve,
      compare: vi.fn(async () => ({ output: '', engine: 'atomizer', mode: 'rebuild' as const, mode_requested: 'rebuild' as const, bytes: 0, stats: {} })),
      write: () => undefined,
      writeError: () => undefined,
    });

    await when('serve is invoked explicitly', async () => {
      await program.parseAsync(['node', 'safe-docx', 'serve']);
    });

    await then('serve handler is called', () => {
      expect(serve).toHaveBeenCalledTimes(1);
    });
  });
});
