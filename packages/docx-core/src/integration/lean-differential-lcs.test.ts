/**
 * Lean↔TS LCS differential harness (Tier 2.5, first increment).
 *
 * Runs the GENUINE Lean `LeanSpike.computeAtomLcs` (compiled to the
 * `leanDifferential` executable from `verification/lean/Differential.lean`) against
 * the production TypeScript `computeAtomLcs`
 * (`packages/docx-core/src/baselines/atomizer/atomLcs.ts`) over shared generated
 * atom-array pairs, asserting identical output. This makes the previously
 * un-reproducible "1.19M cases, zero divergence" equivalence claim
 * (`verification/ROADMAP.md`) a re-runnable, in-CI gate executed over the actual
 * Lean definition rather than an external re-implementation.
 *
 * Wire protocol (one subprocess spawn amortized over the whole batch; chunked so
 * the exhaustive sweep stays memory-bounded):
 *   stdin : { "cases":   [ { "orig": [Atom], "rev": [Atom] } ] }
 *   stdout: { "results": [ { "matches": [[origIdx, revIdx]], "deletedIndices": [n], "insertedIndices": [n] } ] }
 *
 * Match-shape normalization: Lean's `Match = Nat × Nat` serializes each pair as a
 * JSON array, so the exe emits `matches: [[o, r]]`. TS `LcsResult.matches` is
 * `[{ originalIndex, revisedIndex }]`; the harness maps it to `[o, r]` tuples before
 * comparing.
 *
 * Gating: when the `leanDifferential` executable is absent (a developer without the
 * Lean toolchain, or an un-built `.lake`), the suite is SKIPPED with a clear message
 * so `npm test` stays green; CI builds the exe so the comparison actually runs there.
 * (This is a new skip-if-exe-missing gate — NOT the `reconstructionModeUsed` gate
 * used by `lean-spec-bridge.test.ts`, which has no exe-availability gate.)
 *
 * Modes: the default run compares a bounded random sample (fast `npm test`); set
 * `LEAN_DIFF_EXHAUSTIVE=1` to enumerate all length-≤6 pairs over a 3-symbol alphabet
 * (1,194,649 pairs), reproducing the documented sweep in-repo.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { computeAtomLcs } from '../baselines/atomizer/atomLcs.js';
import { CorrelationStatus, type ComparisonUnitAtom, type OpcPart } from '../core-types.js';
import { el } from '../testing/dom-test-helpers.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

// Named const (not an inline literal) so `scripts/validate_allure_test_labels.mjs`
// can map the `.openspec([LEAN-DIFF-*])` tags deterministically to a feature.
const TEST_FEATURE = 'Lean Differential Harness (LCS)';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 4, section: '17.16.5' });

const INTEGRATION_DIR = dirname(import.meta.url.replace('file://', ''));
const PROJECT_ROOT = join(INTEGRATION_DIR, '../../../..');
const LEAN_EXE = join(PROJECT_ROOT, 'verification/lean/.lake/build/bin/leanDifferential');

const EXHAUSTIVE = process.env.LEAN_DIFF_EXHAUSTIVE === '1';
const ALPHABET = ['a', 'b', 'c'];
const SAMPLE_COUNT = 3000; // a few thousand random pairs for the default fast run
const EXHAUSTIVE_MAX_LEN = 6; // 3^0..3^6 sequences → 1093^2 = 1,194,649 pairs
const LEAN_CHUNK = 20_000; // cases per subprocess spawn (memory-bounded batching)
const SPAWN_MAX_BUFFER = 256 * 1024 * 1024;

const PART: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };

// The exhaustive sweep (~1.19M pairs) is opt-in and CI-bound; give it room.
const TEST_TIMEOUT = EXHAUSTIVE ? 600_000 : 30_000;

interface Pair {
  orig: string[];
  rev: string[];
}

interface Lcs {
  matches: number[][];
  deletedIndices: number[];
  insertedIndices: number[];
}

interface Divergence {
  index: number;
  input: Pair;
  ts: Lcs;
  lean: Lcs;
}

/** Per-case output of the Lean exe: the recursive LCS and the functional DP. */
interface LeanPair {
  classic: Lcs;
  dp: Lcs;
}

interface DpDivergence {
  index: number;
  input: Pair;
  classic: Lcs;
  dp: Lcs;
}

/**
 * Build the TS `ComparisonUnitAtom` stub for a symbol. `atomsEqual`
 * (`atomLcs.ts:112-131`) reads only `sha1Hash`, `contentElement.textContent`, and
 * `contentElement.tagName`, but we construct the full typed shape (no `as any`) so a
 * future field added to the equality check surfaces as a type error here.
 *
 * Memoized per symbol: `computeAtomLcs` only reads the atoms (it never mutates them),
 * so reusing one object per symbol collapses millions of xmldom-element builds (under
 * the exhaustive sweep) to one per distinct symbol. The cached object is frozen so that
 * if a future edit routes a mutating helper (e.g. `markCorrelationStatus`, which writes
 * `.correlationStatus`) through here, it throws loudly under ESM strict mode rather than
 * silently corrupting later cases.
 */
