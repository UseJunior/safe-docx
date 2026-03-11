/**
 * Reconstruction metadata regression tests.
 *
 * Verifies that compareDocuments surfaces requested/used reconstruction mode
 * and fallback reason when atomizer needs to downgrade to rebuild mode.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { compareDocuments } from '../index.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Reconstruction Metadata' });

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
  test('reports inplace as requested and used when inplace is safe', async ({ given, when, then }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocuments>>;

    await given('simple-word-change fixture documents are loaded', async () => {
      ({ original, revised } = await loadFixturePair('simple-word-change'));
    });

    await when('documents are compared with inplace mode requested', async () => {
      result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });
    });

    await then('reconstruction metadata reflects inplace was used without fallback', async () => {
      expect(result.engine).toBe('atomizer');
      expect(result.reconstructionModeRequested).toBe('inplace');
      expect(result.reconstructionModeUsed).toBe('inplace');
      expect(result.fallbackReason).toBeUndefined();
      expect(result.fallbackDiagnostics).toBeUndefined();
    });
  });

  test('reports rebuild as requested and used when rebuild is requested', async ({ given, when, then }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocuments>>;

    await given('simple-word-change fixture documents are loaded', async () => {
      ({ original, revised } = await loadFixturePair('simple-word-change'));
    });

    await when('documents are compared with rebuild mode requested', async () => {
      result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'rebuild',
      });
    });

    await then('reconstruction metadata reflects rebuild was used without fallback', async () => {
      expect(result.engine).toBe('atomizer');
      expect(result.reconstructionModeRequested).toBe('rebuild');
      expect(result.reconstructionModeUsed).toBe('rebuild');
      expect(result.fallbackReason).toBeUndefined();
      expect(result.fallbackDiagnostics).toBeUndefined();
    });
  });

  test('keeps reconstruction metadata undefined for diffmatch engine (direct import)', async ({ given, when, then }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof import('../baselines/diffmatch/pipeline.js').compareDocumentsBaselineB>>;

    await given('simple-word-change fixture documents are loaded', async () => {
      ({ original, revised } = await loadFixturePair('simple-word-change'));
    });

    await when('documents are compared using the diffmatch baseline B engine', async () => {
      const { compareDocumentsBaselineB } = await import('../baselines/diffmatch/pipeline.js');
      result = await compareDocumentsBaselineB(original, revised);
    });

    await then('reconstruction metadata fields are all undefined', async () => {
      expect(result.engine).toBe('diffmatch');
      expect((result as any).reconstructionModeRequested).toBeUndefined();
      expect((result as any).reconstructionModeUsed).toBeUndefined();
      expect((result as any).fallbackReason).toBeUndefined();
      expect((result as any).fallbackDiagnostics).toBeUndefined();
    });
  });

  test(
    'ILPA corpus completes in inplace mode without fallback',
    async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer;
      let revised: Buffer;
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given('ILPA original and revised documents are loaded', async () => {
        [original, revised] = await Promise.all([
          readFile(ILPA_ORIGINAL_DOC),
          readFile(ILPA_REVISED_DOC),
        ]);
      });

      await when('documents are compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
      });

      await then('inplace mode was used without fallback', async () => {
        expect(result.engine).toBe('atomizer');
        expect(result.reconstructionModeRequested).toBe('inplace');
        // Issue #35 fixed: setLeafText now syncs both `data` and `nodeValue` on xmldom
        // text nodes, so ILPA no longer falls back to rebuild with premerge enabled.
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(result.fallbackReason).toBeUndefined();
      });
    },
    180000
  );

  test(
    'keeps synthetic inplace-safe corpus without fallback',
    async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer;
      let revised: Buffer;
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given('synthetic split-run-boundary-change documents are loaded', async () => {
        [original, revised] = await Promise.all([
          readFile(SYNTHETIC_INPLACE_ORIGINAL_DOC),
          readFile(SYNTHETIC_INPLACE_REVISED_DOC),
        ]);
      });

      await when('documents are compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
      });

      await then('inplace mode was used without fallback', async () => {
        expect(result.reconstructionModeRequested).toBe('inplace');
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(result.fallbackReason).toBeUndefined();
        expect(result.fallbackDiagnostics).toBeUndefined();
      });
    },
    180000
  );
});
