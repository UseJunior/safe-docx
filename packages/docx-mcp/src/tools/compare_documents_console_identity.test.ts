/**
 * Deterministic regression for issue #809: overlapping compare_documents
 * calls must never touch the process-global console.log.
 *
 * The removed runWithoutConsoleLog workaround swapped console.log for a no-op
 * across an await. With two overlapping calls, the second call captured the
 * first call's no-op as its "original" and restored it last — permanently
 * silencing console.log for the whole process. The end-to-end stdio test
 * cannot pin that defect: MCP responses are written with process.stdout.write,
 * so the protocol stream stays clean even while console.log is dead (issue
 * #820, finding 2 — demonstrated by reintroducing the wrapper and watching the
 * stdio test pass).
 *
 * This test pins the defect directly. It mocks the comparison dependency so
 * both tool calls can be paused INSIDE the comparison — the exact interleaving
 * that reproduced #809 — with no reliance on timing, and asserts console.log
 * retains strict identity at every stage: synchronously at dependency entry
 * (catching a swap that is restored before the caller awaits), mid-flight
 * while both calls are suspended (catching the across-an-await suppression),
 * and after both complete (catching the permanent wrong-function restore).
 * Per-call handling that never mutates the process-global console identities
 * (e.g. AsyncLocalStorage scoping) is intentionally outside this regression.
 */
import { describe, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompareResult } from '@usejunior/docx-compare';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertSuccess,
  createTestSessionManager,
  createTrackedTempDir,
  registerCleanup,
} from '../testing/session-test-utils.js';

// Replace the comparison engine with a controllable stand-in so the test can
// hold both tool calls inside the comparison at once. The tool under test is
// real; only the (expensive, timing-dependent) comparison is injected.
vi.mock('@usejunior/docx-compare', () => ({
  compareDocuments: vi.fn(),
}));
import { compareDocuments } from '@usejunior/docx-compare';
import { compareDocuments_tool } from './compare_documents.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Compare Documents Console Identity',
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REAL_DOCUMENT = path.resolve(
  __dirname,
  '../../../../tests/test_documents/open-agreements/mutual-nda.docx',
);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mockCompareResult(): CompareResult {
  return {
    document: Buffer.from('mock comparison output'),
    engine: 'atomizer',
    baseSide: 'revised',
    stats: {
      insertions: 0,
      deletions: 0,
      modifications: 0,
      insertedRanges: 0,
      deletedRanges: 0,
      insertedAtoms: 0,
      deletedAtoms: 0,
      modifiedParagraphs: 0,
      formatChanges: 0,
      formatChangeAtoms: 0,
    },
    reconstructionModeRequested: 'inplace',
    reconstructionModeUsed: 'inplace',
  };
}

describe('compare_documents leaves the process-global console untouched (#809)', () => {
  registerCleanup();

  afterEach(() => {
    vi.mocked(compareDocuments).mockReset();
  });

  test(
    'two overlapping tool calls preserve strict console.log identity throughout',
    async ({ given, when, then }: AllureBddContext) => {
      const initialConsoleLog = console.log;
      const initialConsoleWarn = console.warn;
      const initialConsoleError = console.error;

      const manager = createTestSessionManager();
      const tmpDir = await createTrackedTempDir('safe-docx-console-identity-');
      const outputA = path.join(tmpDir, 'redline-a.docx');
      const outputB = path.join(tmpDir, 'redline-b.docx');

      const enteredA = deferred<void>();
      const enteredB = deferred<void>();
      const gateA = deferred<CompareResult>();
      const gateB = deferred<CompareResult>();

      // Console identities observed synchronously INSIDE the comparison call.
      // A wrapper that swaps console.log and restores it before the caller
      // awaits would look intact from the outside; these entry-time records
      // catch it (peer review of #820).
      const entryIdentities: Array<{
        log: typeof console.log;
        warn: typeof console.warn;
        error: typeof console.error;
      }> = [];
      const recordEntryIdentities = () => {
        entryIdentities.push({ log: console.log, warn: console.warn, error: console.error });
      };

      await given('a comparison dependency that pauses inside each call', () => {
        vi.mocked(compareDocuments)
          .mockImplementationOnce(() => {
            recordEntryIdentities();
            enteredA.resolve();
            return gateA.promise;
          })
          .mockImplementationOnce(() => {
            recordEntryIdentities();
            enteredB.resolve();
            return gateB.promise;
          });
      });

      try {
        let responseA!: Promise<Awaited<ReturnType<typeof compareDocuments_tool>>>;
        let responseB!: Promise<Awaited<ReturnType<typeof compareDocuments_tool>>>;

        await when('call B enters the comparison while call A is still inside it', async () => {
          responseA = compareDocuments_tool(manager, {
            original_file_path: REAL_DOCUMENT,
            revised_file_path: REAL_DOCUMENT,
            save_to_local_path: outputA,
          });
          await enteredA.promise;

          responseB = compareDocuments_tool(manager, {
            original_file_path: REAL_DOCUMENT,
            revised_file_path: REAL_DOCUMENT,
            save_to_local_path: outputB,
          });
          await enteredB.promise;
        });

        await then('the console was untouched at entry to each comparison call', () => {
          // Fails for a synchronous swap-and-restore around the dependency
          // call, which the outside-the-call assertions below cannot see.
          expect(entryIdentities).toHaveLength(2);
          for (const identities of entryIdentities) {
            expect(identities.log).toBe(initialConsoleLog);
            expect(identities.warn).toBe(initialConsoleWarn);
            expect(identities.error).toBe(initialConsoleError);
          }
        });

        await then('console.log is untouched while both comparisons are in flight', () => {
          // The old wrapper fails here: call A already swapped in a no-op.
          expect(console.log).toBe(initialConsoleLog);
        });

        await then('console.log is untouched after A finishes, then after B finishes', async () => {
          gateA.resolve(mockCompareResult());
          assertSuccess(await responseA, 'compare_documents call A');
          expect(console.log).toBe(initialConsoleLog);

          gateB.resolve(mockCompareResult());
          assertSuccess(await responseB, 'compare_documents call B');
          // The old wrapper's race ends here: B "restores" the no-op it
          // captured from A, permanently silencing console.log (#809).
          expect(console.log).toBe(initialConsoleLog);
          expect(console.warn).toBe(initialConsoleWarn);
          expect(console.error).toBe(initialConsoleError);
        });

        await then('both redlines were written', async () => {
          await fs.access(outputA);
          await fs.access(outputB);
        });
      } finally {
        // Never leave the gates pending if an assertion throws mid-flight.
        gateA.resolve(mockCompareResult());
        gateB.resolve(mockCompareResult());
      }
    },
  );
});