const tsAtomCache = new Map<string, ComparisonUnitAtom>();
function makeTsAtom(symbol: string): ComparisonUnitAtom {
  let atom = tsAtomCache.get(symbol);
  if (atom === undefined) {
    atom = Object.freeze({
      sha1Hash: symbol,
      correlationStatus: CorrelationStatus.Unknown,
      contentElement: el('w:t', {}, undefined, symbol),
      ancestorElements: [],
      ancestorUnids: [],
      part: PART,
    });
    tsAtomCache.set(symbol, atom);
  }
  return atom;
}

/** The 3-field projection the Lean exe consumes. Identity = the symbol. */
function makeLeanAtom(symbol: string): { sha1Hash: string; textContent: string; tagName: string } {
  return { sha1Hash: symbol, textContent: symbol, tagName: 'w:t' };
}

/** Run the production TS LCS and normalize matches to `[origIdx, revIdx]` tuples. */
function tsLcs(pair: Pair): Lcs {
  const result = computeAtomLcs(pair.orig.map(makeTsAtom), pair.rev.map(makeTsAtom));
  return {
    matches: result.matches.map((m) => [m.originalIndex, m.revisedIndex]),
    deletedIndices: result.deletedIndices,
    insertedIndices: result.insertedIndices,
  };
}

/**
 * Run the genuine Lean exe over a case batch, spawning once per chunk. Each result
 * carries both the recursive LCS (`classic`) and the functional Wagner–Fischer DP
 * (`dp`) for the same case.
 */
function leanLcsBatch(cases: Pair[]): LeanPair[] {
  const out: LeanPair[] = [];
  for (let i = 0; i < cases.length; i += LEAN_CHUNK) {
    const chunk = cases.slice(i, i + LEAN_CHUNK);
    const payload = JSON.stringify({
      cases: chunk.map((c) => ({
        orig: c.orig.map(makeLeanAtom),
        rev: c.rev.map(makeLeanAtom),
      })),
    });
    const proc = spawnSync(LEAN_EXE, [], {
      input: payload,
      encoding: 'utf8',
      maxBuffer: SPAWN_MAX_BUFFER,
    });
    if (proc.error) {
      throw new Error(`leanDifferential failed to spawn: ${proc.error.message}`);
    }
    if (proc.status !== 0) {
      throw new Error(`leanDifferential exited ${proc.status}: ${proc.stderr}`);
    }
    const parsed = JSON.parse(proc.stdout) as { results: LeanPair[] };
    out.push(...parsed.results);
  }
  return out;
}

/** Order-stable structural key so JS-object key ordering can't mask a match. */
function lcsKey(r: Lcs): string {
  return JSON.stringify([r.matches, r.deletedIndices, r.insertedIndices]);
}

/** Compare TS vs the recursive Lean LCS per case; collect divergences (empty = agreement). */
function findDivergences(cases: Pair[], leanResults: LeanPair[]): Divergence[] {
  const divergences: Divergence[] = [];
  for (let i = 0; i < cases.length; i++) {
    const ts = tsLcs(cases[i]!);
    const lean = leanResults[i]!.classic;
    if (lcsKey(ts) !== lcsKey(lean)) {
      divergences.push({ index: i, input: cases[i]!, ts, lean });
    }
  }
  return divergences;
}

/**
 * Compare the functional DP (`computeAtomLcsDP`) against the recursive LCS
 * (`computeAtomLcs`) per case. This is the runtime counterpart to the proven
 * `computeAtomLcsDP_eq_computeAtomLcs` (`verification/lean/LeanSpike/LcsDP.lean`):
 * the theorem makes it universal, this guards the exact executable functions.
 */
function findDpDivergences(cases: Pair[], leanResults: LeanPair[]): DpDivergence[] {
  const divergences: DpDivergence[] = [];
  for (let i = 0; i < cases.length; i++) {
    const { classic, dp } = leanResults[i]!;
    if (lcsKey(classic) !== lcsKey(dp)) {
      divergences.push({ index: i, input: cases[i]!, classic, dp });
    }
  }
  return divergences;
}

function* enumerateSequences(maxLen: number): Generator<string[]> {
  function* rec(len: number, prefix: string[]): Generator<string[]> {
    if (prefix.length === len) {
      yield prefix;
      return;
    }
    for (const symbol of ALPHABET) {
      yield* rec(len, [...prefix, symbol]);
    }
  }
  for (let len = 0; len <= maxLen; len++) {
    yield* rec(len, []);
  }
}

/** Deterministic edge cases prepended to the random sample. */
const SEED_CASES: Pair[] = [
  { orig: [], rev: [] },
  { orig: ['a'], rev: ['a'] },
  { orig: ['a'], rev: ['b'] },
  { orig: ['a', 'b'], rev: ['b', 'a'] }, // tie-break-sensitive
  { orig: ['a', 'b', 'c'], rev: ['a', 'b', 'c'] },
  { orig: ['a', 'b', 'c'], rev: [] },
  { orig: [], rev: ['a', 'b', 'c'] },
  { orig: ['a', 'a', 'b'], rev: ['a', 'b', 'b'] },
];

