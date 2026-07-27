import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { makeMinimalDocx } from '../../testing/docx_test_utils.js';
import { createTrackedTempDir, registerCleanup } from '../../testing/session-test-utils.js';
import { runCompareCommand } from './compare.js';

registerCleanup();

const test = testAllure.epic('Document Editing').withLabels({ feature: 'CLI Comparison' });

describe('safe-docx compare command', () => {
  test('defaults to the shared inplace reconstruction mode', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const tmpDir = await createTrackedTempDir('safe-docx-compare-default-');
    const originalPath = path.join(tmpDir, 'original.docx');
    const revisedPath = path.join(tmpDir, 'revised.docx');
    await given('a minimal document pair with one text revision', async () => {
      await Promise.all([
        fs.writeFile(originalPath, await makeMinimalDocx(['Original text'])),
        fs.writeFile(revisedPath, await makeMinimalDocx(['Revised text'])),
      ]);
    });

    let result: Awaited<ReturnType<typeof runCompareCommand>>;
    await when('the CLI compare command runs without an explicit mode', async () => {
      result = await runCompareCommand({ originalPath, revisedPath });
    });

    await then('inplace is requested and reflected in the default output name', async () => {
      expect(result.mode_requested).toBe('inplace');
      expect(result.output).toBe(path.join(tmpDir, 'revised.REDLINE.atomizer.inplace.docx'));
      expect((await fs.stat(result.output)).isFile()).toBe(true);
    });
  });

  test('honors an explicit rebuild mode', async ({ given, when, then }: AllureBddContext) => {
    const tmpDir = await createTrackedTempDir('safe-docx-compare-rebuild-');
    const originalPath = path.join(tmpDir, 'original.docx');
    const revisedPath = path.join(tmpDir, 'revised.docx');
    await given('a minimal document pair', async () => {
      await Promise.all([
        fs.writeFile(originalPath, await makeMinimalDocx(['Original text'])),
        fs.writeFile(revisedPath, await makeMinimalDocx(['Revised text'])),
      ]);
    });

    let result: Awaited<ReturnType<typeof runCompareCommand>>;
    await when('the CLI compare command explicitly requests rebuild', async () => {
      result = await runCompareCommand({ originalPath, revisedPath, mode: 'rebuild' });
    });

    await then('the explicit mode remains authoritative', () => {
      expect(result.mode_requested).toBe('rebuild');
      expect(result.output).toBe(path.join(tmpDir, 'revised.REDLINE.atomizer.rebuild.docx'));
    });
  });
});
