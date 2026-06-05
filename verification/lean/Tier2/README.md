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
  `WalkResult`, `stepAtom`, `walkBlocks`) threaded with a structural del-ancestry
  depth, `validateFieldStructure` (which enforces the DeletedFieldCode locality
  constraint — `w:fldChar` barred from `w:del`, `w:delInstrText` confined to it),
  `fieldContextNeutral`, and `recursivelyWellformed`.
- `AcceptReject.lean` — definitional `accept` and `reject`.
- `InvFieldOne.lean` — the document-level preservation lemma
  `field_structure_preserved_doc` (no `sorry`), proved walk-free from the
  `preservationFriendly` precondition plus the `accept_blocks` / `reject_blocks`
  append lemmas.
- `RoundTripText.lean` — the round-trip text model (`extractText`, `normalizeText`,
  `revisedText`, `originalText`) and the lemmas that close `inv_rt_001`
  (`text_rename_invariant`, `extractText_reject`, `extractText_accept_normalized`).

## What the closed proof says

`Tier2.InvFieldOne.field_structure_preserved_doc`: for any `Doc` `d` satisfying
the document-level `preservationFriendly d`, both `accept d` and `reject d` satisfy
`validateFieldStructure`.

`preservationFriendly d` asserts that the whole document passes
`validateFieldStructure` and that `accept` / `reject` leave the *composed*
document-level field walk and begin/end balance unchanged — strictly weaker than
the per-subtree `recursivelyWellformed` (`∀ ctx` neutrality of every wrapper
subtree). The field-context walk carries a depth-indexed stack of "separator-seen"
bits mirroring the TS engine's `pastSeparatorAtDepth: number[]`
(`packages/docx-core/src/baselines/atomizer/pipeline.ts:525-560`) and a structural
del-ancestry depth enforcing the DeletedFieldCode locality constraint
(`pipeline.ts:542`/`555`).

