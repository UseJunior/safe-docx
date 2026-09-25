import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSyntheticDocx } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { makeStrictDocx } from '../../testing/docx_test_utils.js';
import { createTrackedTempDir, registerCleanup } from '../../testing/session-test-utils.js';
import { runGrepCommand } from './grep.js';
import { CliCommandFailure } from '../tool_runner.js';

const TEST_FEATURE = 'refuse-wml-strict-documents';

const test = testAllure
  .epic('Document Reading')
  .withLabels({ feature: 'CLI Grep Command' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '2.1' });

const BODY_TEXT = 'Alpha bravo charlie.';

async function writeFixtures(): Promise<{ transitionalPath: string; strictPath: string }> {
  const dir = await createTrackedTempDir('safe-docx-cli-grep-');
  const transitional = await buildSyntheticDocx({ paragraphs: [BODY_TEXT] });
  const strict = await makeStrictDocx(transitional);
  const transitionalPath = path.join(dir, 'transitional.docx');
  const strictPath = path.join(dir, 'strict.docx');
  await fs.writeFile(transitionalPath, new Uint8Array(transitional));
  await fs.writeFile(strictPath, new Uint8Array(strict));
  return { transitionalPath, strictPath };
}

function capture() {
  const out: string[] = [];
  const errors: string[] = [];
  return {
    out,
    errors,
    opts: { write: (line: string) => out.push(line), writeError: (line: string) => errors.push(line) },
  };
}

describe('safe-docx grep command on a WML Strict file', () => {
  registerCleanup();

  test('a single Strict file fails with the structured refusal and no stack (#1025)', async ({ given, when, then, and }: AllureBddContext) => {
    let strictPath: string;
    let failure: unknown;
    const io = capture();

    await given('a Strict-namespace .docx on disk', async () => {
      ({ strictPath } = await writeFixtures());
    });

    await when('grep runs on that file alone', async () => {
      failure = await runGrepCommand({ pattern: 'Alpha', files: [strictPath] }, io.opts).then(
        () => undefined,
        (error: unknown) => error,
      );
    });

    await then('stderr carries one structured error with the typed code and hint', () => {
      expect(io.out).toEqual([]);
      expect(io.errors).toHaveLength(1);
      const parsed = JSON.parse(io.errors[0]!) as { success: boolean; error: { code: string; message: string; hint?: string } };
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('UNSUPPORTED_CONFORMANCE_CLASS');
      expect(parsed.error.message).toContain('WML Strict');
      expect(parsed.error.hint).toMatch(/Transitional/);
    });

    await and('the command fails with a summary-only CliCommandFailure', () => {
      expect(failure).toBeInstanceOf(CliCommandFailure);
      expect((failure as Error).message).toBe('grep failed');
    });
  });

  test('a Strict file beside a Transitional one is reported in human and JSON output (#1025)', async ({ given, when, then, and }: AllureBddContext) => {
    let strictPath: string;
    let transitionalPath: string;
    const human = capture();
    const json = capture();

    await given('a Strict-namespace .docx and a Transitional twin on disk', async () => {
      ({ strictPath, transitionalPath } = await writeFixtures());
    });

    await when('grep runs across both files in human and --json mode', async () => {
      await runGrepCommand({ pattern: 'Alpha', files: [strictPath, transitionalPath] }, human.opts);
      await runGrepCommand({ pattern: 'Alpha', files: [strictPath, transitionalPath], json: true }, json.opts);
    });

    await then('human output names the refused file with its code instead of counting it as zero matches', () => {
      expect(human.out).toHaveLength(1);
      const text = human.out[0]!;
      expect(text).toContain(`${strictPath}: UNSUPPORTED_CONFORMANCE_CLASS: `);
      expect(text).toContain('WML Strict');
      expect(text).toContain(`${transitionalPath}:`);
      expect(text).not.toContain('No matches found.');
    });

    await and('JSON output keeps the per-file error and error_code', () => {
      expect(json.out).toHaveLength(1);
      const parsed = JSON.parse(json.out[0]!) as { success: boolean; files: Array<Record<string, unknown>> };
      expect(parsed.success).toBe(true);
      const refused = parsed.files.find((f) => f.file_path === strictPath);
      expect(refused?.error_code).toBe('UNSUPPORTED_CONFORMANCE_CLASS');
      expect(String(refused?.error)).toContain('WML Strict');
      const searched = parsed.files.find((f) => f.file_path === transitionalPath);
      expect(searched?.total_matches).toBe(1);
    });
  });
});
