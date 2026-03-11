/**
 * Stability invariants for comparator correctness.
 *
 * Focus:
 * 1) Idempotence of semantic accept/reject transforms.
 * 2) Deterministic semantic output across repeated runs.
 * 3) No-op behavior when comparing a document to itself.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
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

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Stability Invariants' });

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
  reconstructionMode: ReconstructionMode,
  opts?: { premergeRuns?: boolean },
): Promise<RunSnapshot> {
  const result = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode,
    premergeRuns: opts?.premergeRuns,
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
      test(`${fixtureName}/${mode}: accept/reject transforms are idempotent`, async ({ given, when, then }: AllureBddContext) => {
        let original: Buffer;
        let revised: Buffer;
        let resultXml: string;
        let acceptOnce: string;
        let acceptTwice: string;
        let rejectOnce: string;
        let rejectTwice: string;

        await given(`${fixtureName} original and revised documents are loaded`, async () => {
          ({ original, revised } = await loadFixturePair(fixtureName));
        });

        await when(`documents are compared in ${mode} mode and transforms are applied`, async () => {
          const result = await compareDocuments(original, revised, {
            engine: 'atomizer',
            reconstructionMode: mode,
          });

          resultXml = await getDocXml(result.document);
          acceptOnce = extractTextWithParagraphs(acceptAllChanges(resultXml));
          acceptTwice = extractTextWithParagraphs(acceptAllChanges(acceptAllChanges(resultXml)));
          rejectOnce = extractTextWithParagraphs(rejectAllChanges(resultXml));
          rejectTwice = extractTextWithParagraphs(rejectAllChanges(rejectAllChanges(resultXml)));
        });

        await then('accept transform is idempotent', async () => {
          assertNormalizedEqual(acceptOnce, acceptTwice, `${fixtureName}/${mode}/accept-idempotence`);
        });

        await then('reject transform is idempotent', async () => {
          assertNormalizedEqual(rejectOnce, rejectTwice, `${fixtureName}/${mode}/reject-idempotence`);
        });
      });
    }
  }

  test('determinism: same small fixture inputs produce same semantic output across runs', async ({ given, when, then }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let runs: RunSnapshot[];

    await given('split-run-boundary-change documents are loaded', async () => {
      ({ original, revised } = await loadFixturePair('split-run-boundary-change'));
    });

    await when('documents are compared in inplace mode three times concurrently', async () => {
      runs = await Promise.all([
        runAndSnapshot(original, revised, 'inplace'),
        runAndSnapshot(original, revised, 'inplace'),
        runAndSnapshot(original, revised, 'inplace'),
      ]);
    });

    await then('all runs produce identical semantic output', async () => {
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
  });

  test(
    'determinism: synthetic core corpus stays inplace without fallback',
    async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer;
      let revised: Buffer;
      let runs: RunSnapshot[];

      await given('synthetic split-run-boundary-change documents are loaded', async () => {
        [original, revised] = await Promise.all([
          readFile(SYNTHETIC_INPLACE_ORIGINAL_DOC),
          readFile(SYNTHETIC_INPLACE_REVISED_DOC),
        ]);
      });

      await when('documents are compared in inplace mode twice concurrently', async () => {
        runs = await Promise.all([
          runAndSnapshot(original, revised, 'inplace'),
          runAndSnapshot(original, revised, 'inplace'),
        ]);
      });

      await then('both runs produce identical semantic output in inplace mode without fallback', async () => {
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
      });
    },
    180000
  );

  test(
    'determinism: ILPA corpus inplace results are stable across runs',
    async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer;
      let revised: Buffer;
      let runs: RunSnapshot[];

      await given('ILPA original and revised documents are loaded', async () => {
        [original, revised] = await Promise.all([
          readFile(ILPA_ORIGINAL_DOC),
          readFile(ILPA_REVISED_DOC),
        ]);
      });

      await when('documents are compared in inplace mode twice concurrently', async () => {
        // premergeRuns defaults to true — do not override.
        // Issue #35 fixed: setLeafText now syncs both `data` and `nodeValue` on xmldom
        // text nodes, so ILPA no longer falls back to rebuild with premerge enabled.
        runs = await Promise.all([
          runAndSnapshot(original, revised, 'inplace'),
          runAndSnapshot(original, revised, 'inplace'),
        ]);
      });

      await then('both runs produce identical semantic output in inplace mode without fallback', async () => {
        const [first, second] = runs;
        assertNormalizedEqual(first.semantic.raw, second.semantic.raw, 'determinism/ilpa/raw');
        assertNormalizedEqual(first.semantic.accepted, second.semantic.accepted, 'determinism/ilpa/accepted');
        assertNormalizedEqual(first.semantic.rejected, second.semantic.rejected, 'determinism/ilpa/rejected');

        expect(first.reconstructionModeUsed).toBe('inplace');
        expect(second.reconstructionModeUsed).toBe('inplace');
        expect(first.fallbackReason).toBeUndefined();
        expect(second.fallbackReason).toBeUndefined();
        expect(first.failedChecks).toEqual([]);
        expect(second.failedChecks).toEqual([]);
        expect(first.failedChecks).toEqual(second.failedChecks);
      });
    },
    180000
  );

  for (const mode of MODES) {
    test(`no-op/${mode}: compare(original, original) yields zero semantic change`, async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer;
      let result: Awaited<ReturnType<typeof compareDocuments>>;
      let originalReadText: string;
      let resultSemantic: SemanticView;

      await given('simple-word-change original document is loaded', async () => {
        ({ original } = await loadFixturePair('simple-word-change'));
      });

      await when(`original document is compared against itself in ${mode} mode`, async () => {
        result = await compareDocuments(original, original, {
          engine: 'atomizer',
          reconstructionMode: mode,
        });

        const originalXml = await getDocXml(original);
        const resultXml = await getDocXml(result.document);

        originalReadText = extractTextWithParagraphs(originalXml);
        resultSemantic = semanticViewFromXml(resultXml);
      });

      await then('zero changes are detected and all semantic views match original', async () => {
        expect(result.stats.insertions).toBe(0);
        expect(result.stats.deletions).toBe(0);
        expect(result.stats.modifications).toBe(0);
        expect(result.fallbackReason).toBeUndefined();

        assertNormalizedEqual(originalReadText, resultSemantic.raw, `no-op/${mode}/raw`);
        assertNormalizedEqual(originalReadText, resultSemantic.accepted, `no-op/${mode}/accept`);
        assertNormalizedEqual(originalReadText, resultSemantic.rejected, `no-op/${mode}/reject`);
      });
    });
  }
});