`inv_field_001` in `Spec.lean` is closed by composing `field_structure_preserved_doc`
with the single named residual axiom
`compareDocumentXml_output_preservation_friendly`. PR #220 weakened the precondition
from per-subtree `recursivelyWellformed` to document-level `preservationFriendly` so
the axiom stays compatible with ECMA-376 field fragmentation (#217). A stronger legacy
`field_structure_preserved` over `recursivelyWellformed` was retained for a time but
**retired** when the DeletedFieldCode constraint (`add-lean-deleted-field-code-constraint`)
falsified its per-step rename-safety lemmas and made `recursivelyWellformed` exclude
legal deleted-field-code documents; the document-level theorem is the sole headline.
See `Spec.lean` for detail.

## Residual obligations — what the proof does NOT say

- **`compareDocumentXml_output_preservation_friendly` is the single named
  residual axiom.** It asserts that this repo's inplace atomizer output satisfies
  `preservationFriendly` (whole-doc `validateFieldStructure`, and accept/reject
  leave the field walk and begin/end balance unchanged). It is scoped to this
  repo's inplace atomizer — NOT to
  OOXML comparison engines in general. It is **not discharged**; discharging it
  by modeling `compareDocumentXml` definitionally is **Tier 3** work, and the next
  step there is exactly that definitional model.
- **Extensional equivalence is not established.** The Lean `accept` / `reject` /
  `validateFieldStructure` are definitional mirrors of the TS
  `acceptAllChanges` / `rejectAllChanges` / `validateFieldStructure`
  (`trackChangesAcceptorAst.ts:368-659`, `pipeline.ts:496-565`), but no proof
  ties the Lean operations extensionally to the TS code. That is **Tier 2.5**.
  (The Lean↔TS helper differential now exercises this for `validateFieldStructure`
  including the closed G1/G2 DeletedFieldCode cases — see
  `add-lean-deleted-field-code-constraint`.)
- **The runtime check is not made redundant.** The production engine's runtime
  `validateFieldStructure` call (`pipeline.ts:439-440`) is not removed or
  weakened by this proof; the proof is a property of the Lean model.

## Model narrowing

The Lean `Block` covers only the four track-change wrapper types plus `Run`.
The TS paragraph-removal logic at `trackChangesAcceptorAst.ts:411,456,564` walks
all non-excluded descendants looking for `w:r` children, catching arbitrary
nested OOXML. The Lean model deliberately narrows this: non-wrapper descendants
are out of model. A broader `Block` shape is owned by Tier 2.5.

Locality of `delInstrText` to a `w:del` ancestor is now enforced by
`validateFieldStructure` itself: the field-context walk carries a structural
del-ancestry depth and rejects any `delInstrText` at del-depth 0 and any `fldChar`
at del-depth > 0 (the DeletedFieldCode locality constraint, `pipeline.ts:542`/`555`).
The `reject` `delInstrText → instrText` rename pass still runs globally after both
unwraps complete (matching `trackChangesAcceptorAst.ts:602-616`); the walk-level
constraint on the *input* document is what guarantees the rename only ever fires on
a `delInstrText` that was inside a `w:del`, which `reject` is simultaneously
unwrapping to del-depth 0.

## Round-trip text (`inv_rt_001`)

`RoundTripText.lean` closes the second specification target, `inv_rt_001`
(round-trip text equality), with the same "definitional model + machine-checked
lemma + single named residual axiom" shape used for `inv_field_001`.

What the closed lemmas say:

- `text_rename_invariant`: `reject`'s global `delText → text` /
  `delInstrText → instrText` rename pass does not change extracted text, because
  `extractText` already counts `delText` (`trackChangesAcceptorAst.ts:677-682`).
- `extractText_reject`: `extractText (reject d) = originalText d` exactly —
  `reject` does not drop paragraphs, so no normalization is needed.
- `extractText_accept_normalized`:
  `normalizeText (extractText (accept d)) = normalizeText (revisedText d)`. The
  two differ only by the empty entries `accept` drops when a paragraph body
  collapses to empty (`AcceptReject.lean:44`); `normalizeText` removes them. This
  empty-paragraph absorption is the reason `inv_rt_001` is stated
  post-`normalizeText`.

`inv_rt_001` in `Spec.lean` composes these with the single named residual axiom
`compareDocumentXml_output_text_roundtrip`, which asserts that the normalized
revised-/original-side text projections of the inplace comparison output equal the
normalized text of the revised/original inputs.

### Residual obligations — what the round-trip proof does NOT say

- **`compareDocumentXml_output_text_roundtrip` is the single named residual
  axiom.** It is scoped to this repo's inplace atomizer output, not OOXML engines
  in general. It is **not discharged**; modeling `compareDocumentXml`
  definitionally is **Tier 3** work.
- **`normalizeText` is modeled structurally, not as the literal regex.** Per-paragraph
  text is `List Char`; `normalizeText` trims each entry and drops blank entries
  (the structured analogue of `\n+ → \n` plus outer `trim`). The TS regex's
  intra-line multi-space/tab collapse is **not** modeled — a Tier-2.5-class
  residual, absorbed by the post-`normalizeText` axiom. The bridge fixture runs
  the live TS `normalizeText`, though its NUMPAGES text has no whitespace runs so
  it does not specifically target this collapse gap.
- **`extractText` ordering differs from TS.** `extractText` concatenates text in
  structural document order; the TS `extractTextWithParagraphs` emits all `w:t`
  then all `w:delText`. They disagree only for paragraphs interleaving `text` and
  `delText` — vacuous on the round-trip's compared surfaces (`accept` / `reject`
  outputs and clean inputs are `w:t`-only per run). A **Tier 2.5** gap.
- **Extensional equivalence is not established.** The Lean `extractText` /
  `normalizeText` are definitional mirrors of the TS
  `extractTextWithParagraphs` / `normalizeText`; no proof ties them extensionally.
  That is **Tier 2.5**.

## CI

`lake build` over this directory runs in `.github/workflows/lean-build.yml`,
which also audits that every Lean module is zero-`sorry`. As of the `inv_rt_001`
closure the entire spike (including `../LeanSpike/Spec.lean`) is zero-`sorry`.

TS-side falsifiability layers live in
`packages/docx-core/src/integration/lean-spec-bridge.test.ts`: one field-bearing
fixture case for the `inv_field_001` residual axiom, and one round-trip fixture
case for `compareDocumentXml_output_text_roundtrip` (normalized revised-side and
original-side text of a live comparison output vs. the revised/original inputs).
