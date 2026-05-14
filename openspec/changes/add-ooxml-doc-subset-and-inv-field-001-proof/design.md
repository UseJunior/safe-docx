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

Peer review has gone through three rounds. **Round 1** (codex CLI, 2026-05-12, HIGH 1) flagged that a naive "balanced fldChar counts" precondition is not enough: `accept` can delete a whole `Del` wrapper subtree that carried a `FldChar Begin`, leaving a bare `instrText` / `Separate` / `End` whose matching `Begin` is gone. **Round 2** (codex CLI, same day) caught the counterexample `Begin, Separate, Ins(Del(End, Begin), InstrText), End` — even per-subtree `validateFieldStructure` is too weak. **Round 3** (codex + gemini CLI, 2026-05-13) caught three further families of counterexamples that defeat any predicate of the form "the standalone walk from `(0, false)` ends at `(0, false)`":

- **Family A — `DelInstrText` is unchecked.** `Del(DelInstrText)` validates because the standalone walk sees no `InstrText`, but `reject` rewrites `DelInstrText → InstrText` and unwraps the `Del`, leaving a bare `InstrText` outside any field.
- **Family B — subtree consumes outer field state via leading `End` / `Separate`.** `Begin, Ins(End)` is whole-doc valid (one Begin, one End), and the `Ins(End)` subtree from depth 0 underflows — but a predicate that clamps depth at zero or only inspects the standalone walk's `(depth, seen)` final pair can miss this. After `reject` drops the `Ins`, a bare `Begin` is left and validation fails. `Begin, Del(End)` does the same for `accept`.
- **Family C — single-boolean `seenSeparator` reset.** `[Begin, Separate, Del(Begin, End), InstrText, End]` validates whole-doc *if* `seenSeparator` is a single mutable boolean reset on every `End` (the inner `End` resets it, so the trailing `InstrText` looks pre-separator). After `accept` drops the `Del`, the `InstrText` sits at outer depth 1 with separator already seen and fails. The fix is to track separator state as a **stack indexed by depth** — which is what TS `pipeline.ts:374-389` actually does (`pastSeparatorAtDepth: number[]`).

So the well-formedness predicate this change carries is **recursive AND context-neutral over a stack-valued field state**. Every wrapper subtree must, when its atoms are scanned in document order under *any* outer field-stack context, leave that outer context unchanged AND never produce a locally invalid state. The preservation lemma is provable on the model only against this strictly stronger precondition.

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

### `validateFieldStructure`, `FieldCtx`, and `recursivelyWellformed`

Exact mirror of the two checks in `pipeline.ts:352-402`:

```lean
def validateFieldStructure (d : Doc) : Bool :=
  fldCharCountsBalanced d ∧ instrTextOnlyInFieldBody d
```

`fldCharCountsBalanced` counts `FldChar Begin` and `FldChar End` atoms across the whole `Doc` in document order and checks equality. `instrTextOnlyInFieldBody` walks all atoms tracking a **stack of separator-seen bits indexed by depth** (mirroring the TS `pastSeparatorAtDepth: number[]` at `pipeline.ts:375`): `Begin` pushes a fresh `false` onto the stack; `Separate` sets the top of the stack to `true` (no-op when the stack is empty, matching `pipeline.ts:387`'s `if (depth > 0)` guard); `End` pops the stack (no-op when empty, matching `pipeline.ts:389`'s guard). Every `InstrText` must occur with the stack non-empty AND its top bit `false`. **Note on the TS engine's `End`-from-depth-0 behavior**: `pipeline.ts:388-390` silently ignores a stray `End`, which means the global "begins == ends" balance check is the load-bearing guard; the Lean walk mirrors this exactly.

The Tier 2 model lifts this walk to a typed **field-context** datatype:

```lean
def FieldCtx : Type := List Bool   -- stack of pastSeparatorAtDepth, top = innermost field

inductive WalkResult
| ok      (ctx : FieldCtx)
| invalid

def stepAtom (r : WalkResult) (a : Atom) : WalkResult := ...
def stepBlock (r : WalkResult) (b : Block) : WalkResult := ...      -- recurses into wrappers
def walkBlocks (start : WalkResult) (bs : List Block) : WalkResult :=
  bs.foldl stepBlock start
```

