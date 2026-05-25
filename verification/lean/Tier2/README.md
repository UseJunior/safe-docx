# Tier 2 — definitional `OoxmlDoc` subset and the `inv_field_001` closure

This directory holds the Tier 2 verification work: a definitional Lean model of
a small OOXML subset, definitional `accept` / `reject` / `validateFieldStructure`
operations over it, and a **closed, machine-checked proof** of the field-structure
preservation lemma that discharges the `inv_field_001` `sorry` in
`../LeanSpike/Spec.lean`.

## Files

- `OoxmlModel.lean` — definitional datatypes (`Doc`, `Paragraph`, `Block`, `Run`,
  `Atom`, `FldCharKind`) for a tree-structured OOXML subset.
- `FieldStructure.lean` — the stack-valued field-context walk (`FieldCtx`,
  `WalkResult`, `stepAtom`, `walkBlocks`), `validateFieldStructure`,
  `fieldContextNeutral`, and `recursivelyWellformed`.
- `WalkLemmas.lean` — generic, operation-agnostic walk lemmas: `walkBlocks_append`
  (L1), `walkBlocks_neutral_ok` (L2 core), `neutral_balanced`,
  `delInstrText_rewrite_safe` (L3).
- `AcceptReject.lean` — definitional `accept` and `reject`.
- `InvFieldOne.lean` — the preservation lemma `field_structure_preserved`
  (no `sorry`).

## What the closed proof says

`Tier2.InvFieldOne.field_structure_preserved`: for any `Doc` `d` satisfying
`recursivelyWellformed d`, both `accept d` and `reject d` satisfy
`validateFieldStructure`.

`recursivelyWellformed d` requires (a) the whole document passes
`validateFieldStructure`, AND (b) every `w:ins` / `w:del` / `w:moveFrom` /
`w:moveTo` wrapper subtree (transitively) is `fieldContextNeutral` — i.e. scanned
under **any** outer field context, it returns to that context and never produces
an invalid state. The field-context walk carries a depth-indexed stack of
"separator-seen" bits exactly mirroring the TS engine's `pastSeparatorAtDepth:
number[]` at `packages/docx-core/src/baselines/atomizer/pipeline.ts:374-389`.

`inv_field_001` in `Spec.lean` is then closed by composing this lemma with the
single named residual axiom `compareDocumentXml_output_recursivelyWellformed`.

## Residual obligations — what the proof does NOT say

- **`compareDocumentXml_output_recursivelyWellformed` is the single named
  residual axiom.** It asserts that this repo's inplace atomizer output satisfies
  `recursivelyWellformed`. It is scoped to this repo's inplace atomizer — NOT to
  OOXML comparison engines in general. It is **not discharged**; discharging it
  by modeling `compareDocumentXml` definitionally is **Tier 3** work, and the next
  step there is exactly that definitional model.
- **Extensional equivalence is not established.** The Lean `accept` / `reject` /
  `validateFieldStructure` are definitional mirrors of the TS
  `acceptAllChanges` / `rejectAllChanges` / `validateFieldStructure`
  (`trackChangesAcceptorAst.ts:368-659`, `pipeline.ts:352-402`), but no proof
  ties the Lean operations extensionally to the TS code. That is **Tier 2.5**.
- **The runtime check is not made redundant.** The production engine's runtime
  `validateFieldStructure` call (`pipeline.ts:439-440`) is not removed or
  weakened by this proof; the proof is a property of the Lean model.

## Model narrowing

The Lean `Block` covers only the four track-change wrapper types plus `Run`.
The TS paragraph-removal logic at `trackChangesAcceptorAst.ts:411,456,564` walks
all non-excluded descendants looking for `w:r` children, catching arbitrary
nested OOXML. The Lean model deliberately narrows this: non-wrapper descendants
are out of model. A broader `Block` shape is owned by Tier 2.5.

Locality of `delInstrText` to deleted-content wrappers (`w:del` / `w:moveFrom`)
is **not** enforced by the bare `OoxmlModel` datatype — `reject`'s
`delInstrText → instrText` rename pass runs globally after both unwraps complete
(matching `trackChangesAcceptorAst.ts:602-616`). The precondition that
`delInstrText` only originates inside deleted-content wrappers is enforced by
`recursivelyWellformed` on the *input* (`fieldContextNeutral` rejects a
`delInstrText` outside an open pre-separator field).

## CI

`lake build` over this directory runs in `.github/workflows/lean-build.yml`,
which also audits that every `Tier2/` module is zero-`sorry`. The single
remaining `sorry` in the spike is `inv_rt_001` in `../LeanSpike/Spec.lean`.

A TS-side falsifiability layer for `compareDocumentXml_output_recursivelyWellformed`
lives in `packages/docx-core/src/integration/lean-spec-bridge.test.ts` — one
field-bearing fixture case exercising a TS analogue of `recursivelyWellformed`
against the live engine.