function buildCases(): Pair[] {
  if (EXHAUSTIVE) {
    const seqs = [...enumerateSequences(EXHAUSTIVE_MAX_LEN)];
    const cases: Pair[] = [];
    for (const orig of seqs) {
      for (const rev of seqs) {
        cases.push({ orig, rev });
      }
    }
    return cases;
  }
  const symbolArb = fc.constantFrom(...ALPHABET);
  const seqArb = fc.array(symbolArb, { minLength: 0, maxLength: 8 });
  const pairArb = fc.record({ orig: seqArb, rev: seqArb });
  const sampled = fc.sample(pairArb, { numRuns: SAMPLE_COUNT, seed: 0xd1ff });
  return [...SEED_CASES, ...sampled];
}

const exeExists = existsSync(LEAN_EXE);
if (!exeExists) {
  // eslint-disable-next-line no-console
  console.warn(
    `[lean-differential-lcs] SKIP: ${LEAN_EXE} not found. ` +
      `Build it with: (cd verification/lean && lake build leanDifferential)`,
  );
}
const describeMaybe = exeExists ? describe : describe.skip;

describeMaybe('Lean Differential Harness - LCS extensional equivalence', () => {
  test
    .openspec('[LEAN-DIFF-01] Compiled Lean LCS matches the TS LCS on generated atom-array pairs')
    .openspec('[LEAN-DIFF-02] Exhaustive sweep reproduces the documented zero-divergence result')
    .openspec('[LEAN-DIFF-03] Harness skips cleanly without the Lean toolchain and runs in CI')
    .openspec('[LEAN-DIFF-05] Functional DP computeAtomLcsDP matches the recursive computeAtomLcs on every pair')(
    'genuine Lean computeAtomLcs and TS computeAtomLcs agree on every generated pair',
    async ({ given, when, then }: AllureBddContext) => {
      let cases: Pair[] = [];
      let leanResults: LeanPair[] = [];

      await given(
        EXHAUSTIVE
          ? 'all length-≤6 atom-array pairs over a 3-symbol alphabet (exhaustive sweep)'
          : `${SEED_CASES.length} seeded edge cases plus ${SAMPLE_COUNT} random pairs over a 3-symbol alphabet`,
        async () => {
          cases = buildCases();
        },
      );

      await when('each pair is run through the in-process TS LCS and the spawned Lean executable', async () => {
        leanResults = leanLcsBatch(cases);
        expect(leanResults.length).toBe(cases.length);
      });

      await then(
        'the matches, deletedIndices, and insertedIndices are structurally identical on every case',
        async () => {
          const divergences = findDivergences(cases, leanResults);
          expect(
            divergences.length,
            divergences.length === 0
              ? ''
              : `${divergences.length}/${cases.length} cases diverged. First: ${JSON.stringify(divergences[0])}`,
          ).toBe(0);
        },
      );

      await then(
        'the functional DP computeAtomLcsDP is byte-identical to the recursive computeAtomLcs on every case ' +
          '(runtime guard over the proven computeAtomLcsDP_eq_computeAtomLcs)',
        async () => {
          const dpDivergences = findDpDivergences(cases, leanResults);
          expect(
            dpDivergences.length,
            dpDivergences.length === 0
              ? ''
              : `${dpDivergences.length}/${cases.length} DP cases diverged. First: ${JSON.stringify(dpDivergences[0])}`,
          ).toBe(0);
        },
      );
    },
    TEST_TIMEOUT,
  );

  test.openspec('[LEAN-DIFF-04] A real divergence is caught, not masked')(
    'the structural comparison flags a perturbed result rather than passing vacuously',
    async ({ given, when, then }: AllureBddContext) => {
      const pair: Pair = { orig: ['a', 'b'], rev: ['a', 'b'] };
      let realLean: Lcs;
      let perturbed: Lcs;

      await given('a case where the genuine Lean and TS outputs agree', async () => {
        realLean = leanLcsBatch([pair])[0]!.classic;
        expect(lcsKey(realLean)).toBe(lcsKey(tsLcs(pair)));
      });

      await when('the Lean-side result is perturbed (a match is dropped)', async () => {
        perturbed = {
          matches: realLean!.matches.slice(0, -1),
          deletedIndices: realLean!.deletedIndices,
          insertedIndices: realLean!.insertedIndices,
        };
      });

      await then('findDivergences reports the perturbed case with a diff, proving the check is load-bearing', async () => {
        const divergences = findDivergences([pair], [{ classic: perturbed!, dp: perturbed! }]);
        expect(divergences.length).toBe(1);
        expect(divergences[0]!.lean).toEqual(perturbed);
        expect(divergences[0]!.ts).toEqual(tsLcs(pair));
      });
    },
  );
});
