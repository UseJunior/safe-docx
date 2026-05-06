# Lean 4 verification spike

This directory contains an experimental Lean 4 project for verifying a narrow part of the `safe-docx` comparison engine without turning Lean into an npm workspace package.

Stage 2 adds a Lean model of the atom-level LCS computation from `packages/docx-core/src/baselines/atomizer/atomLcs.ts:45-104` and proves a value-level soundness invariant about the produced matches.

**Important framing:** the Lean implementation is an *alternate executable specification* of the same LCS, not a line-for-line port of the TypeScript. The TS uses an explicit DP table with backtracking; the Lean uses recursive direct computation over reversed inputs. They produce the same `matches` (verified by exhaustive brute-force testing on all sequence pairs of length ≤ 6 over a 3-symbol alphabet — 1.19M cases, zero divergence — see Stage 2 peer review), but the proof obligation here is "soundness of the Lean model," not "soundness of the TypeScript implementation." Extensional equivalence between the Lean model and the TS code is a deferred Stage 3+ obligation.

## Files

- `LeanSpike.lean`
- `LeanSpike/Atom.lean`
- `LeanSpike/AtomsEqual.lean`
- `LeanSpike/Lcs.lean`

## Current proof scope

Currently proved in this stage:

- `INV-ATOMSEQ-001` in `LeanSpike/AtomsEqual.lean`: if `atomsEqual` returns `true`, then `textContent` and `tagName` are equal. This captures the intended hash-collision safety property: matching `sha1Hash` values are never treated as sufficient on their own.
- `INV-LCS-001` in `LeanSpike/Lcs.lean`: **value-level subsequence soundness.** The dereferenced atom values from the matches (i.e. `matchedOriginalAtoms` and `matchedRevisedAtoms`) form a sublist of `original` and `revised` respectively, and every reported match pair `(i, j)` references in-bounds atoms `original[i]` and `revised[j]` with `atomsEqual = true`. **This does NOT yet prove that the match index pairs are strictly monotone** — with duplicate atoms in the input, in principle a crossing or repeated-index pair list could still produce equal value-level sublists. Index-level monotonicity is captured by `INV-LCS-003` in Stage 3. The Lean recursion's structure makes monotonicity true by construction, but the formal guarantee awaits Stage 3.

## Not yet proved (deferred to Stage 3)

This stage deliberately does not cover:

- `INV-LCS-002`: optimality of the computed atom LCS
- `INV-LCS-003`: strict monotonicity of matched original/revised indices
- `INV-LCS-004`: partition completeness for matched, deleted, and inserted indices
- reconstruction invariants
- round-trip text equality
- field-structure / document-shape preservation

## Lean model

`LeanSpike/Atom.lean` projects a `ComparisonUnitAtom` down to exactly three fields:

- `sha1Hash : String`
- `textContent : String`
- `tagName : String`

The projection intentionally flattens `contentElement.textContent ?? ""` into a total `textContent : String`. Any `null` handling is assumed to happen before an atom is translated into the Lean model.

## Specification Gap

The Lean `Atom` is intentionally narrower than the TypeScript `ComparisonUnitAtom` in `packages/docx-core/src/core-types.ts`.

The projection omits the nested `contentElement` object itself and all non-equality metadata, including:

- DOM/context references such as `sourceRunElement`, `sourceParagraphElement`, `ancestorElements`, `ancestorUnids`, `revTrackElement`, and `part`
- indexing and layout metadata such as `paragraphIndex` and `isEmptyParagraph`
- move and format metadata such as `moveGroupId`, `moveName`, `formatChange`, and `comparisonUnitAtomBefore`
- reconstruction and splitting metadata such as `collapsedFieldAtoms`, `splitFromAtom`, `sourceDocument`, and `rPr`
- roughly fifteen additional fields and references carried by the broader TypeScript comparison pipeline

That gap is deliberate in Stage 1: the proof targets only the equality predicate consumed by LCS, not the full reconstruction model.

### Caveat: `atomsEqual_implies_eq` overfits the 3-field projection

The Stage 2 LCS proof relies on a stronger lemma than `INV-ATOMSEQ-001`:

```
theorem atomsEqual_implies_eq {a b : Atom} (hEq : atomsEqual a b = true) : a = b
```

This concludes *full atom equality* (`a = b`), not just `textContent` and `tagName` equality. It holds for the current 3-field projected `Atom` because `atomsEqual` checks all three fields and the structure has no other fields to differ on. **It would NOT hold** if the projection were broadened toward the real `ComparisonUnitAtom` (which has ~20 fields including DOM references, paragraph indices, format-change metadata, etc.). The lemma is load-bearing in the LCS soundness proof — used in the equality branch to substitute the matched atoms for each other.

If a future stage broadens the `Atom` projection, this lemma must be replaced by a weaker version (e.g. `atomsEqual_implies_relevant_fields_eq`) and the LCS proof's equality branch must be re-engineered accordingly.

## Build

This spike pins:

- Lean 4 toolchain: `leanprover/lean4:v4.29.1`
- mathlib4 dependency: `v4.29.1`

To fetch dependencies and verify the proof:

```bash
lake update
lake build
```

To confirm the stage remains `sorry`-free:

```bash
grep -rn "sorry" LeanSpike/
```
