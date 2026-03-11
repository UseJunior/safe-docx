import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';
import fs from 'fs';
import path from 'path';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'NVCA Structural Regression' });

describe('NVCA Structural Regression', () => {
  const sourcePath = path.resolve(__dirname, '../../../../tests/test_documents/nvca-regression/source.docx');
  const filledPath = path.resolve(__dirname, '../../../../tests/test_documents/nvca-regression/filled.docx');

  test('should compare NVCA source vs filled in inplace mode without safety fallback', async ({ given, when, then, and }: AllureBddContext) => {
    let sourceBuf: Buffer;
    let filledBuf: Buffer;
    let res: Awaited<ReturnType<typeof compareDocuments>>;

    await given('NVCA source and filled fixture files exist and are loaded', async () => {
      if (!fs.existsSync(sourcePath) || !fs.existsSync(filledPath)) {
        console.warn('Skipping NVCA Structural Regression: fixture files not found');
        return;
      }
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
      // Verify stats are within expected ranges (v0.3: improved matching yields lower counts)
      expect(res.stats.insertions).toBeGreaterThan(100);
      expect(res.stats.deletions).toBeGreaterThan(200);
    });
  }, 60000); // 60 second timeout for large document comparison
});
