# Lean 4 verification spike

This directory contains an experimental Lean 4 project for verifying a narrow part of the `safe-docx` comparison engine without turning Lean into an npm workspace package.

This spike now includes a Lean model of the atom-level LCS computation from `packages/docx-core/src/baselines/atomizer/atomLcs.ts:45-104` and a full proof of the four planned LCS invariants on that model.

**Important framing:** the Lean implementation is an *alternate executable specification* of the same LCS, not a line-for-line port of the TypeScript. The TS uses an explicit DP table with backtracking; the recursive Lean `computeAtomLcs` uses direct computation over reversed inputs. They produce the same `matches` (verified by exhaustive brute-force testing on all sequence pairs of length ≤ 6 over a 3-symbol alphabet — 1.19M cases, zero divergence — see Stage 2 peer review). The gap between "same `matches` empirically" and "same `matches` provably" is now closed internally: `LeanSpike/LcsDP.lean` defines a functional Wagner-Fischer DP (`computeAtomLcsDP`) in the *same style* as the TS algorithm and proves it is byte-identical to the recursive `computeAtomLcs` on every input (`computeAtomLcsDP_eq_computeAtomLcs`). Extensional equivalence with the *production TS code specifically* is still established empirically by the in-CI differential harness rather than by proof (Lean cannot reason about TS source).

## Files

- `LeanSpike.lean`
- `LeanSpike/Atom.lean`
- `LeanSpike/AtomsEqual.lean`
- `LeanSpike/Lcs.lean`
- `LeanSpike/LcsDP.lean` — functional Wagner-Fischer DP (`lcsLen`/`dpMatches`/`computeAtomLcsDP`), its proven equivalence to the recursive `computeAtomLcs`, and the `atomsEqual`-level optimality strengthening.
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
- `INV-LCS-DP-001` in `LeanSpike/LcsDP.lean`: **DP-equivalence (exact output).** The functional Wagner-Fischer DP `computeAtomLcsDP` produces a byte-identical `LcsResult` to the recursive `computeAtomLcs` on every input (`computeAtomLcsDP_eq_computeAtomLcs`), via `lcsLen_eq_rawMatches_length` (the length recurrence agrees) and `dpMatches_eq_rawMatches` (the backtracker makes the same tie-break decisions). This is the universal counterpart to the 1.19M-pair differential.
- `INV-LCS-002+` in `LeanSpike/LcsDP.lean`: **`atomsEqual`-level optimality** (`rawMatches_are_longest_relevant`). Strengthens INV-LCS-002 from structural common subsequences to common subsequences of the relevant projections (`orig.map Atom.relevant`, `rev.map Atom.relevant`) — the genuinely-stronger statement after the `Atom` broadening (see the scope note below).

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
  model (`Tier2/`) and composes the machine-checked document-level preservation
  lemma `Tier2.InvFieldOne.field_structure_preserved_doc` with a single named
  residual axiom — see the Specification Gap section below.
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

`LeanSpike/Atom.lean` models a `ComparisonUnitAtom` with the three **LCS-relevant** fields that `atomsEqual` inspects, plus one representative **LCS-irrelevant** field:

