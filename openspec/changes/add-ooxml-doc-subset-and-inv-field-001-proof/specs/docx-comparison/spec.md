## ADDED Requirements

### Requirement: Field-structure preservation across track-change resolution is formally proved, with a single named residual obligation

The system SHALL carry a machine-checked Lean proof that, for any Lean `Doc` `d` satisfying the recursive well-formedness predicate `recursivelyWellformed d`, both `accept d` and `reject d` satisfy `validateFieldStructure`. `recursivelyWellformed` requires the whole-document `validateFieldStructure` to hold AND every wrapper subtree (`Ins`/`Del`/`MoveFrom`/`MoveTo`, transitively) to be `fieldSelfContained` (the depth/seenSeparator walk over the subtree's atoms starts and ends at `(0, false)`); this is strictly stronger than per-subtree `validateFieldStructure` and is the property that survives `accept`'s drop-and-unwrap operations. The Lean `accept` / `reject` / `validateFieldStructure` are definitional mirrors of `acceptAllChanges` / `rejectAllChanges` / `validateFieldStructure` from `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts:368-659` and `packages/docx-core/src/baselines/atomizer/pipeline.ts:352-402`.

The preservation lemma SHALL be closed (no `sorry`) in `verification/lean/Tier2/InvFieldOne.lean`. The existing `sorry` at `verification/lean/LeanSpike/Spec.lean:71` (`inv_field_001`) SHALL be discharged by composing the preservation lemma with a single new named axiom `compareDocumentXml_output_recursivelyWellformed` (declared in `Spec.lean`), which asserts that comparison output satisfies `recursivelyWellformed`. This named axiom is the single residual obligation. Discharging it by modeling `compareDocumentXml` definitionally is explicitly out of scope here and is owned by a successor Tier 3 change.

The proof is a property of the Lean model. Extensional equivalence between the Lean `accept`/`reject` and the production TS `acceptAllChanges`/`rejectAllChanges` is NOT established by this requirement and remains a documented residual obligation owned by Tier 2.5.

#### Scenario: [LEAN-T2-01] Preservation lemma is closed for `accept`

- **GIVEN** a Lean `Doc` value `d` such that `recursivelyWellformed d`
- **WHEN** `accept d` is evaluated
- **THEN** `validateFieldStructure (accept d) = true`, established by a closed Lean proof in `verification/lean/Tier2/InvFieldOne.lean`

#### Scenario: [LEAN-T2-02] Preservation lemma is closed for `reject`

- **GIVEN** a Lean `Doc` value `d` such that `recursivelyWellformed d`
- **WHEN** `reject d` is evaluated (which rewrites `DelText → Text` and `DelInstrText → InstrText` inside unwrapped `Del`/`MoveFrom` subtrees)
- **THEN** `validateFieldStructure (reject d) = true`, established by a closed Lean proof in `verification/lean/Tier2/InvFieldOne.lean`

#### Scenario: [LEAN-T2-03] `Spec.lean:71` sorry is replaced by a proof composing the named residual axiom and the preservation lemma

- **WHEN** `lake build` is run in `verification/lean/`
- **THEN** the build succeeds with at most one `sorry` warning (`inv_rt_001` at `Spec.lean:95`, which remains explicitly deferred)
- **AND** the sorry audit in `.github/workflows/lean-build.yml` reports no `sorry` outside `Spec.lean:95`
- **AND** the `inv_field_001` proof at `Spec.lean:66-71` uses `compareDocumentXml_output_recursivelyWellformed` and `Tier2.InvFieldOne.field_structure_preserved` as its only non-`Tier2`-internal premises

#### Scenario: [LEAN-T2-04] Residual obligations and model narrowing are documented

- **WHEN** a reader inspects `verification/lean/Tier2/README.md` or `verification/lean/README.md`'s Specification Gap section
- **THEN** the document explicitly states (a) that the closed `inv_field_001` proof carries `compareDocumentXml_output_recursivelyWellformed` as its single named residual axiom; (b) that this axiom is owned by Tier 3 and the next discharge step is to model `compareDocumentXml` definitionally; (c) that extensional equivalence with the TS `acceptAllChanges` / `rejectAllChanges` is owned by Tier 2.5; (d) that the production engine's runtime `validateFieldStructure` check is not made redundant by this proof; (e) that the model deliberately narrows the TS paragraph-removal logic (`trackChangesAcceptorAst.ts:411,456,564`) by treating only wrapper blocks as substantive, and a broader block shape is owned by Tier 2.5.

#### Scenario: [LEAN-T2-05] Field-bearing bridge case provides a falsifiability layer for the new axiom

- **WHEN** `packages/docx-core/src/integration/lean-spec-bridge.test.ts` runs
- **THEN** at least one field-bearing fixture case exercises a TS-side analogue of `recursivelyWellformed` (every `w:ins`/`w:del`/`w:moveFrom`/`w:moveTo` subtree under the comparison output is field-self-contained) against the live TS engine and passes
- **AND** the test docstring explicitly names this as a falsifiability layer for the new axiom — a single fixture case, NOT empirical grounding for a universal claim, since the existing 100-runs/property bridge cases at `lean-spec-bridge.test.ts:42` explicitly exclude field-bearing inputs and only check the consequence of the axiom (validateFieldStructure post-accept/reject), not the recursive precondition itself
