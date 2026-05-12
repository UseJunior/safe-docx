# Design: Add definitional `OoxmlDoc` subset, preservation lemma, and close `inv_field_001`

## Context

`Spec.lean:66-71` states `inv_field_001` as:

```lean
∀ (a b combined : OoxmlDoc),
  compareDocumentXml a b = some combined →
  validateFieldStructure (acceptAllChanges combined) = true ∧
  validateFieldStructure (rejectAllChanges combined) = true
```

The theorem has no `validateFieldStructure combined = true` precondition. The proof has to either:

1. Model `compareDocumentXml` definitionally and prove the output is field-valid post-accept/reject (massive scope; that's Tier 3+).
2. Carry an explicit, named residual obligation about `compareDocumentXml`'s output, prove that the obligation implies the conclusion under accept/reject, and discharge the obligation in a future change.

This change takes path (2). The residual obligation is a single named axiom, located in `Spec.lean` next to the now-closed theorem so future readers see exactly where the unproved work lives.

Peer review (codex CLI, 2026-05-12, HIGH 1) also flagged that a naive "balanced fldChar counts" precondition is not enough: `accept` can delete a whole `Del` wrapper subtree that carried a `FldChar Begin`, leaving a bare `instrText` / `Separate` / `End` whose matching `Begin` is gone. So the well-formedness predicate this change carries is *recursive*: every wrapper subtree must independently satisfy the field-balance and `instrText`-placement checks. The preservation lemma is provable on the model only against this stronger precondition.

## Decisions

### Model boundary: small tree-structured syntactic subset

```text
Doc        := List Paragraph
Paragraph  := { pPr : PPr, body : List Block }
Block      := Run Run
           |  Ins (List Block)
           |  Del (List Block)
           |  MoveFrom (List Block)
           |  MoveTo (List Block)
Run        := { rPr : RPr, content : List Atom }
Atom       := Text String
           |  DelText String
           |  InstrText String
           |  DelInstrText String
           |  FldChar FldCharKind
FldCharKind := Begin | Separate | End
PPr        := opaque marker type   -- enough to track identity, no internal structure
RPr        := opaque marker type
```

**Why this shape:**

- Mirrors OOXML's nested track-change wrappers (`w:p > w:ins > w:r > w:t`), so the `accept`/`reject` operations match `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:368-659` structurally rather than abstractly.
- Models `w:delInstrText` explicitly — the runtime engine rewrites `w:delInstrText → w:instrText` on reject (`trackChangesAcceptorAst.ts:520-559`), and proof of `inv_field_001` for the reject path needs this atom in the model to state the rewrite case.
- `w:instrText` is a logical atom, not a run-fragment. Production OOXML can fragment `w:instrText` across multiple `w:r` siblings; we treat the post-atomization view as canonical (one `InstrText` atom per logical entry).
- `PPr` and `RPr` are opaque markers — `inv_field_001` does not depend on paragraph or run properties. Codex review (MEDIUM 3) noted the TS accept-path treats arbitrary nonexcluded descendants containing `w:r` as substantive (`trackChangesAcceptorAst.ts:411,456,564`). That logic only matters for the paragraph-removal rule, which we narrow in `design.md > Accept / reject semantics` and document explicitly as a model-narrowing choice.

**Alternatives considered:**

- **A. Flat paragraph→run→atom tape** (no wrapper nesting). Rejected: misses wrapper-driven `accept` semantics (paragraph collapse when only `Del`/`MoveFrom` content remains, `trackChangesAcceptorAst.ts:381-471`), misses the unwrap-vs-drop distinction, makes the `DelInstrText → InstrText` rewrite case opaque. This was the initial draft of the recommended model and was explicitly retracted after peer review.
- **B. Full `ComparisonUnitAtom`-style projection.** Rejected: too broad. Replicates roughly twenty fields of production data (DOM refs, parent pointers, paragraph index, format change records, move group, etc.) inside Lean. Most fields are irrelevant to `inv_field_001`. Doubles modeling cost without proof payoff.

### Accept / reject semantics

Mirror `trackChangesAcceptorAst.ts:368-659` at the granularity the model exposes:

- **`accept` (`trackChangesAcceptorAst.ts:368-506`):** recurse over blocks; `Del` and `MoveFrom` children drop entirely; `Ins` and `MoveTo` children flatten (unwrap). After unwrap, paragraphs whose body collapses to empty drop. Move-range markers don't exist as separate atoms in our model — they're already folded into the wrappers, so no separate stripping pass.
- **`reject` (`trackChangesAcceptorAst.ts:509-659`):** recurse over blocks; `Ins` and `MoveTo` children drop; `Del` and `MoveFrom` children flatten; inside the flattened subtree, `DelText → Text` and `DelInstrText → InstrText` atom-level rewrite.

**Narrowing acknowledgment.** The TS paragraph-removal logic at `trackChangesAcceptorAst.ts:411,456,564` walks all non-excluded descendants looking for `w:r` children, which catches arbitrary nested OOXML structures. The Lean model encodes paragraph body as `List Block` where `Block` covers only the wrapper types we care about; non-wrapper descendants are out of model. This is a deliberate narrowing — the Tier 2.5 / Tier 3 successor changes are where the proof generalizes to a richer block shape. The narrowing is documented in `verification/lean/Tier2/README.md` and in the new requirement scenario `[LEAN-T2-04]`.

Auxiliary parts (comments, bookmarks, numbering, format-change tracking) are NOT modeled. The production engine also strips `w:rPrChange` / `w:pPrChange` on both accept and reject; since we don't model them, no explicit rule is needed.

### `validateFieldStructure` and `recursivelyWellformed`

Exact mirror of the two checks in `pipeline.ts:352-402`:

```lean
def validateFieldStructure (d : Doc) : Bool :=
  fldCharCountsBalanced d ∧ instrTextOnlyInFieldBody d
```

where `fldCharCountsBalanced` counts `FldChar Begin` and `FldChar End` atoms across the whole `Doc` in document order and checks equality, and `instrTextOnlyInFieldBody` walks all atoms tracking field depth (`Begin` increments, `End` decrements) and a `seenSeparate` flag per field, then verifies every `InstrText` occurs at positive depth with `seenSeparate = false` for its enclosing field.

The recursive well-formedness predicate is stronger, and after a second round of peer review it is **strictly stronger than `validateFieldStructure` on lifted subtrees**. Second-round codex review (2026-05-12) caught a counterexample: `Begin, Separate, Ins(Del(End, Begin), InstrText), End` satisfies "whole-doc valid AND each wrapper lifted standalone is valid" yet `accept` of it produces `Begin, Separate, InstrText, End` — invalid (InstrText after Separate). The fix: every wrapper subtree must be **field-self-contained**, i.e., when its block list is interpreted as a standalone Doc the depth/seenSeparator walk both enters and exits at `(depth = 0, seenSeparator = false)`. This rules out wrappers that straddle field boundaries.

```lean
-- A subtree is "field-self-contained" iff running the depth/seenSeparator walk
-- over its atoms in document order starting from (0, false) ends at (0, false)
-- AND never reaches an invalid InstrText state.
def fieldSelfContained (blocks : List Block) : Prop :=
  let (finalDepth, finalSeen, ok) := walkFieldState (0, false, true) blocks
  finalDepth = 0 ∧ finalSeen = false ∧ ok = true

def recursivelyWellformed (d : Doc) : Prop :=
  validateFieldStructure d = true ∧
  ∀ subtree ∈ allWrapperSubtrees d, fieldSelfContained subtree
```

where `allWrapperSubtrees` collects every `Ins` / `Del` / `MoveFrom` / `MoveTo` child block list in the tree (transitively). `fieldSelfContained` is what survives `accept`'s drop-wrapper and unwrap-wrapper operations: dropping a self-contained subtree subtracts a balanced (0,false)→(0,false) segment from the outer walk, leaving the outer state unchanged; unwrapping a self-contained subtree splices in a balanced segment that likewise leaves the outer state unchanged.

**This stronger property is what the preservation lemma actually needs**, and is what the residual axiom `compareDocumentXml_output_recursivelyWellformed` asserts about comparison output. Empirically, OOXML comparison engines that wrap whole fields in `w:ins` / `w:del` (rather than half-fields) satisfy this property — see the production behavior at `packages/docx-core/src/integration/collapsed-field-inplace.test.ts:243` ("w:del must not pack all field atoms into a single run" — i.e., the wrapper contains the COMPLETE field sequence, which is field-self-contained). The axiom is the standing claim that the production atomizer never produces a half-field wrapper.

### Preservation lemma

```lean
theorem field_structure_preserved :
  ∀ d, recursivelyWellformed d →
    validateFieldStructure (accept d) = true ∧
    validateFieldStructure (reject d) = true
```

Proof sketch for `accept`:
- `accept` drops `Del`/`MoveFrom` wrapper children. Because `recursivelyWellformed d` ensures each such subtree is `fieldSelfContained` (enters and exits the depth/seenSeparator walk at `(0, false)`), removing it from the outer document leaves the outer walk's state at the wrapper's position unchanged. Net effect on the outer atom sequence: the wrapper's contribution to global counts and depth state vanishes, but no atom OUTSIDE the wrapper changes meaning.
- `accept` unwraps `Ins`/`MoveTo` wrappers but keeps their children. Because the wrapper is `fieldSelfContained`, splicing its children into the outer block list at the wrapper's position leaves the outer walk state at that position identical to what it was before unwrapping (the children contribute the same balanced (0,false)→(0,false) segment they did inside the wrapper). Atoms after the wrapper see the same `(depth, seen)` state regardless of unwrapping.
- Paragraph drop after collapse removes empty paragraphs, which contribute no `FldChar` or `InstrText` atoms.

Proof sketch for `reject`:
- Symmetric: drop `Ins`/`MoveTo`; unwrap `Del`/`MoveFrom`. Same `fieldSelfContained` reasoning applies. The `DelInstrText → InstrText` rewrite changes an atom's tag but not its position relative to the surrounding `FldChar` atoms, AND a `DelInstrText` atom only appears inside a `Del` wrapper (by model construction). After unwrapping the `Del`, the rewritten `InstrText` sits at the same depth its predecessor `DelInstrText` did. Because the wrapper was field-self-contained, that depth is positive and `seenSeparator = false` — so the rewritten `InstrText` is at a valid position.
- `DelText → Text` is irrelevant to the field-structure predicate.

Each sketch becomes a series of helper lemmas in `Tier2/InvFieldOne.lean` (T4a / T5a in `tasks.md`).

### Axiom rewiring in `Spec.lean`

Three axioms become definitions over the Tier 2 model:

```lean
abbrev OoxmlDoc : Type := Tier2.OoxmlModel.Doc
def acceptAllChanges : OoxmlDoc → OoxmlDoc := Tier2.AcceptReject.accept
def rejectAllChanges : OoxmlDoc → OoxmlDoc := Tier2.AcceptReject.reject
def validateFieldStructure : OoxmlDoc → Bool := Tier2.FieldStructure.validateFieldStructure
```

Three axioms remain (deferred to Tier 3 or `inv_rt_001` successor):

```lean
axiom compareDocumentXml : OoxmlDoc → OoxmlDoc → Option OoxmlDoc
axiom extractTextWithParagraphs : OoxmlDoc → String
axiom normalizeText : String → String
```

One new axiom, the single named residual obligation:

```lean
/-- Residual obligation: `compareDocumentXml`'s inplace-mode output is recursively
    well-formed. This axiom is the single load-bearing assumption behind the
    `inv_field_001` closure. Tier 3 will discharge it by modeling
    `compareDocumentXml` definitionally. Empirically motivated by
    `packages/docx-core/src/integration/lean-spec-bridge.test.ts` (incl. the new
    field-bearing case added in this change) at 100 runs/property × 0
    falsifications gated on `reconstructionModeUsed === 'inplace'`. -/
axiom compareDocumentXml_output_recursivelyWellformed :
  ∀ a b combined, compareDocumentXml a b = some combined →
    Tier2.FieldStructure.recursivelyWellformed combined
```

The `Spec.lean:71` sorry is replaced by:

```lean
intro a b combined h
have hRW := compareDocumentXml_output_recursivelyWellformed a b combined h
exact Tier2.InvFieldOne.field_structure_preserved combined hRW
```

### What the proof says, what it does NOT say

- **Says:** `inv_field_001` follows from a single named axiom about `compareDocumentXml` output well-formedness and a machine-checked preservation lemma over the Lean model.
- **Does NOT say:** the residual axiom is discharged. That is Tier 3.
- **Does NOT say:** the Lean `accept`/`reject` are extensionally equivalent to the TS `acceptAllChanges`/`rejectAllChanges`. That is Tier 2.5.
- **Does NOT say:** anything about `inv_rt_001`, hierarchical paragraph-level LCS, reconstruction paths in `inPlaceModifier.ts` / `documentReconstructor.ts`, or auxiliary parts.

These boundaries get a dedicated paragraph in `verification/lean/Tier2/README.md` so a reader of the proof artifact cannot misread its scope.

## Stop conditions

Mirror the original spike (`/Users/stevenobiajulu/.claude/plans/what-would-it-look-optimized-alpaca.md`):

- Abandon if the preservation lemma `field_structure_preserved` hasn't closed within a calendar quarter of focused work.
- Abandon if mathlib's `List` / `Nat` / `Bool` lemmas prove insufficient for stating field-depth invariants cleanly.
- Abandon if extensional review by gemini + codex CLI flags the Lean `accept`/`reject` as so divergent from the TS that the resulting closure says nothing about the production code.

On abandon: preserve the partial work as evidence and pivot to the successor changes (`add-accept-reject-lean-ts-equivalence` first, then revisit Tier 2 with a different model boundary).
