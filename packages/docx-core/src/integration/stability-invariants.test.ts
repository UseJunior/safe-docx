/**
 * Stability invariants for comparator correctness.
 *
 * Focus:
 * 1) Idempotence of semantic accept/reject transforms.
 * 2) Deterministic semantic output across repeated runs.
 * 3) No-op behavior when comparing a document to itself.
 */

import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { compareDocuments, type ReconstructionMode } from '../index.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import {
  acceptAllChanges,
  compareTexts,
  extractTextWithParagraphs,
  rejectAllChanges,
} from '../baselines/atomizer/trackChangesAcceptorAst.js';

interface SemanticView {
  raw: string;
  accepted: string;
  rejected: string;
}

interface RunSnapshot {
  semantic: SemanticView;
  reconstructionModeUsed: ReconstructionMode | undefined;
  fallbackReason?: string;
  failedChecks: string[];
}

const MODES: ReconstructionMode[] = ['rebuild', 'inplace'];
const FIXTURES = ['simple-word-change', 'split-run-boundary-change'] as const;

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

async function loadFixturePair(name: (typeof FIXTURES)[number]): Promise<{ original: Buffer; revised: Buffer }> {
  const [original, revised] = await Promise.all([
    readFile(join(fixturesPath, name, 'original.docx')),
    readFile(join(fixturesPath, name, 'revised.docx')),
  ]);
  return { original, revised };
}

async function getDocXml(document: Buffer): Promise<string> {
  const archive = await DocxArchive.load(document);
  return archive.getDocumentXml();
}

function assertNormalizedEqual(expected: string, actual: string, context: string): void {
  const comparison = compareTexts(expected, actual);
  const debug = comparison.differences.slice(0, 3).join('\n');
  const message =
    `${context}: read_text mismatch\n` +
    `expectedLength=${comparison.expectedLength} actualLength=${comparison.actualLength}\n${debug}`;
  expect(comparison.normalizedIdentical, message).toBe(true);
}

function semanticViewFromXml(documentXml: string): SemanticView {
  return {
    raw: extractTextWithParagraphs(documentXml),
    accepted: extractTextWithParagraphs(acceptAllChanges(documentXml)),
    rejected: extractTextWithParagraphs(rejectAllChanges(documentXml)),
  };
}

async function runAndSnapshot(
  original: Buffer,
  revised: Buffer,
  reconstructionMode: ReconstructionMode
): Promise<RunSnapshot> {
  const result = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode,
  });
  const documentXml = await getDocXml(result.document);
  const failedChecks = result.fallbackDiagnostics
    ? result.fallbackDiagnostics.attempts.flatMap((attempt) => attempt.failedChecks).sort()
    : [];

  return {
    semantic: semanticViewFromXml(documentXml),
    reconstructionModeUsed: result.reconstructionModeUsed,
    fallbackReason: result.fallbackReason,
    failedChecks,
  };
}

