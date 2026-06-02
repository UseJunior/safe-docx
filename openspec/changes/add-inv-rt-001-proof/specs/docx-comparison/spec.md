## ADDED Requirements

### Requirement: Round-trip text preservation across track-change resolution is formally proved, with a single named residual obligation

The system SHALL carry a machine-checked Lean proof closing `inv_rt_001` in `verification/lean/LeanSpike/Spec.lean` (the sole remaining `sorry` in the verification spike). `inv_rt_001` states that for any Lean `OoxmlDoc` values `a`, `b`, `combined` with `compareDocumentXml a b = some combined`, the normalized text of `acceptAllChanges combined` equals the normalized text of `b`, and the normalized text of `rejectAllChanges combined` equals the normalized text of `a`.

The proof SHALL be structured as definitional model + machine-checked lemmas + a single named residual axiom, mirroring the Tier 2 `inv_field_001` closure:

- `extractTextWithParagraphs` and `normalizeText` in `Spec.lean` SHALL be rewired from `axiom` to definitional `def`s aliasing new functions in `verification/lean/Tier2/RoundTripText.lean`, which mirror `extractTextWithParagraphs` (`packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:660-688`) and `normalizeText` (`trackChangesAcceptorAst.ts:701-711`). `extractTextWithParagraphs` collects `w:t` and `w:delText` text in document order per paragraph; `instrText` / `delInstrText` / `fldChar` atoms contribute no text.
- `RoundTripText.lean` SHALL prove, with no `sorry`: (a) `extractText (accept d)` equals the revised-side text projection of `d`; (b) `extractText (reject d)` equals the original-side text projection of `d`, consuming the text-invariance of the `delText → text` / `delInstrText → instrText` rename pass; and (c) that `accept`'s dropping of empty-collapsing paragraphs (`verification/lean/Tier2/AcceptReject.lean:44`) is absorbed by `normalizeText`.
- A single new named axiom `compareDocumentXml_output_text_roundtrip` SHALL be declared in `Spec.lean`, asserting that for any `(a, b)` with `compareDocumentXml a b = some combined`, the normalized revised-side projection of `combined` equals the normalized text of `b` and the normalized original-side projection of `combined` equals the normalized text of `a`. The axiom SHALL be stated over text projections of `combined` alone (no `accept` / `reject`), so the machine-checked lemmas carry the connection to the `accept` / `reject` outputs and the axiom is not a restatement of the theorem.
- The `inv_rt_001` proof SHALL compose the named axiom with the `RoundTripText` lemmas as its only non-`Tier2`-internal premises.

`normalizeText` is modeled structurally over a paragraph list (`List String`) rather than as a faithful `String` regex engine; the extensional gap to the literal TS regex rewrite SHALL be documented as a Tier-2.5-class residual, not left as a hidden assumption. Extensional equivalence between the Lean `extractText` / `normalizeText` / `accept` / `reject` and their production TS counterparts is NOT established by this requirement and remains a documented residual owned by Tier 2.5. Discharging `compareDocumentXml_output_text_roundtrip` by modeling `compareDocumentXml` definitionally is out of scope and owned by a successor Tier 3 change.

#### Scenario: [LEAN-RT-01] Accept-side round-trip lemma is closed

- **GIVEN** a Lean `Doc` value `d`
- **WHEN** `extractText (accept d)` is evaluated and normalized
- **THEN** it equals the normalized revised-side text projection of `d`, established by a closed Lean proof in `verification/lean/Tier2/RoundTripText.lean` whose normalization step discharges `accept`'s empty-paragraph dropping

#### Scenario: [LEAN-RT-02] Reject-side round-trip lemma is closed

- **GIVEN** a Lean `Doc` value `d`
- **WHEN** `extractText (reject d)` is evaluated (after `reject`'s global `delText → text` / `delInstrText → instrText` rename pass, mirroring `trackChangesAcceptorAst.ts:602-616`)
- **THEN** it equals the original-side text projection of `d`, established by a closed Lean proof that consumes the text-invariance of the rename pass

#### Scenario: [LEAN-RT-03] `inv_rt_001` sorry is replaced by a proof composing the named residual axiom and the lemmas

- **WHEN** `lake build` is run in `verification/lean/`
- **THEN** the build succeeds with no `sorry` warning anywhere in the spike
- **AND** the `sorry` audit in `.github/workflows/lean-build.yml` reports zero `sorry`, and its prior allowance for the `inv_rt_001` `sorry` in `Spec.lean` is removed
- **AND** the `inv_rt_001` proof uses `compareDocumentXml_output_text_roundtrip` and the `Tier2.RoundTripText` lemmas as its only non-`Tier2`-internal premises

#### Scenario: [LEAN-RT-04] Residual obligations and the normalizeText modeling gap are documented

- **WHEN** a reader inspects `verification/lean/Tier2/README.md` or the Specification Gap section of `verification/lean/README.md`
- **THEN** the document explicitly states (a) that the closed `inv_rt_001` proof carries `compareDocumentXml_output_text_roundtrip` as a named residual axiom scoped to this repo's inplace atomizer output (not OOXML comparison engines in general), owned by Tier 3; (b) that the spike now carries exactly two named residual axioms (`compareDocumentXml_output_preservation_friendly` and `compareDocumentXml_output_text_roundtrip`) and zero `sorry`; (c) that `normalizeText` is modeled as a paragraph-list (`List Char` per entry) transform capturing trim + blank-entry drop, with the TS regex's intra-line multi-space/tab collapse unmodeled and owned by Tier 2.5; (d) that extensional equivalence of `extractText` / `accept` / `reject` with their TS counterparts (including `extractText`'s structural- vs. `w:t`-then-`w:delText` ordering) is owned by Tier 2.5; (e) that the production engine's runtime round-trip safety checks are not made redundant by this proof

#### Scenario: [LEAN-RT-05] Bridge case provides a falsifiability layer for the new axiom

- **WHEN** `packages/docx-core/src/integration/lean-spec-bridge.test.ts` runs
- **THEN** at least one field-bearing fixture case asserts `inv_rt_001`'s conclusion against the live engine — the normalized accepted comparison output equals the normalized revised input, and the normalized rejected output equals the normalized original input, using the real TS `extractTextWithParagraphs` and `normalizeText` — and passes
- **AND** the test docstring states precisely that it checks the round-trip conclusion (which the machine-checked lemmas `extractText_accept_normalized` / `extractText_reject` equate to the projection-form residual axiom, so falsifying the conclusion falsifies the axiom), that it does not assert the `revisedText` / `originalText` projection equality directly, and that it is a single fixture case, NOT empirical grounding for a universal claim