`stepAtom` produces `WalkResult.invalid` on `InstrText` / `DelInstrText` when the context is empty or its top bit is `true`. `stepBlock` for a wrapper variant just recurses `walkBlocks r children` — wrappers are transparent to the context-walk because they don't contribute their own field-state atoms (TS `validateFieldStructure` recurses through every element via `scan(el)` at `pipeline.ts:396` regardless of tag).

**Round 3's three counterexample families fall out of strengthening the per-subtree predicate from "standalone walk from `(0, false)` ends at `(0, false)`" to "context-neutral over any outer context":**

```lean
/-- A wrapper subtree's block list is "field-context-neutral" iff scanning it
    under any starting field context leaves that context unchanged AND never
    produces `WalkResult.invalid`. Equivalently: the subtree may not pop the
    outer context (no leading `End`), may not flip a `seenSeparator` bit on the
    outer context (no `Separate` while the local-pushed-since-entry stack is
    empty), may not place `InstrText` / `DelInstrText` outside a locally-pushed
    pre-separator field, and must end with the same context it entered with. -/
def fieldContextNeutral (blocks : List Block) : Prop :=
  ∀ ctx, walkBlocks (.ok ctx) blocks = .ok ctx

def recursivelyWellformed (d : Doc) : Prop :=
  validateFieldStructure d = true ∧
  ∀ subtree ∈ allWrapperSubtrees d, fieldContextNeutral subtree
```

where `allWrapperSubtrees d` collects every `Ins` / `Del` / `MoveFrom` / `MoveTo` child block list in the tree (transitively). The predicate is named **`fieldContextNeutral`** rather than `fieldSelfContained` to make the round-3 strengthening explicit at every callsite.

**How this rules out each round-3 counterexample family:**

- **Family A** (`Del(DelInstrText)`): the wrapper subtree `[DelInstrText]` is not context-neutral — under `ctx = []`, `stepAtom` of a `DelInstrText` produces `WalkResult.invalid` (the predicate explicitly checks both `InstrText` and `DelInstrText`).
- **Family B** (`Begin, Ins(End)`): the wrapper subtree `[End]` is not context-neutral — under `ctx = []`, `stepBlock` produces `WalkResult.invalid` because `End` would underflow the local-pushed context (we treat `End` outside any locally-pushed field as invalid in the `fieldContextNeutral` walk, even though `validateFieldStructure` itself ignores it). Symmetric for `Begin, Del(End)`.
- **Family C** (`[Begin, Separate, Del(Begin, End), InstrText, End]`): the wrapper subtree `[Begin, End]` IS context-neutral (it pushes and pops one fresh frame). But the global walk is over a depth-indexed stack, not a single boolean — so the inner `End` only pops the inner frame and the outer frame's `seenSeparator = true` bit is preserved. The trailing `InstrText` is then at outer depth 1 with `top = true`, which `stepAtom` rejects, so `validateFieldStructure d = false`. Whole-doc validation already catches this in the corrected stack model; no further per-subtree strengthening is required for this family.

**This stronger property is what the preservation lemma actually needs**, and is what the residual axiom `compareDocumentXml_output_recursivelyWellformed` asserts about comparison output. After this strengthening, no obvious round-3 counterexample remains; this is suggestive, not a proof, and the third reviewer round is the one that promoted the search to "we have looked hard."

**Empirical scope.** This repo's inplace atomizer output (`compareDocumentsAtomizer` at `pipeline.ts:635-650` followed by the inplace path at `pipeline.ts:669`) wraps complete fields in `w:ins` / `w:del` rather than fragmenting them — see the integration test comment at `packages/docx-core/src/integration/collapsed-field-inplace.test.ts:243` ("w:del must not pack all field atoms into a single run"). The current evidence is limited to the existing field-free fast-check bridge cases (`packages/docx-core/src/integration/lean-spec-bridge.test.ts:42-44` explicitly excludes field-bearing inputs) plus one dedicated field-bearing fixture added in 6.1 as a falsifiability layer. The axiom remains engine-specific to this repo's atomizer, universal in `(a, b)`, and load-bearing — Tier 3 is what discharges it definitionally.

### Preservation lemma

```lean
theorem field_structure_preserved :
  ∀ d, recursivelyWellformed d →
    validateFieldStructure (accept d) = true ∧
    validateFieldStructure (reject d) = true
```

The proof is structured around three generic lemmas about the stack-valued walk (T0 in `tasks.md`), which both halves consume:

**(L1) `walkBlocks_append`:** for any starting `WalkResult r`, `walkBlocks r (l ++ m) = walkBlocks (walkBlocks r l) m`. This is the fold-over-append rewrite specialized to `stepBlock`.

