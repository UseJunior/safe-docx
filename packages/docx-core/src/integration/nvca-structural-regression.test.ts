import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocuments } from '@usejunior/docx-compare';
import fs from 'fs';
import path from 'path';

const TEST_FEATURE = 'NVCA Structural Regression';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
describe('NVCA Structural Regression', () => {
  const sourcePath = path.resolve(__dirname, '../../../../tests/test_documents/nvca-regression/source.docx');
  const filledPath = path.resolve(__dirname, '../../../../tests/test_documents/nvca-regression/filled.docx');

  test('should compare NVCA source vs filled in inplace mode without safety fallback', async ({ given, when, then, and }: AllureBddContext) => {
    let sourceBuf: Buffer;
    let filledBuf: Buffer;
    let res: Awaited<ReturnType<typeof compareDocuments>>;

    await given('NVCA source and filled fixture files exist and are loaded', async () => {
      expect(fs.existsSync(sourcePath), `missing committed fixture: ${sourcePath}`).toBe(true);
      expect(fs.existsSync(filledPath), `missing committed fixture: ${filledPath}`).toBe(true);
      sourceBuf = fs.readFileSync(sourcePath);
      filledBuf = fs.readFileSync(filledPath);
    });

    await when('documents are compared in inplace mode', async () => {
      res = await compareDocuments(sourceBuf, filledBuf, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
        author: 'RegressionTest'
      });
    });

    await then('it used inplace mode without safety fallback', async () => {
      // Check that it used inplace mode (meaning it passed all safety checks)
      expect(res.reconstructionModeUsed).toBe('inplace');
      expect(res.fallbackReason).toBeUndefined();
    });

    await and('stats are within expected ranges', async () => {
      // Pin a bounded characterization range. A lower-bound-only assertion
      // accidentally rewarded extra revision noise and failed when #720 let the
      // higher-fidelity word-split pass reduce insertion ranges from 101+ to 99.
      expect(res.stats.insertions).toBeGreaterThanOrEqual(90);
      expect(res.stats.insertions).toBeLessThanOrEqual(110);
      expect(res.stats.deletions).toBeGreaterThanOrEqual(250);
      expect(res.stats.deletions).toBeLessThanOrEqual(300);
    });
  }, 60000); // 60 second timeout for large document comparison
});
