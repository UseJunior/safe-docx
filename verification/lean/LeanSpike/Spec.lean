import Mathlib.Data.List.Basic
import Tier2.OoxmlModel
import Tier2.FieldStructure
import Tier2.AcceptReject
import Tier2.InvFieldOne

namespace LeanSpike

/-- The Lean document type for the `document.xml` surface threaded through the
    atomizer comparison and safety-check pipeline in
    `packages/docx-core/src/baselines/atomizer/pipeline.ts:352-817`.

    As of Tier 2 this is no longer an opaque `axiom`: it is the definitional
    tree-structured OOXML subset `Tier2.OoxmlModel.Doc`. -/
abbrev OoxmlDoc : Type := Tier2.OoxmlModel.Doc

/-- Abstract Lean symbol for the **inplace-mode** comparison-output XML produced by
    `compareDocumentsAtomizer` as `newDocumentXml` in
    `packages/docx-core/src/baselines/atomizer/pipeline.ts:635-650`, restricted
    to the inplace reconstruction path at `pipeline.ts:669` (`reconstructionMode === 'inplace'`).

    Modeled as **partial** via `Option OoxmlDoc` because the real TS pipeline can
    fail to produce an inplace candidate at all — either by raising
    `ContainerResolutionError` from `inPlaceModifier.ts:59` (container topology
    mismatch; see `pipeline.ts:723`) or by having every inplace pass fail
    `evaluateRoundTripSafety` at `pipeline.ts:736-749`, in which case the pipeline
    falls back to rebuild mode and the inplace candidate that the Stage 4 specs
    would have constrained is never emitted.

    This **remains axiomatic**: modeling `compareDocumentXml` definitionally is
    Tier 3 work. The residual obligation about its output well-formedness is
    captured by the named axiom `compareDocumentXml_output_recursivelyWellformed`
    below. -/
axiom compareDocumentXml : OoxmlDoc → OoxmlDoc → Option OoxmlDoc

/-- `acceptAllChanges`, mirroring
    `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:368-506`.
    As of Tier 2 this is the definitional `Tier2.AcceptReject.accept`. -/
def acceptAllChanges : OoxmlDoc → OoxmlDoc := Tier2.AcceptReject.accept

/-- `rejectAllChanges`, mirroring
    `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:509-659`.
    As of Tier 2 this is the definitional `Tier2.AcceptReject.reject`. -/
def rejectAllChanges : OoxmlDoc → OoxmlDoc := Tier2.AcceptReject.reject

/-- `validateFieldStructure`, mirroring
    `packages/docx-core/src/baselines/atomizer/pipeline.ts:352-402`.
    As of Tier 2 this is the definitional `Tier2.FieldStructure.validateFieldStructure`. -/
def validateFieldStructure : OoxmlDoc → Bool := Tier2.FieldStructure.validateFieldStructure

/-- Abstract Lean symbol mirroring `extractTextWithParagraphs` in
    `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:660-688`.
    Remains axiomatic — owned by the `inv_rt_001` successor change. -/
axiom extractTextWithParagraphs : OoxmlDoc → String

/-- Abstract Lean symbol mirroring `normalizeText` in
    `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:701-711`.
    Remains axiomatic — owned by the `inv_rt_001` successor change. -/
axiom normalizeText : String → String

/-- **Residual obligation.** This repo's inplace atomizer output (`compareDocumentXml`
    in inplace mode, `pipeline.ts:635-650` then the inplace path at `pipeline.ts:669`)
    is recursively well-formed under the stack-valued field context — i.e. it
    satisfies `Tier2.FieldStructure.recursivelyWellformed`: the whole document
    passes `validateFieldStructure`, and every `w:ins` / `w:del` / `w:moveFrom` /
    `w:moveTo` wrapper subtree (transitively) is `fieldContextNeutral`.

    This axiom is the single load-bearing assumption behind the `inv_field_001`
    closure. Tier 3 will discharge it by modeling `compareDocumentXml`
    definitionally.

    Evidence as of this change is limited to the existing field-free fast-check
    bridge cases (`packages/docx-core/src/integration/lean-spec-bridge.test.ts`
    explicitly excludes field-bearing inputs and only checks the *consequence* —
    `validateFieldStructure` post-accept/reject — not the recursive precondition
    itself) plus one dedicated field-bearing fixture added by this change as a
    falsifiability layer. The axiom is engine-specific to this repo's inplace
    atomizer, universal in `(a, b)`, and load-bearing — NOT empirically grounded. -/
axiom compareDocumentXml_output_recursivelyWellformed :
  ∀ a b combined, compareDocumentXml a b = some combined →
    Tier2.FieldStructure.recursivelyWellformed combined

/-- INV-FIELD-001: field-structure preservation across accept-all and reject-all,
    scoped to the successful inplace-mode comparison output
    `compareDocumentXml a b = some combined`. Doc pairs for which inplace mode
    fails (returns `none`) are outside this spec's scope — the pipeline falls
    back to rebuild mode in that case and `evaluateSafetyChecks` is not run on
    the rebuild candidate at all.

    This mirrors the safety check path in
    `packages/docx-core/src/baselines/atomizer/pipeline.ts:404-440`
    (`evaluateSafetyChecks`), whose actual field-structure call site at
    `pipeline.ts:439-440` is
    `validateFieldStructure(acceptedXml) && validateFieldStructure(rejectedXml)`.

    As of Tier 2 this theorem is **closed** with a complete machine-checked
    proof: it composes the named residual axiom
    `compareDocumentXml_output_recursivelyWellformed` with the preservation
    lemma `Tier2.InvFieldOne.field_structure_preserved`. -/
theorem inv_field_001 :
  ∀ (a b combined : OoxmlDoc),
    compareDocumentXml a b = some combined →
    validateFieldStructure (acceptAllChanges combined) = true ∧
    validateFieldStructure (rejectAllChanges combined) = true := by
  intro a b combined h
  have hRW := compareDocumentXml_output_recursivelyWellformed a b combined h
  exact Tier2.InvFieldOne.field_structure_preserved combined hRW

/-- INV-RT-001: paired round-trip text equality under normalization, with
    accept-all recovering `b` and reject-all recovering `a`. Scoped to the
    successful inplace-mode comparison output `compareDocumentXml a b = some combined`.
    Doc pairs where inplace fails (`none`) are out of scope.

    This mirrors the gold-standard round-trip tests in
    `packages/docx-core/src/integration/round-trip-inplace.test.ts:56-63`
    (accept-all → revised) and
    `packages/docx-core/src/integration/round-trip-inplace.test.ts:87-94`
    (reject-all → original), plus the second paired fixture at
    `packages/docx-core/src/integration/nvca-coi-regression.test.ts:77-103`,
    together with the text helpers at
    `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:660-711`.

    This theorem **remains unproved** — it is explicitly deferred to the
    `add-inv-rt-001-proof` successor change, which owns `extractTextWithParagraphs`
    and `normalizeText`. -/
theorem inv_rt_001 :
  ∀ (a b combined : OoxmlDoc),
    compareDocumentXml a b = some combined →
    normalizeText (extractTextWithParagraphs (acceptAllChanges combined)) =
      normalizeText (extractTextWithParagraphs b) ∧
    normalizeText (extractTextWithParagraphs (rejectAllChanges combined)) =
      normalizeText (extractTextWithParagraphs a) := by
  sorry

end LeanSpike