describe('Stability invariants', () => {
  for (const fixtureName of FIXTURES) {
    for (const mode of MODES) {
      it(`${fixtureName}/${mode}: accept/reject transforms are idempotent`, async () => {
        const { original, revised } = await loadFixturePair(fixtureName);
        const result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: mode,
        });

        const resultXml = await getDocXml(result.document);
        const acceptOnce = extractTextWithParagraphs(acceptAllChanges(resultXml));
        const acceptTwice = extractTextWithParagraphs(acceptAllChanges(acceptAllChanges(resultXml)));
        const rejectOnce = extractTextWithParagraphs(rejectAllChanges(resultXml));
        const rejectTwice = extractTextWithParagraphs(rejectAllChanges(rejectAllChanges(resultXml)));

        assertNormalizedEqual(acceptOnce, acceptTwice, `${fixtureName}/${mode}/accept-idempotence`);
        assertNormalizedEqual(rejectOnce, rejectTwice, `${fixtureName}/${mode}/reject-idempotence`);
      });
    }
  }

  it('determinism: same small fixture inputs produce same semantic output across runs', async () => {
    const { original, revised } = await loadFixturePair('split-run-boundary-change');

    const runs = await Promise.all([
      runAndSnapshot(original, revised, 'inplace'),
      runAndSnapshot(original, revised, 'inplace'),
      runAndSnapshot(original, revised, 'inplace'),
    ]);

    const [first, ...rest] = runs;
    for (const [index, current] of rest.entries()) {
      assertNormalizedEqual(first.semantic.raw, current.semantic.raw, `determinism/small/raw/run${index + 2}`);
      assertNormalizedEqual(
        first.semantic.accepted,
        current.semantic.accepted,
        `determinism/small/accepted/run${index + 2}`
      );
      assertNormalizedEqual(
        first.semantic.rejected,
        current.semantic.rejected,
        `determinism/small/rejected/run${index + 2}`
      );

      expect(current.reconstructionModeUsed).toBe(first.reconstructionModeUsed);
      expect(current.fallbackReason).toBe(first.fallbackReason);
      expect(current.failedChecks).toEqual(first.failedChecks);
    }
  });

  it(
    'determinism: synthetic core corpus stays inplace without fallback',
    async () => {
      const [original, revised] = await Promise.all([
        readFile(SYNTHETIC_INPLACE_ORIGINAL_DOC),
        readFile(SYNTHETIC_INPLACE_REVISED_DOC),
      ]);

      const runs = await Promise.all([
        runAndSnapshot(original, revised, 'inplace'),
        runAndSnapshot(original, revised, 'inplace'),
      ]);

      const [first, second] = runs;
      assertNormalizedEqual(first.semantic.raw, second.semantic.raw, 'determinism/synthetic/raw');
      assertNormalizedEqual(first.semantic.accepted, second.semantic.accepted, 'determinism/synthetic/accepted');
      assertNormalizedEqual(first.semantic.rejected, second.semantic.rejected, 'determinism/synthetic/rejected');

      expect(first.reconstructionModeUsed).toBe('inplace');
      expect(second.reconstructionModeUsed).toBe('inplace');
      expect(first.fallbackReason).toBeUndefined();
      expect(second.fallbackReason).toBeUndefined();
      expect(first.failedChecks).toEqual([]);
      expect(second.failedChecks).toEqual([]);
    },
    180000
  );

  it(
    'determinism: fallback diagnostics are stable for ILPA corpus when inplace downgrades',
    async () => {
      const [original, revised] = await Promise.all([
        readFile(ILPA_ORIGINAL_DOC),
        readFile(ILPA_REVISED_DOC),
      ]);

      const runs = await Promise.all([
        runAndSnapshot(original, revised, 'inplace'),
        runAndSnapshot(original, revised, 'inplace'),
      ]);

      const [first, second] = runs;
      assertNormalizedEqual(first.semantic.raw, second.semantic.raw, 'determinism/ilpa/raw');
      assertNormalizedEqual(first.semantic.accepted, second.semantic.accepted, 'determinism/ilpa/accepted');
      assertNormalizedEqual(first.semantic.rejected, second.semantic.rejected, 'determinism/ilpa/rejected');

      expect(first.reconstructionModeUsed).toBe('rebuild');
      expect(second.reconstructionModeUsed).toBe('rebuild');
      expect(first.fallbackReason).toBe('round_trip_safety_check_failed');
      expect(second.fallbackReason).toBe('round_trip_safety_check_failed');
      expect(first.failedChecks.length).toBeGreaterThan(0);
      expect(second.failedChecks).toEqual(first.failedChecks);
    },
    180000
  );

  for (const mode of MODES) {
    it(`no-op/${mode}: compare(original, original) yields zero semantic change`, async () => {
      const { original } = await loadFixturePair('simple-word-change');
      const result = await compareDocuments(original, original, {
        engine: 'atomizer',
        reconstructionMode: mode,
      });

      expect(result.stats.insertions).toBe(0);
      expect(result.stats.deletions).toBe(0);
      expect(result.stats.modifications).toBe(0);
      expect(result.fallbackReason).toBeUndefined();

      const originalXml = await getDocXml(original);
      const resultXml = await getDocXml(result.document);

      const originalReadText = extractTextWithParagraphs(originalXml);
      const resultSemantic = semanticViewFromXml(resultXml);

      assertNormalizedEqual(originalReadText, resultSemantic.raw, `no-op/${mode}/raw`);
      assertNormalizedEqual(originalReadText, resultSemantic.accepted, `no-op/${mode}/accept`);
      assertNormalizedEqual(originalReadText, resultSemantic.rejected, `no-op/${mode}/reject`);
    });
  }
});
