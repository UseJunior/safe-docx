import Mathlib.Data.List.Basic

namespace LeanSpike

/-- Abstract Lean document type for the `document.xml` surface threaded through the
    atomizer comparison and safety-check pipeline in
    `packages/docx-core/src/baselines/atomizer/pipeline.ts:352-817`. -/
axiom OoxmlDoc : Type

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

    The rebuild-mode output (`modifyRevisedDocument` branch at `pipeline.ts:638`
    vs `reconstructDocument` branch at `pipeline.ts:647`) bypasses
    `evaluateSafetyChecks`, so the Stage 4 specifications below only target the
    inplace surface — not arbitrary comparison output, and not the rebuild
    fallback. -/
axiom compareDocumentXml : OoxmlDoc → OoxmlDoc → Option OoxmlDoc

/-- Abstract Lean symbol mirroring `acceptAllChanges` in
    `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:368-506`. -/
axiom acceptAllChanges : OoxmlDoc → OoxmlDoc

/-- Abstract Lean symbol mirroring `rejectAllChanges` in
    `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:519-626`. -/
axiom rejectAllChanges : OoxmlDoc → OoxmlDoc

/-- Abstract Lean symbol mirroring `validateFieldStructure` in
    `packages/docx-core/src/baselines/atomizer/pipeline.ts:352-402`. -/
axiom validateFieldStructure : OoxmlDoc → Bool

/-- Abstract Lean symbol mirroring `extractTextWithParagraphs` in
    `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:660-688`. -/
axiom extractTextWithParagraphs : OoxmlDoc → String

/-- Abstract Lean symbol mirroring `normalizeText` in
    `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:701-711`. -/
axiom normalizeText : String → String

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
    The check is gated on `reconstructionMode === 'inplace'` at `pipeline.ts:669`;
    rebuild-mode candidates bypass it entirely. The TypeScript does not claim that
    accept/reject repairs malformed arbitrary input, so the Lean statement is
    intentionally scoped to a *successful* inplace comparison candidate. -/
theorem inv_field_001 :
  ∀ (a b combined : OoxmlDoc),
    compareDocumentXml a b = some combined →
    validateFieldStructure (acceptAllChanges combined) = true ∧
    validateFieldStructure (rejectAllChanges combined) = true := by
  sorry

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
    The statement is intentionally paired, not one-sided, because the test suite
    checks both directions modulo `normalizeText`. -/
theorem inv_rt_001 :
  ∀ (a b combined : OoxmlDoc),
    compareDocumentXml a b = some combined →
    normalizeText (extractTextWithParagraphs (acceptAllChanges combined)) =
      normalizeText (extractTextWithParagraphs b) ∧
    normalizeText (extractTextWithParagraphs (rejectAllChanges combined)) =
      normalizeText (extractTextWithParagraphs a) := by
  sorry

end LeanSpike
