import { describe, it, expect } from 'vitest';
import { compareDocuments } from '../index.js';
import fs from 'fs';
import path from 'path';

describe('NVCA Structural Regression', () => {
  const sourcePath = path.resolve(__dirname, '../../../../tests/test_documents/nvca-regression/source.docx');
  const filledPath = path.resolve(__dirname, '../../../../tests/test_documents/nvca-regression/filled.docx');

  it('should compare NVCA source vs filled in inplace mode without safety fallback', async () => {
    if (!fs.existsSync(sourcePath) || !fs.existsSync(filledPath)) {
      console.warn('Skipping NVCA Structural Regression: fixture files not found');
      return;
    }

    const sourceBuf = fs.readFileSync(sourcePath);
    const filledBuf = fs.readFileSync(filledPath);

    const res = await compareDocuments(sourceBuf, filledBuf, {
      engine: 'atomizer',
      reconstructionMode: 'inplace',
      author: 'RegressionTest'
    });

    // Check that it used inplace mode (meaning it passed all safety checks)
    expect(res.reconstructionModeUsed).toBe('inplace');
    expect(res.fallbackReason).toBeUndefined();

    // Verify stats are within expected ranges
    expect(res.stats.insertions).toBeGreaterThan(400);
    expect(res.stats.deletions).toBeGreaterThan(2000);
  }, 60000); // 60 second timeout for large document comparison
});
