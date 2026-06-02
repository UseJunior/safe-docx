# Lean 4 verification spike

This directory contains an experimental Lean 4 project for verifying a narrow part of the `safe-docx` comparison engine without turning Lean into an npm workspace package.

This spike now includes a Lean model of the atom-level LCS computation from `packages/docx-core/src/baselines/atomizer/atomLcs.ts:45-104` and a full proof of the four planned LCS invariants on that model.

**Important framing:** the Lean implementation is an *alternate executable specification* of the same LCS, not a line-for-line port of the TypeScript. The TS uses an explicit DP table with backtracking; the Lean uses recursive direct computation over reversed inputs. They produce the same `matches` (verified by exhaustive brute-force testing on all sequence pairs of length ≤ 6 over a 3-symbol alphabet — 1.19M cases, zero divergence — see Stage 2 peer review), but the proof obligation here is "soundness of the Lean model," not "soundness of the TypeScript implementation." Extensional equivalence between the Lean model and the TS code remains deferred future work.

## Files

- `LeanSpike.lean`
- `LeanSpike/Atom.lean`
- `LeanSpike/AtomsEqual.lean`
- `LeanSpike/Lcs.lean`
- `LeanSpike/Spec.lean`
- `Tier2.lean` and `Tier2/` — the Tier 2 definitional `OoxmlDoc` subset and the
  closed `inv_field_001` proof. See `Tier2/README.md`.

## Current proof scope

Currently proved in this stage:

- `INV-ATOMSEQ-001` in `LeanSpike/AtomsEqual.lean`: if `atomsEqual` returns `true`, then `textContent` and `tagName` are equal. This captures the intended hash-collision safety property: matching `sha1Hash` values are never treated as sufficient on their own.
- `INV-LCS-001` in `LeanSpike/Lcs.lean`: **value-level subsequence soundness.** The dereferenced atom values from the matches (i.e. `matchedOriginalAtoms` and `matchedRevisedAtoms`) form a sublist of `original` and `revised` respectively, and every reported match pair `(i, j)` references in-bounds atoms `original[i]` and `revised[j]` with `atomsEqual = true`.
- `INV-LCS-002` in `LeanSpike/Lcs.lean`: **optimality.** Any common subsequence of the two input atom lists is no longer than the matched subsequence returned by `computeAtomLcs`.
- `INV-LCS-003` in `LeanSpike/Lcs.lean`: **strict index monotonicity.** The reported match pairs are pairwise strictly increasing in both original and revised indices.
- `INV-LCS-004` in `LeanSpike/Lcs.lean`: **partition completeness.** Matched and deleted original indices partition `range original.length`, and matched and inserted revised indices partition `range revised.length`.

## Specification targets

`LeanSpike/Spec.lean` carries two named specification targets. Both are now
**closed**: `INV-FIELD-001` in Tier 2, and `INV-RT-001` in the `add-inv-rt-001-proof`
successor change. The spike is now zero-`sorry`, carrying one named residual
axiom per invariant (both owned by Tier 3 — see the Specification Gap section).

- `INV-FIELD-001` in `LeanSpike/Spec.lean`: **closed.** `validateFieldStructure`,
  scoped to the inplace-mode comparison output `compareDocumentXml a b`, is
  preserved by both `acceptAllChanges` and `rejectAllChanges`. This mirrors the
  syntactic scan in `packages/docx-core/src/baselines/atomizer/pipeline.ts:352-402`,
  the actual field-structure call site at `pipeline.ts:439-440` inside
  `evaluateSafetyChecks` (`pipeline.ts:404-440`, gated on the inplace branch at
  `pipeline.ts:669`), and the inplace-mode comparison-output surface assigned at
  `pipeline.ts:635-650`. The closure rewires the `OoxmlDoc` / `acceptAllChanges` /
  `rejectAllChanges` / `validateFieldStructure` axioms to the definitional Tier 2
  model (`Tier2/`) and composes the machine-checked preservation lemma
  `Tier2.InvFieldOne.field_structure_preserved` with a single named residual
  axiom — see the Specification Gap section below.
- `INV-RT-001` in `LeanSpike/Spec.lean`: **closed.** Paired round-trip text
  recovery, with `acceptAllChanges` matching the revised document and
  `rejectAllChanges` matching the original document after
  `normalizeText ∘ extractTextWithParagraphs`. This mirrors the helper functions
  in `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:660-688`
  (`extractTextWithParagraphs`) and `trackChangesAcceptorAst.ts:701-711`
  (`normalizeText`), plus the gold-standard paired assertions in
  `packages/docx-core/src/integration/round-trip-inplace.test.ts:56-63` and
  `:87-94`, with a second paired fixture at
  `packages/docx-core/src/integration/nvca-coi-regression.test.ts:77-103`. The
  closure rewires the `extractTextWithParagraphs` / `normalizeText` axioms to the
  definitional Tier 2 model (`Tier2/RoundTripText.lean`, per-paragraph text as
  `List Char`) and composes the machine-checked round-trip lemmas
  `Tier2.RoundTripText.extractText_accept_normalized` and
  `Tier2.RoundTripText.extractText_reject` with a single named residual axiom —
  see the Specification Gap section below.

