import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { makeMinimalDocx, makeMinimalDocxWithFooter } from '../../testing/docx_test_utils.js';
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

    await then('a fully represented comparison carries no unrepresented-change fields', () => {
      expect(result).not.toHaveProperty('unrepresented_changes');
      expect(result).not.toHaveProperty('warnings');
    });
  });

  test('surfaces unrepresented changes and warnings when the revised document drops a footer (#1029)', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const tmpDir = await createTrackedTempDir('safe-docx-compare-unrepresented-');
    const originalPath = path.join(tmpDir, 'original.docx');
    const revisedPath = path.join(tmpDir, 'revised.docx');
    await given('an original with a default footer and a revision that removes it', async () => {
      await Promise.all([
        fs.writeFile(originalPath, await makeMinimalDocxWithFooter(['Body text'], 'Confidential')),
        fs.writeFile(revisedPath, await makeMinimalDocxWithFooter(['Body text, revised'], null)),
      ]);
    });

    let result: Awaited<ReturnType<typeof runCompareCommand>>;
    await when('the CLI compare command runs', async () => {
      result = await runCompareCommand({ originalPath, revisedPath });
    });

    await then('the structured unrepresented change reaches the caller', () => {
      expect(result.unrepresented_changes).toEqual([
        { scope: 'footer', kind: 'removed', sectionIndex: 0, role: 'default' },
      ]);
    });

    await then('a human-readable warning names the unrepresented part', () => {
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('removed default footer in section 1');
      expect(result.warnings![0]).toContain('no tracked-change markup');
    });
  });
});
