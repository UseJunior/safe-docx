import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { buildSyntheticDocx } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { makeStrictDocx } from '../testing/docx_test_utils.js';
import { createTrackedTempDir, registerCleanup } from '../testing/session-test-utils.js';

const TEST_FEATURE = 'refuse-wml-strict-documents';

const test = testAllure
  .epic('Document Reading')
  .withLabels({ feature: 'CLI Entry Refusal' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '2.1' });

const CLI_SOURCE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts');
const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function runCliEntry(args: string[]) {
  // --import tsx runs the TypeScript entry directly, so the test exercises the
  // real process exit path (piped stdio) without depending on a prior build.
  return spawnSync(process.execPath, ['--import', 'tsx', CLI_SOURCE_PATH, ...args], {
    cwd: PACKAGE_DIR,
    encoding: 'utf8',
  });
}

/** Split piped stderr into the JSON error object and the trailing summary line. */
function splitStderr(stderr: string): { json: unknown; summary: string } {
  const trimmed = stderr.trimEnd();
  const summaryStart = trimmed.lastIndexOf('\n');
  const summary = trimmed.slice(summaryStart + 1);
  return { json: JSON.parse(trimmed.slice(0, summaryStart)), summary };
}

describe('safe-docx CLI entry point on a WML Strict file', () => {
  registerCleanup();

  test('read-file over a pipe emits one complete JSON error, a summary line, and no stack (#1025)', async ({ given, when, then, and }: AllureBddContext) => {
    let strictPath: string;
    let result!: ReturnType<typeof runCliEntry>;

    await given('a Strict-namespace .docx on disk', async () => {
      const dir = await createTrackedTempDir('safe-docx-cli-entry-');
      strictPath = join(dir, 'strict.docx');
      const strict = await makeStrictDocx(await buildSyntheticDocx({ paragraphs: ['Alpha bravo charlie.'] }));
      await fs.writeFile(strictPath, new Uint8Array(strict));
    });

    await when('the CLI runs read-file as a child process with piped stdio', () => {
      result = runCliEntry(['read-file', '--file-path', strictPath]);
    });

    await then('it exits 1 and stderr parses as the structured refusal', () => {
      expect(result.status, result.stderr).toBe(1);
      expect(result.stdout).toBe('');
      const { json, summary } = splitStderr(result.stderr);
      const parsed = json as { success: boolean; error: { code: string; message: string; hint?: string } };
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('UNSUPPORTED_CONFORMANCE_CLASS');
      expect(parsed.error.message).toContain('WML Strict');
      expect(parsed.error.hint).toMatch(/and open that file instead\.$/);
      expect(summary).toBe('Tool "read_file" failed');
    });

    await and('no stack frame reaches stderr', () => {
      expect(result.stderr).not.toMatch(/\n\s+at /);
    });
  });
});
