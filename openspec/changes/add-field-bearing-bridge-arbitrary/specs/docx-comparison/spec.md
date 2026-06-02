## ADDED Requirements

### Requirement: Field-bearing property coverage falsifies the inplace residual axioms over generated field documents

The system SHALL exercise the two named residual axioms about this repo's inplace `compareDocumentXml` output — `compareDocumentXml_output_preservation_friendly` (INV-FIELD-001) and `compareDocumentXml_output_text_roundtrip` (INV-RT-001), declared in `verification/lean/LeanSpike/Spec.lean` — against the live TypeScript comparison engine over a **fast-check arbitrary that generates field-bearing documents**, not only over hand-written single fixtures.

The arbitrary SHALL generate clean (non-pre-tracked) `(original, revised)` document pairs in which selected paragraphs carry a complete, self-contained field drawn from the shared constants `COMPLETE_NUMPAGES_FIELD` / `COMPLETE_PAGE_FIELD` / `COMPLETE_PAGEREF_FIELD` (`packages/docx-core/src/testing/ooxml-fixtures.ts`), and the difference between the two sides SHALL realize one of a fixed set of field operations: field-insert, field-delete, field-stable (field present and identical on both sides), and text-only (field unchanged on both sides with a tracked text edit in a different paragraph). The arbitrary SHALL NOT generate fragmented field modifications, nested fields, or fields spanning paragraph boundaries; those surfaces are out of scope.

The property tests SHALL run through the inplace reconstruction path and:

- treat any inplace fallback as falsification (via the existing `assertInplaceResult`, emitting `triage=inplace-fallback`), NOT silently filter it with `fc.pre`;
- assert an operation-family (and field-type) coverage floor so a generator that stopped producing an operation fails loudly rather than passing vacuously;
- for INV-FIELD-001, assert the document-level field-structure invariant (`assertFieldInvariant`) on every run, and additionally assert the stronger per-subtree `recursivelyWellformed` / `fieldContextNeutral ∀ ctx` invariant (`assertRecursivelyWellformed`) only on runs whose operation is not field-delete, because post-#217 the inplace atomizer fragments deleted fields and the resulting `<w:del>` subtrees are not field-context-neutral — the same per-operation assertion-strength split the existing field-delete fixture documents;
- for INV-RT-001, assert that the normalized text of `acceptAllChanges(combined)` equals the revised input's normalized text and the normalized text of `rejectAllChanges(combined)` equals the original's, using the live `extractTextWithParagraphs` / `normalizeText`, with field result text (`<w:t>` payloads) counted and `instrText` / `delInstrText` / `fldChar` atoms contributing no text.

This requirement strengthens empirical falsifiability only; it introduces no Lean change and does not discharge either residual axiom (Tier 3 owns that). The existing field-free property tests and the three single field fixtures SHALL remain.

#### Scenario: [LEAN-FBA-01] Field-bearing arbitrary drives INV-FIELD-001 across operations

- **GIVEN** the `fieldBearingPairArb` fast-check arbitrary generating clean field-bearing `(original, revised)` pairs over field-insert / field-delete / field-stable / text-only operations and the NUMPAGES / PAGE / PAGEREF field types
- **WHEN** each generated pair is compared through the live inplace engine and the combined output is accepted and rejected
- **THEN** `assertFieldInvariant` holds on every run and `assertInplaceResult` confirms inplace mode was used, with the property executing at `numRuns: 100`

#### Scenario: [LEAN-FBA-02] Per-operation assertion strength matches the post-#217 engine

- **WHEN** a generated run's operation is field-insert, field-stable, or text-only
- **THEN** the stronger `assertRecursivelyWellformed` (per-subtree `fieldContextNeutral ∀ ctx`) is asserted in addition to `assertFieldInvariant`
- **AND** when the operation is field-delete, only the document-level `assertFieldInvariant` is asserted, because the fragmented `<w:del>` subtrees are not field-context-neutral — matching the strength of the `compareDocumentXml_output_preservation_friendly` axiom

#### Scenario: [LEAN-FBA-03] Field-bearing arbitrary drives INV-RT-001 round-trip

- **WHEN** each generated field-bearing pair is compared and the combined output is projected through accept-all and reject-all
- **THEN** the normalized accepted text equals the revised input's normalized text and the normalized rejected text equals the original's, via the live `extractTextWithParagraphs` / `normalizeText`, with field result text counted and field instruction / fldChar atoms contributing none

#### Scenario: [LEAN-FBA-04] Fallback is falsification and coverage is floored, not silently filtered

- **WHEN** the field-bearing properties run
- **THEN** any inplace fallback fails the property with `triage=inplace-fallback` diagnostics rather than being discarded by `fc.pre`
- **AND** a coverage assertion requires every field operation family (and field type) to have been exercised, so a degenerate generator that drops an operation fails loudly instead of passing vacuously

#### Scenario: [LEAN-FBA-05] Bridge file self-description stays accurate

- **WHEN** a reader inspects the header comment blocks of `packages/docx-core/src/integration/lean-spec-bridge.test.ts`
- **THEN** the "Coverage surfaces" block lists the field-bearing arbitrary and its operation families, the "Fallback semantics" block scopes the "field-free ⇒ no `ContainerResolutionError`" claim to the two original generators and documents the field-bearing arbitrary's narrower inplace-safe operation set, and the "Coverage limitations" note no longer implies all field-bearing input families live only in `collapsed-field-inplace.test.ts`