Every module — Stage 1-3, all of `Tier2/`, and `Spec.lean` — is now zero-`sorry`.

For interactive auditing, inspect `#print axioms inv_field_001` and
`#print axioms inv_rt_001` — each depends on its single named residual axiom
(`compareDocumentXml_output_preservation_friendly`,
`compareDocumentXml_output_text_roundtrip`) and not on `sorryAx`.

## Still out of scope

This spike still does not cover:

- closed proofs of reconstruction invariants
- discharged proofs of the two named residual axioms
  (`compareDocumentXml_output_preservation_friendly`,
  `compareDocumentXml_output_text_roundtrip`) — both carried by the `inv_field_001`
  / `inv_rt_001` closures as named assumptions about this repo's inplace atomizer
  output (Tier 3 work)
- extensional equivalence between the Lean model and the production TypeScript implementation

## Lean model

`LeanSpike/Atom.lean` projects a `ComparisonUnitAtom` down to exactly three fields:

- `sha1Hash : String`
- `textContent : String`
- `tagName : String`

The projection intentionally flattens `contentElement.textContent ?? ""` into a total `textContent : String`. Any `null` handling is assumed to happen before an atom is translated into the Lean model.

## Specification Gap

### Tier 2 residual axiom (`inv_field_001`)

The closed `inv_field_001` proof carries exactly one named residual axiom:
`compareDocumentXml_output_preservation_friendly` in `LeanSpike/Spec.lean`. It
asserts that this repo's inplace atomizer output satisfies
`Tier2.AcceptReject.preservationFriendly` (PR #220 weakened this from the stronger
`Tier2.FieldStructure.recursivelyWellformed`) — scoped to this repo's inplace
atomizer, NOT to OOXML comparison engines in general. Discharging it by modeling
`compareDocumentXml` definitionally is **Tier 3** work. Extensional equivalence
between the Lean `accept` / `reject` and the production TS
`acceptAllChanges` / `rejectAllChanges` is **Tier 2.5** work and is not
established here. The production engine's runtime `validateFieldStructure` check
is not made redundant by this proof. The model also deliberately narrows the TS
paragraph-removal logic (`trackChangesAcceptorAst.ts:411,456,564`) by treating
only wrapper blocks as substantive. Full detail is in `Tier2/README.md`.

A TS-side falsifiability layer for the residual axiom — one field-bearing fixture
case checking a TS analogue of `recursivelyWellformed` against the live engine —
lives in `packages/docx-core/src/integration/lean-spec-bridge.test.ts`.

### Tier 2 residual axiom (`inv_rt_001`)

The closed `inv_rt_001` proof carries one named residual axiom:
`compareDocumentXml_output_text_roundtrip` in `LeanSpike/Spec.lean`. It asserts
that, for this repo's inplace atomizer output `combined`, the normalized
revised-side text projection of `combined` (`Tier2.RoundTripText.revisedText`)
equals the normalized text of the revised input, and the normalized original-side
projection (`originalText`) equals the normalized text of the original input. It
is stated over text projections of `combined` alone (no `accept` / `reject`), so
the machine-checked lemmas `extractText_accept_normalized` and
`extractText_reject` carry the connection to `acceptAllChanges` /
`rejectAllChanges` — the axiom is not a restatement of `inv_rt_001`. Like the
`inv_field_001` residual axiom it is scoped to this repo's inplace atomizer (NOT
OOXML engines in general) and discharging it is **Tier 3** work.

Further residual gaps are documented in `Tier2/README.md` and owned by
**Tier 2.5**: (a) `normalizeText` is modeled over a paragraph list (`List Char`
per entry) capturing only the trim + blank-entry-drop behaviour; the TS regex's
intra-line multi-space/tab collapse is not modeled; (b) `extractText` keeps
structural document order, whereas the TS helper emits all `w:t` then all
`w:delText`; (c) extensional equivalence between the Lean `extractText` /
`normalizeText` and the production TS `extractTextWithParagraphs` /
`normalizeText` is not established. The bridge fixture runs the live TS
`normalizeText` / `extractTextWithParagraphs` end-to-end (its NUMPAGES text has no
whitespace runs, so it does not specifically target gap (a)).

### Tier 1 `Atom` projection gap

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

To confirm the entire spike is `sorry`-free:

```bash
grep -rnw "sorry" LeanSpike.lean LeanSpike Tier2.lean Tier2   # must be empty
```

For interactive auditing, inspect `#print axioms LeanSpike.inv_rt_001` — it
depends only on the standard logical axioms (`propext`, `Classical.choice`,
`Quot.sound`), `compareDocumentXml`, and the single residual axiom
`compareDocumentXml_output_text_roundtrip` (no `sorryAx`).