- `sha1Hash : String` — relevant
- `textContent : String` — relevant
- `tagName : String` — relevant
- `correlationStatus : Nat := 0` — irrelevant (stands in for the production atom's correlation status / ancestry / part; `atomsEqual` never reads it)

`Atom.relevant a := (a.sha1Hash, a.textContent, a.tagName)` names the three-field LCS projection. Carrying at least one ignored field keeps the model faithful: `atomsEqual` correlates atoms *up to `Atom.relevant`*, not up to structural identity (so `atomsEqual a b = true` does NOT imply `a = b`). The projection intentionally flattens `contentElement.textContent ?? ""` into a total `textContent : String`. Any `null` handling is assumed to happen before an atom is translated into the Lean model.

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

### Resolved: `Atom` projection broadened past `atomsEqual_implies_eq`

Earlier stages relied on a lemma that *overfit* the 3-field projection:

```
theorem atomsEqual_implies_eq {a b : Atom} (hEq : atomsEqual a b = true) : a = b
```

It concluded *full atom equality* (`a = b`), which held only because `Atom` exposed exactly the three fields `atomsEqual` inspects. The `Atom` model has since been **broadened** to carry an LCS-irrelevant field (`correlationStatus`, standing in for the production `ComparisonUnitAtom`'s correlation status / ancestry / part), so `atomsEqual a b` no longer implies `a = b` — two atoms can be `atomsEqual` while differing in `correlationStatus`.

`atomsEqual_implies_eq` is therefore **retired**. The LCS soundness proof is now keyed on the surviving companion `atomsEqual_implies_relevant_eq` (`AtomsEqual.lean`), which concludes only that the atoms share their LCS-relevant projection `Atom.relevant = (sha1Hash, textContent, tagName)`. The soundness theorems `rawMatches_subsequence` and `lcs_matches_are_common_subsequence` (INV-LCS-001) were re-engineered: their matched-atom equality conjunct is now `(matchedOriginalAtoms …).map Atom.relevant = (matchedRevisedAtoms …).map Atom.relevant`, and `commonSubseq_drop_equal_heads` was generalized to `commonSubseq_drop_heads` (its length bound is head-agnostic, so it no longer needs the two heads to be structurally equal). The full spike remains zero-`sorry`.

**Scope note on optimality (INV-LCS-002) — resolved.** `rawMatches_are_longest` bounds the length of every *structural* common subsequence (`isCommonSubseq s orig rev := s <+ orig ∧ s <+ rev`, i.e. literal sublists of both). It remains true and non-vacuous after broadening, but it is *strictly weaker* than "longest under `atomsEqual`": because `atomsEqual` correlates atoms only up to `Atom.relevant`, an `atomsEqual`-matchable common subsequence need not be a structural sublist of both inputs. This gap is now closed by `rawMatches_are_longest_relevant` (`LeanSpike/LcsDP.lean`), which bounds every common subsequence of the relevant projections (`orig.map Atom.relevant`, `rev.map Atom.relevant`) — i.e. optimality at the `atomsEqual` level. It is provably stronger: e.g. two atoms with equal `Atom.relevant` but differing `correlationStatus` have an `atomsEqual`-matchable common subsequence of length 1 that is *not* a structural sublist of both. The proof reuses the `rawMatches_are_longest` induction skeleton, lifted to projected lists via a type-polymorphic `sublist_drop_heads` and the converse lemma `atomsEqual_of_relevant_eq` (projection equality ⇒ `atomsEqual`).

## Lean relationship-story checker

`Tier2/XmlTripleChecker.lean` retains the generic six-check story collection.
`Tier2/RelationshipStorySelector.lean` adds the protocol-v4 package inventory
and selector. The `leanDocxChecker` executable receives only paths to exact
original, revised, and compared DOCX snapshots; TypeScript does not provide a
story manifest or pre-resolved relationship targets.

Lean parses a bounded classic single-disk ZIP central directory and matching
local headers. ZIP64, encryption, data descriptors, unsupported methods or
flags, ambiguous names, unsafe paths, duplicate names, and overlapping local
records fail before evidence. `unzip -p --` is used only after the binary index
proves one exact safe entry, and the resulting byte length and CRC-32 must match
the index. This is a bounded extraction policy, not full OPC conformance.

The required `word/document.xml` must extract, decode, parse, tokenize, and
produce an ancestry-aware inventory of exact direct
`w:body/w:sectPr` and `w:body/w:p/w:pPr/w:sectPr` placements on all three
sides before any valid v4 response exists. It must contain exactly one direct
`w:body`; nested/multiple bodies, duplicate body-level terminal `w:sectPr`, or
a body element after that terminal section fail as process-level `not_run`.
Other section placements and references outside an open supported direct
section are structured selection issues.
Optional footnotes/endnotes remain fixed stories; post-main optional failures
are structured. Direct explicit first/default/even header/footer bindings are
resolved through each package's independently parsed
`word/_rels/document.xml.rels`.

Resource admission is deterministic: required main runs first; relationship
XML, complete selected-target metadata, and selected physical work run next;
footnotes follow; endnotes are last. Unique-path and selected compressed/
expanded metadata ceilings are checked before any selected target is
decompressed. Optional metadata crossings are fixed-story issues and are not
extracted. XML events are checked against the remaining per-part and
per-package budget while parsing, and semantic tokens come from that bounded
event stream; aggregate exhaustion stops later work while retaining earlier
truthful relationship evidence. Event/depth/structural parse failures are
typed and retain completed/observed counts. Event-limit failure at remaining
aggregate allowance less than or equal to the per-part ceiling is aggregate
exhaustion; only larger aggregate headroom yields per-part classification.

Logical slots align by `(sectionOrdinal, kind, role)`. Section-count or ordered
slot differences fail closed; no semantic section identity is claimed.
Relationship IDs and normalized paths remain side-specific. Equal complete
three-side target keys are checked once, with every selecting slot ordinal
retained in canonical order. If one physical target fails to load, valid
independent physical stories and their contiguously reindexed slots remain in
the failed response. Raw or repeatedly decoded `*`, `[`, and `]` targets are
unsafe. Missing roles are not inherited, and unselected parts receive no
passing evidence.

Every fixed and selected physical story uses the existing generic checker:

- accepting all tracked changes in the compared XML recovers the revised text;
- rejecting all tracked changes in the compared XML recovers the original text;
- the accept and reject projections keep valid Word field structure; and
- the compared XML has valid field-marker and tracked-move structure.

The four selector/aggregate theorem targets quantify over the checked pure
functions invoked by `LeanDocxChecker`: per-side identifying issue-or-exact-slot
completeness, unique work assignment, canonical ordered locator equality, and
exact loaded-work/name/token-triple correspondence. No result carries proof fields.
Aggregate soundness reuses `story_collection_checker_sound`. The public certificate stays
at version 1; checker protocol version 4, relationship scope, slots, physical
stories, fixed-story failures, and selection failures are additive fields.
Rebuild remains `not_applicable`. Inherited roles, unselected parts, comments,
complete relationship/OPC/schema validation, pagination, rendering, field
evaluation, and full ECMA-376 conformance remain excluded. Exact surfaces are in
`verification/registry/lean-xml-checker-coverage.json` and drift-checked by
`npm run check:lean-xml-checker-coverage`.

## Build

This spike pins:

- Lean 4 toolchain: `leanprover/lean4:v4.29.1`
- mathlib4 dependency: `v4.29.1`

Using the committed manifest and existing toolchain, verify the proof:

```bash
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
