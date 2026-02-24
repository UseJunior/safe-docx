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

  it('keeps reconstruction metadata undefined for diffmatch engine', async () => {
    const { original, revised } = await loadFixturePair('simple-word-change');
    const result = await compareDocuments(original, revised, {
      engine: 'diffmatch',
    });

    expect(result.engine).toBe('diffmatch');
    expect(result.reconstructionModeRequested).toBeUndefined();
    expect(result.reconstructionModeUsed).toBeUndefined();
    expect(result.fallbackReason).toBeUndefined();
    expect(result.fallbackDiagnostics).toBeUndefined();
  });

  it(
    'reports fallback reason when inplace safety checks force rebuild',
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
      expect(result.reconstructionModeUsed).toBe('rebuild');
      expect(result.fallbackReason).toBe('round_trip_safety_check_failed');
      expect(result.fallbackDiagnostics).toBeDefined();

      const diagnostics = result.fallbackDiagnostics!;
      expect(diagnostics.attempts.length).toBeGreaterThan(0);

      for (const attempt of diagnostics.attempts) {
        expect(attempt.failedChecks.length).toBeGreaterThan(0);
        for (const checkName of attempt.failedChecks) {
          expect(['acceptText', 'rejectText', 'acceptBookmarks', 'rejectBookmarks']).toContain(
            checkName
          );
          expect(attempt.checks[checkName]).toBe(false);
        }

        expect(attempt.failureDetails).toBeDefined();
        expect(attempt.firstDiffSummary).toBeDefined();
        if (attempt.failedChecks.includes('rejectText')) {
          expect(attempt.failureDetails?.rejectText).toBeDefined();
          expect(attempt.failureDetails?.rejectText?.firstDifferingParagraphIndex).toBeGreaterThanOrEqual(
            0
          );
          expect(attempt.firstDiffSummary?.rejectText).toBeDefined();
          expect(attempt.firstDiffSummary?.rejectText?.firstDifferingParagraphIndex).toBeGreaterThanOrEqual(
            0
          );
          expect(attempt.firstDiffSummary?.rejectText?.firstDifference.length).toBeGreaterThan(0);
        }
        if (attempt.failedChecks.includes('rejectBookmarks')) {
          expect(attempt.failureDetails?.rejectBookmarks).toBeDefined();
          expect(attempt.firstDiffSummary?.rejectBookmarks).toBeDefined();
          const bookmarkSummary = attempt.firstDiffSummary?.rejectBookmarks;
          const bookmarkSignalCount =
            (bookmarkSummary?.startNames.missingCount ?? 0) +
            (bookmarkSummary?.startNames.unexpectedCount ?? 0) +
            (bookmarkSummary?.referencedBookmarkNames.missingCount ?? 0) +
            (bookmarkSummary?.referencedBookmarkNames.unexpectedCount ?? 0) +
            (bookmarkSummary?.unresolvedReferenceNames.missingCount ?? 0) +
            (bookmarkSummary?.unresolvedReferenceNames.unexpectedCount ?? 0) +
            (bookmarkSummary?.unmatchedStartCount ?? 0) +
            (bookmarkSummary?.unmatchedEndCount ?? 0);
          expect(bookmarkSignalCount).toBeGreaterThan(0);
        }
      }
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