**(L2) Context-extension for context-neutral subtrees:** if `fieldContextNeutral bs`, then for any starting `ctx`, `walkBlocks (.ok ctx) bs = .ok ctx`, AND for any prior valid prefix that ended at `.ok ctx`, replacing `bs` with its concatenated children at the same position leaves every later state-observation identical. This is the load-bearing lemma — it formalizes "splicing or dropping a context-neutral segment preserves any outer field context."

**(L3) `DelInstrText → InstrText` rewrite is safe inside a context-neutral wrapper:** if `bs` is context-neutral and contains a `DelInstrText`, then at that atom's position the local context (the portion pushed since entering `bs`) is non-empty and its top bit is `false` — so rewriting the atom to `InstrText` and re-walking yields the same `(continue / invalid)` verdict at that position.

Proof sketch for `accept`:
- `accept` drops `Del` / `MoveFrom` wrapper children. `recursivelyWellformed d` ensures each such subtree's child block list is `fieldContextNeutral`. By (L2), removing the entire wrapper (which is just `walkBlocks` over its children, since wrappers are transparent in `stepBlock`) leaves the outer walk's state at the wrapper's position unchanged; (L1) lifts this to "every state observation after the wrapper is identical." So no later `InstrText` flips from valid to invalid, and the global `begins`/`ends` count loses a balanced contribution.
- `accept` unwraps `Ins` / `MoveTo` wrappers but keeps their children. Because the wrapper is `fieldContextNeutral`, splicing its children into the outer block list at the wrapper's position is a no-op for state observations outside the children's span (by L2 + L1). Inside the spliced span, every observation matches what it would have been inside the wrapper (because `stepBlock` of a wrapper is `walkBlocks` over its children — there's no extra work the wrapper itself performs).
- Paragraph drop after collapse removes empty paragraphs, which contribute no `FldChar` / `InstrText` / `DelInstrText` atoms; trivial case.

Proof sketch for `reject`:
- Symmetric: drop `Ins` / `MoveTo`; unwrap `Del` / `MoveFrom`. Same (L1)+(L2) reasoning applies. Note that `reject` rewrites `DelInstrText → InstrText` *after* unwrapping both `Del` AND `MoveFrom` (TS `trackChangesAcceptorAst.ts:602-616` performs the unwraps then the rename pass over the whole tree). So the rewrite target isn't restricted to `Del`-wrapped content by the operation itself; what restricts it is `recursivelyWellformed`'s precondition on the *input*. By (L3), within any context-neutral wrapper subtree (whether `Del` or `MoveFrom`) every `DelInstrText` sits at a position where the local stack is non-empty with top bit `false`. After unwrapping the wrapper into the outer document at the same position, the *combined* stack (outer + locally-pushed) at that atom's position has the same top bit (the locally-pushed portion is non-empty by L3, so it dominates), and the renamed `InstrText` passes `stepAtom`.
- `DelText → Text` is irrelevant to the field-structure predicate.

Each sketch becomes a series of helper lemmas in `Tier2/InvFieldOne.lean`. The shared generic lemmas live in `Tier2/WalkLemmas.lean` and are produced by T0 in `tasks.md` *before* the accept/reject halves.

**Status note on counterexample search:** after this strengthening (stack-valued context + `fieldContextNeutral` + L3), no obvious round-3 counterexample remains; this is suggestive, not a proof. The actual proof of `field_structure_preserved` is what closes the question.

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
/-- Residual obligation: this repo's inplace atomizer output (compareDocumentXml
    in inplace mode, `pipeline.ts:635-650` then the inplace path at `pipeline.ts:669`)
    is recursively well-formed under the stack-valued field context. This axiom is
    the single load-bearing assumption behind the `inv_field_001` closure. Tier 3
    will discharge it by modeling `compareDocumentXml` definitionally.

    Evidence as of this PR is limited to the existing field-free fast-check bridge
    cases (`packages/docx-core/src/integration/lean-spec-bridge.test.ts:42-44`
    explicitly excludes field-bearing inputs and only checks the consequence —
    `validateFieldStructure` post-accept/reject — not the recursive precondition
    itself) plus one dedicated field-bearing fixture added by this change as a
    falsifiability layer. The axiom remains engine-specific to this repo's
    atomizer, universal in `(a, b)`, and load-bearing. -/
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
