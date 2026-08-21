import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'CLI Bin Symlink Entrypoint' });

const CLI_SOURCE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'index.ts');
const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const tempDirs: string[] = [];

function runCliEntry(entryPath: string, args: string[]) {
  // --import tsx lets the spawned node execute the TypeScript source directly,
  // so the test exercises the entry guard without depending on a prior build.
  return spawnSync(process.execPath, ['--import', 'tsx', entryPath, ...args], {
    cwd: PACKAGE_DIR,
    encoding: 'utf8',
  });
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('docx-comparison bin entry guard', () => {
  test('executes the CLI when invoked through a node_modules/.bin-style symlink', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let symlinkPath!: string;
    let result!: ReturnType<typeof runCliEntry>;

    await given('a symlink to the CLI entrypoint, as npm creates in node_modules/.bin', () => {
      const binDir = mkdtempSync(join(tmpdir(), 'docx-comparison-bin-'));
      tempDirs.push(binDir);
      symlinkPath = join(binDir, 'docx-comparison');
      symlinkSync(CLI_SOURCE_PATH, symlinkPath);
    });

    await when('the bin is invoked through the symlink with --help', () => {
      result = runCliEntry(symlinkPath, ['--help']);
    });

    await then('the CLI runs and prints usage instead of silently exiting 0', () => {
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('Usage: docx-comparison');
    });
  });

  test('still executes the CLI when invoked by direct file path', async ({ when, then }: AllureBddContext) => {
    let result!: ReturnType<typeof runCliEntry>;

    await when('the entrypoint is invoked by its real path with --help', () => {
      result = runCliEntry(CLI_SOURCE_PATH, ['--help']);
    });

    await then('the CLI prints usage', () => {
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('Usage: docx-comparison');
    });
  });
});
