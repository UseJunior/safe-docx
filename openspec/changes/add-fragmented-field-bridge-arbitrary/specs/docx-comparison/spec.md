## ADDED Requirements

### Requirement: Fragmented-field property coverage falsifies the inplace residual axioms over generated fragmented-field documents

The system SHALL exercise the two named residual axioms about this repo's inplace `compareDocumentXml` output — `compareDocumentXml_output_preservation_friendly` (INV-FIELD-001) and `compareDocumentXml_output_text_roundtrip` (INV-RT-001), declared in `verification/lean/LeanSpike/Spec.lean` — against the live TypeScript comparison engine over a **fast-check arbitrary that generates fragmented-field documents**: documents whose difference fragments a field's internal atoms (`w:instrText` / `w:delInstrText` / field result runs) into `<w:ins>` / `<w:del>` wrappers under track changes while the `w:fldChar` markers remain sibling-run-level and unwrapped.

This requirement extends the field-bearing coverage added by "Field-bearing property coverage falsifies the inplace residual axioms over generated field documents" to the fragmented-field surface that requirement explicitly deferred. Nested fields and fields spanning paragraph boundaries remain out of scope and deferred to a named successor.

The arbitrary (`fragmentedFieldPairArb`) SHALL be a sibling of `fieldBearingPairArb`, NOT a fourth operation on it, and SHALL generate `(original, revised)` body-XML pairs realizing one of a fixed set of fragmented-field operations:

- `result-edit` — a complete, identical field on both clean sides except the field **result** run text differs, so the engine tracks a change inside the field;
- `pretracked-fragmented-to-clean` — the original side carries a pre-tracked fragmented field (instruction text already wrapped in `<w:ins>`/`<w:del>`, `fldChar` markers sibling-level), the revised side carries the clean complete field;
- `clean-to-pretracked-fragmented` — the reverse direction.

Because the engine **correctly falls back to a non-inplace reconstruction** for part of this surface (empirically, `clean-to-pretracked-fragmented` drives a `rebuild` with `round_trip_safety_check_failed`), the property tests over this arbitrary SHALL assert **mode-independent** invariants and SHALL NOT treat inplace fallback as falsification. Specifically, on every run regardless of the reconstruction mode the engine selected, the property SHALL:

- assert `validateFieldStructure(acceptAllChanges(combined))` and `validateFieldStructure(rejectAllChanges(combined))` — the INV-FIELD-001 obligation on the **resolved** projections, NOT on the raw mixed-revision `combined` output (which legitimately fails field-structure validation mid-revision under fallback);
- assert that the normalized text of `acceptAllChanges(combined)` equals the revised input's normalized text and the normalized text of `rejectAllChanges(combined)` equals the original's, using the live `extractTextWithParagraphs` / `normalizeText`, with field result text counted and `instrText` / `delInstrText` / `fldChar` atoms contributing no text — the INV-RT-001 obligation;
- NOT assert `assertInplaceResult` and NOT assert `validateFieldStructure(combined)`.

The property SHALL record the `(operation, reconstruction-mode-or-fallback)` of each run and assert a coverage floor requiring that **both** an inplace outcome **and** a fallback outcome were observed **and** every operation family was exercised, so the engine silently degrading to all-inplace or all-fallback, or a generator dropping an operation, fails the property loudly rather than passing vacuously. The floor SHALL be satisfied deterministically via seeded `examples` rather than relying on the random generator.

This requirement strengthens empirical falsifiability only; it introduces no Lean change and does not discharge either residual axiom (Tier 3 owns that). The existing field-free and field-bearing property tests and the single field fixtures SHALL remain unchanged.

#### Scenario: [LEAN-FRAG-01] Fragmented-field arbitrary drives both residual axioms across operations

- **GIVEN** the `fragmentedFieldPairArb` fast-check arbitrary generating `(original, revised)` pairs over the `result-edit`, `pretracked-fragmented-to-clean`, and `clean-to-pretracked-fragmented` operations
- **WHEN** each generated pair is compared through the live engine with `reconstructionMode: 'inplace'` and the combined output is accepted and rejected
- **THEN** `validateFieldStructure(acceptAllChanges(combined))` and `validateFieldStructure(rejectAllChanges(combined))` hold on every run, and the normalized accepted text equals the revised input's normalized text and the normalized rejected text equals the original's, with the property executing at `numRuns: 100`

#### Scenario: [LEAN-FRAG-02] Inplace fallback is a legitimate, mode-independent outcome, not falsification

- **WHEN** a generated run (e.g. `clean-to-pretracked-fragmented`) drives the engine to fall back from inplace to a `rebuild` reconstruction with `round_trip_safety_check_failed`
- **THEN** the property still passes that run, asserting the INV-FIELD-001 and INV-RT-001 obligations on the resolved accept / reject projections rather than failing via `assertInplaceResult`
- **AND** the property does not assert `validateFieldStructure(combined)` on the raw mixed-revision output, because a field mid-revision is not a single well-formed field until a side is chosen

#### Scenario: [LEAN-FRAG-03] Mode-distribution and operation coverage are floored, not silently filtered

- **WHEN** the fragmented-field property runs
- **THEN** a coverage assertion requires that both an inplace outcome and a fallback outcome were observed across the run set, and that every fragmented-field operation family was exercised
- **AND** the floor is satisfied deterministically via seeded `examples`, so the engine silently degrading to all-inplace or all-fallback — or a generator dropping an operation — fails the property loudly rather than being discarded by `fc.pre`

#### Scenario: [LEAN-FRAG-04] Bridge file self-description distinguishes fallback-is-falsification from fallback-is-legitimate

- **WHEN** a reader inspects the header comment blocks of `packages/docx-core/src/integration/lean-spec-bridge.test.ts`
- **THEN** the "Coverage surfaces" block lists the fragmented-field arbitrary and its operation families
- **AND** the "Fallback semantics" block records that the fragmented-field arbitrary treats inplace fallback as a legitimate, coverage-floored outcome (not falsification), distinguishing it from the field-free and whole-field arbitraries where fallback remains falsification
