/**
 * Reconstruction metadata regression tests.
 *
 * Verifies that compareDocuments surfaces requested/used reconstruction mode
 * and fallback reason when atomizer needs to downgrade to rebuild mode.
 */

import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { compareDocuments } from '../index.js';

const integrationDir = dirname(import.meta.url.replace('file://', ''));
const fixturesPath = join(integrationDir, '../testing/fixtures');
const projectRoot = join(integrationDir, '../../../..');

const SYNTHETIC_INPLACE_ORIGINAL_DOC = join(
  fixturesPath,
  'split-run-boundary-change/original.docx'
);
const SYNTHETIC_INPLACE_REVISED_DOC = join(
  fixturesPath,
  'split-run-boundary-change/revised.docx'
);
const ILPA_ORIGINAL_DOC = join(
  projectRoot,
  'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx'
);
const ILPA_REVISED_DOC = join(
  projectRoot,
  'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx'
);

async function loadFixturePair(name: string): Promise<{ original: Buffer; revised: Buffer }> {
  const [original, revised] = await Promise.all([
    readFile(join(fixturesPath, name, 'original.docx')),
    readFile(join(fixturesPath, name, 'revised.docx')),
  ]);
  return { original, revised };
}

describe('Reconstruction metadata', () => {
  it('reports inplace as requested and used when inplace is safe', async () => {
    const { original, revised } = await loadFixturePair('simple-word-change');
    const result = await compareDocuments(original, revised, {
      engine: 'atomizer',
      reconstructionMode: 'inplace',
    });

    expect(result.engine).toBe('atomizer');
    expect(result.reconstructionModeRequested).toBe('inplace');
    expect(result.reconstructionModeUsed).toBe('inplace');
    expect(result.fallbackReason).toBeUndefined();
    expect(result.fallbackDiagnostics).toBeUndefined();
  });

  it('reports rebuild as requested and used when rebuild is requested', async () => {
    const { original, revised } = await loadFixturePair('simple-word-change');
    const result = await compareDocuments(original, revised, {
      engine: 'atomizer',
      reconstructionMode: 'rebuild',
    });

    expect(result.engine).toBe('atomizer');
    expect(result.reconstructionModeRequested).toBe('rebuild');
    expect(result.reconstructionModeUsed).toBe('rebuild');
    expect(result.fallbackReason).toBeUndefined();
    expect(result.fallbackDiagnostics).toBeUndefined();
  });

  it('keeps reconstruction metadata undefined for diffmatch engine (direct import)', async () => {
    const { compareDocumentsBaselineB } = await import('../baselines/diffmatch/pipeline.js');
    const { original, revised } = await loadFixturePair('simple-word-change');
    const result = await compareDocumentsBaselineB(original, revised);

    expect(result.engine).toBe('diffmatch');
    expect((result as any).reconstructionModeRequested).toBeUndefined();
    expect((result as any).reconstructionModeUsed).toBeUndefined();
    expect((result as any).fallbackReason).toBeUndefined();
    expect((result as any).fallbackDiagnostics).toBeUndefined();
  });

  it(
    'ILPA corpus completes in inplace mode without fallback',
    async () => {
      const [original, revised] = await Promise.all([
        readFile(ILPA_ORIGINAL_DOC),
        readFile(ILPA_REVISED_DOC),
      ]);

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });

      expect(result.engine).toBe('atomizer');
      expect(result.reconstructionModeRequested).toBe('inplace');
      // Issue #35 fixed: setLeafText now syncs both `data` and `nodeValue` on xmldom
      // text nodes, so ILPA no longer falls back to rebuild with premerge enabled.
      expect(result.reconstructionModeUsed).toBe('inplace');
      expect(result.fallbackReason).toBeUndefined();
    },
    180000
  );

  it(
    'keeps synthetic inplace-safe corpus without fallback',
    async () => {
      const [original, revised] = await Promise.all([
        readFile(SYNTHETIC_INPLACE_ORIGINAL_DOC),
        readFile(SYNTHETIC_INPLACE_REVISED_DOC),
      ]);

      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });

      expect(result.reconstructionModeRequested).toBe('inplace');
      expect(result.reconstructionModeUsed).toBe('inplace');
      expect(result.fallbackReason).toBeUndefined();
      expect(result.fallbackDiagnostics).toBeUndefined();
    },
    180000
  );
});
