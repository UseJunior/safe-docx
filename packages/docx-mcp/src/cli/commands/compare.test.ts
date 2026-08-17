import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { makeMinimalDocx } from '../../testing/docx_test_utils.js';
import { createTrackedTempDir, registerCleanup } from '../../testing/session-test-utils.js';
import { runCompareCommand } from './compare.js';

registerCleanup();

const TEST_FEATURE = 'add-compare-output-option';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

describe('safe-docx compare command', () => {
  test('publishes the fixed revised-based tagged result', async ({
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
    await when('the CLI compare command runs', async () => {
      result = await runCompareCommand({ originalPath, revisedPath });
    });

    await then('the revised package base is explicit in the result and neutral output name', async () => {
      expect(result.package_base).toBe('revised');
      expect(result.output).toBe(path.join(tmpDir, 'revised.REDLINE.docx'));
      expect((await fs.stat(result.output)).isFile()).toBe(true);
    });
  });
});
