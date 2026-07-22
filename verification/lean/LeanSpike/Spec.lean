import Mathlib.Data.List.Basic
import Tier2.OoxmlModel
import Tier2.FieldStructure
import Tier2.AcceptReject
import Tier2.InvFieldOne
import Tier2.RoundTripText

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
    `ContainerResolutionError` from `inPlaceModifier-containers.ts`
    (grep `@lean-segment: container-topology`; container topology
    mismatch; see `pipeline.ts:723`) or by having every inplace pass fail
    `evaluateRoundTripSafety` at `pipeline.ts:736-749`, in which case the pipeline
    falls back to rebuild mode and the inplace candidate that the Stage 4 specs
    would have constrained is never emitted.

    This **remains axiomatic**: modeling `compareDocumentXml` definitionally is
    Tier 3 work. The residual obligations about its output are captured by the two
    named axioms below: `compareDocumentXml_output_preservation_friendly`
    (field structure) and `compareDocumentXml_output_text_roundtrip` (round-trip
    text). -/
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

/-- `extractTextWithParagraphs`, mirroring
    `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:660-688`.
    As of the `inv_rt_001` closure this is the definitional
    `Tier2.RoundTripText.extractText` (per-paragraph text modeled as `List Char`;
    see that module's header for the `String`-vs-`List Char` modeling note). -/
def extractTextWithParagraphs : OoxmlDoc → List (List Char) :=
  Tier2.RoundTripText.extractText

/-- `normalizeText`, mirroring
    `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:701-711`.
    As of the `inv_rt_001` closure this is the definitional
    `Tier2.RoundTripText.normalizeText`. It models the load-bearing behaviour
    (trim each paragraph entry, drop blank entries — the structured analogue of
    `\n+ → \n` plus outer `trim`); the intra-line multi-space/tab collapse the TS
    regex also performs is a documented Tier-2.5-class residual. -/
def normalizeText : List (List Char) → List (List Char) :=
  Tier2.RoundTripText.normalizeText

/-- **Residual obligation.** This repo's inplace atomizer output
    (`compareDocumentXml` in inplace mode, `pipeline.ts:635-650` then the
    inplace path at `pipeline.ts:669`) is *preservation-friendly* under the
    stack-valued field context — i.e. it satisfies
    `Tier2.AcceptReject.preservationFriendly`: the whole document passes
    `validateFieldStructure`, AND the document-level walk and begin/end balance
    are unchanged by `accept` and `reject`.

    This axiom is the single load-bearing assumption behind the `inv_field_001`
    closure. Tier 3 will discharge it by modeling `compareDocumentXml`
    definitionally.

    **Predicate strength choice — document-level, NOT per-subtree.** A previous
    iteration of this axiom asserted the *strictly stronger*
    `Tier2.FieldStructure.recursivelyWellformed` (per-subtree
    `fieldContextNeutral ∀ ctx`). That stronger property happens to hold for the
    current safe-docx engine, which emits whole field sequences as single
    track-change wrappers (grep `@lean-segment: field-wrapper-emission` in
    `inPlaceModifier-wrappers.ts`; `collapsed-field-inplace.test.ts:211`). But ECMA-376 Part 4 requires
    a conformant emitter to *fragment* fields across wrapper boundaries when a
    field is modified — `w:fldChar` is strictly barred from `<w:del>`, so a
    modified field has its `w:fldChar begin/separate/end` markers unwrapped at
    the run-sibling level while `<w:ins>`/`<w:del>` wrap only the changed
    `w:instrText` / `w:delInstrText` payloads. Such fragmented wrapper subtrees
    are NOT `fieldContextNeutral` under `∀ ctx`. Engine fragmentation
    conformance is tracked in #217.

    To make this axiom future-compatible with that work, we weaken the
    precondition here to `preservationFriendly` (asserts only the *composed*
    walk and balance equalities, not pointwise neutrality of each wrapper). The
    `fieldContextNeutral` / `recursivelyWellformed` predicates still exist in
    `Tier2.FieldStructure` as the documented stronger contrast. The previously
    retained legacy `field_structure_preserved` (which consumed the per-subtree
    `recursivelyWellformed`) has since been **retired**: modeling the
    DeletedFieldCode locality constraint (`w:fldChar` barred from `<w:del>`,
    `w:delInstrText` confined to it) made `recursivelyWellformed` exclude legal
    deleted-field-code documents and falsified the per-step rename-safety lemmas
    the legacy proof relied on, so it is no longer provable as stated. It was
    never on the path to `inv_field_001`, which rides
    `field_structure_preserved_doc` below.

    Evidence: the field-bearing bridge fixtures
    (`packages/docx-core/src/integration/lean-spec-bridge.test.ts` — NUMPAGES
    insertion, NUMPAGES deletion) check the *consequence* of
    `preservationFriendly` (`validateFieldStructure` post-accept/reject), which
    is what the engine actually emits today. The axiom is engine-specific to
    this repo's inplace atomizer, universal in `(a, b)`, and load-bearing —
    NOT empirically grounded across the full ECMA-376 surface. -/
axiom compareDocumentXml_output_preservation_friendly :
  ∀ a b combined, compareDocumentXml a b = some combined →
    Tier2.AcceptReject.preservationFriendly combined

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
    `compareDocumentXml_output_preservation_friendly` with the document-level
    preservation lemma `Tier2.InvFieldOne.field_structure_preserved_doc`. -/
theorem inv_field_001 :
  ∀ (a b combined : OoxmlDoc),
    compareDocumentXml a b = some combined →
    validateFieldStructure (acceptAllChanges combined) = true ∧
    validateFieldStructure (rejectAllChanges combined) = true := by
  intro a b combined h
  have hPF := compareDocumentXml_output_preservation_friendly a b combined h
  exact Tier2.InvFieldOne.field_structure_preserved_doc combined hPF

/-- **Residual obligation (text round-trip).** For this repo's inplace atomizer
    output `combined`, the normalized *revised-side* projection of `combined`
    (`Tier2.RoundTripText.revisedText` — the per-paragraph text of `acceptBlocks`)
    equals the normalized revised-side projection of the revised input `b`, and
    the normalized *original-side* projection (`Tier2.RoundTripText.originalText`
    — the per-paragraph text of `rejectBlocks`) equals the normalized
    original-side projection of the original input `a`.

    **Projection-to-projection, NOT projection-to-raw (#347).** A previous
    statement compared `combined`'s projections against the *raw* extracted text
    of the inputs (`extractTextWithParagraphs a` / `b`). That raw surface counts
    both `w:t` and `w:delText`, so on an input that already carries its own
    tracked changes (pre-tracked `w:ins` / `w:del`, comment anchors, multi-author
    stacks) it is neither the accept- nor the reject-projection — the law was
    falsified by construction on legitimate pre-tracked inputs, and the TS safety
    check encoding it (`pipeline.ts`, `evaluateSafetyChecks` baselines) forced
    spurious inplace→rebuild fallbacks (#339). The corrected law projects each
    input through the SAME side it is compared under. For a clean input the
    projections equal the raw extraction, so the common case is unchanged.

    Accept-all / reject-all are GLOBAL across all authors (what
    `Tier2.AcceptReject.accept` / `.reject` and the TS helpers do), so the law is
    self-consistent however many authors stack on a paragraph. It is deliberately
    a *text* round-trip law: it does not constrain the raw mixed-revision markup
    surface or author provenance of `combined`.

    This is the second named, load-bearing residual axiom of the spike (alongside
    `compareDocumentXml_output_preservation_friendly`). Like that one it is
    engine-specific to this repo's inplace atomizer, universal in `(a, b)`, and
    NOT empirically grounded across the full ECMA-376 surface; Tier 3 discharges it
    by modeling `compareDocumentXml` definitionally.

    Crucially it is stated over text *projections* (`revisedText` /
    `originalText`), with NO reference to the document-level `accept` / `reject`.
    The machine-checked lemmas
    `Tier2.RoundTripText.extractText_accept_normalized` and
    `Tier2.RoundTripText.extractText_reject` carry the connection from those
    projections to `acceptAllChanges` / `rejectAllChanges` — applied to `combined`
    AND to the inputs — so this axiom is not a restatement of `inv_rt_001`.

    Evidence: the round-trip bridge property in
    `packages/docx-core/src/integration/lean-spec-bridge.test.ts` checks the
    TS analogue (normalized accept/reject projections of a live comparison
    output vs. the accept/reject projections of the revised/original inputs),
    which is what the engine emits today. -/
axiom compareDocumentXml_output_text_roundtrip :
  ∀ a b combined, compareDocumentXml a b = some combined →
    normalizeText (Tier2.RoundTripText.revisedText combined)
        = normalizeText (Tier2.RoundTripText.revisedText b) ∧
    normalizeText (Tier2.RoundTripText.originalText combined)
        = normalizeText (Tier2.RoundTripText.originalText a)

/-- INV-RT-001: paired round-trip text equality under normalization, with
    accept-all of `combined` recovering accept-all of `b` and reject-all of
    `combined` recovering reject-all of `a`. Scoped to the successful
    inplace-mode comparison output `compareDocumentXml a b = some combined`.
    Doc pairs where inplace fails (`none`) are out of scope.

    **Apples-to-apples projection equality (#347).** Each input is projected
    through the SAME accept/reject operation `combined` is checked under. For a
    clean input (no pre-existing tracked changes) the projection equals the raw
    extracted text, so on the common case this coincides with the previous
    raw-baseline statement; on a pre-tracked input the raw surface (which counts
    both `w:t` and `w:delText`) is neither projection, and the previous statement
    was falsified by construction. Accept/reject are global across all authors,
    and the law constrains only the *text* projections — not the raw
    mixed-revision markup or author provenance of `combined`.

    This mirrors the gold-standard round-trip tests in
    `packages/docx-core/src/integration/round-trip-inplace.test.ts:56-63`
    (accept-all → revised) and
    `packages/docx-core/src/integration/round-trip-inplace.test.ts:87-94`
    (reject-all → original), plus the second paired fixture at
    `packages/docx-core/src/integration/nvca-coi-regression.test.ts:77-103`,
    together with the text helpers at
    `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:660-711`,
    and the corrected TS safety-check baselines in
    `packages/docx-core/src/baselines/atomizer/pipeline.ts` (the
    `originalTextForRoundTrip` / `revisedTextForRoundTrip` projections feeding
    `evaluateRoundTripSafety`).

    **Closed** by composing the named residual axiom
    `compareDocumentXml_output_text_roundtrip` with the machine-checked round-trip
    lemmas — applied on BOTH `combined` and the inputs —
    `Tier2.RoundTripText.extractText_accept_normalized` (accept side:
    `normalizeText ∘ extractText ∘ accept = normalizeText ∘ revisedText`; `accept`
    keeps every paragraph and the blank text entry of an empty-collapsing paragraph
    is absorbed by `normalizeText` on both aligned sides) and
    `Tier2.RoundTripText.extractText_reject` (reject side:
    `extractText ∘ reject = originalText`, the `delText → text` rename being
    text-invariant). -/
theorem inv_rt_001 :
  ∀ (a b combined : OoxmlDoc),
    compareDocumentXml a b = some combined →
    normalizeText (extractTextWithParagraphs (acceptAllChanges combined)) =
      normalizeText (extractTextWithParagraphs (acceptAllChanges b)) ∧
    normalizeText (extractTextWithParagraphs (rejectAllChanges combined)) =
      normalizeText (extractTextWithParagraphs (rejectAllChanges a)) := by
  intro a b combined hcomp
  obtain ⟨hrev, horig⟩ := compareDocumentXml_output_text_roundtrip a b combined hcomp
  simp only [normalizeText, extractTextWithParagraphs, acceptAllChanges,
    rejectAllChanges] at hrev horig ⊢
  refine ⟨?_, ?_⟩
  · rw [Tier2.RoundTripText.extractText_accept_normalized,
      Tier2.RoundTripText.extractText_accept_normalized]
    exact hrev
  · rw [Tier2.RoundTripText.extractText_reject,
      Tier2.RoundTripText.extractText_reject]
    exact horig

end LeanSpike
