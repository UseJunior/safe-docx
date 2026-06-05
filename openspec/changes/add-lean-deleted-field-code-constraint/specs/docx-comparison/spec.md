## ADDED Requirements

### Requirement: Lean field-structure model enforces the DeletedFieldCode locality constraint

The Lean field-structure model SHALL enforce the OOXML `DeletedFieldCode` locality constraint in
`Tier2.FieldStructure.validateFieldStructure` (`verification/lean/Tier2/FieldStructure.lean`). This is
constraint (3) of the production `validateFieldStructure`
(`packages/docx-core/src/baselines/atomizer/pipeline.ts:427-428`, enforced at `pipeline.ts:474`): a
`w:fldChar` of any `w:fldCharType` MUST NOT appear inside a `w:del` ancestor, and a `w:delInstrText`
MUST appear only inside a `w:del` ancestor. The field-context walk SHALL carry a
structural del-ancestry depth (incremented only when descending into a `del` subtree) and SHALL return
its absorbing `invalid` state on a `fldChar` at del-depth > 0 and on a `delInstrText` at del-depth 0,
preserving the existing global begin/end balance check and the open-pre-`separate` field-body check for
`instrText`/`delInstrText`. The full verification spike SHALL remain zero-`sorry`; this requirement
modifies no production-engine code.

Closing this constraint retires the two characterized validate divergences `G1` (`fldChar` inside `del`)
and `G2` (`delInstrText` outside `del`) recorded by the Lean↔TS helper differential: the Lean and TS
`validateFieldStructure` SHALL now agree on both shapes. The two paragraph-mark accept/reject collapse
gaps `G3`/`G4` are out of scope and remain documented as the successor model-broadening increment (they
require extending the `OoxmlModel` paragraph datatype with mark track-change status).

#### Scenario: [LEAN-DFC-01] fldChar inside w:del is rejected by both engines

- **GIVEN** a `Doc` with a `w:fldChar` inside a `del` wrapper (the former `G1` case)
- **WHEN** it is run through the Lean `validateFieldStructure` and the production TS `validateFieldStructure`
- **THEN** both return `false`, and the helper differential asserts agreement rather than a documented divergence

#### Scenario: [LEAN-DFC-02] delInstrText outside w:del is rejected by both engines

- **GIVEN** a `Doc` with a `delInstrText` in an open pre-`separate` field but outside any `del` wrapper (the former `G2` case)
- **WHEN** it is run through the Lean `validateFieldStructure` and the production TS `validateFieldStructure`
- **THEN** both return `false`, asserted as agreement in the helper differential

#### Scenario: [LEAN-DFC-03] Legal delInstrText inside an open field inside w:del still validates

- **GIVEN** a `Doc` with a `delInstrText` in its one OOXML-legal home — inside a `del` wrapper, in an open pre-`separate` field opened at top level
- **WHEN** it is run through the Lean `validateFieldStructure`
- **THEN** it returns `true`, confirming the del-ancestry gate is orthogonal to the field context that crosses the `del` boundary

#### Scenario: [LEAN-DFC-04] The spike stays zero-sorry after the model change

- **WHEN** the verification spike is built (`lake build`) and scanned for the proof-hole keyword over every non-`.lake` `.lean` module
- **THEN** the build succeeds and the scan is empty: the load-bearing document-level preservation theorem `field_structure_preserved_doc` is retained as plumbing over `preservationFriendly` walked at del-depth 0, while the legacy stronger `field_structure_preserved` and its per-step rename-safety lemmas — made false-as-stated by constraint (3) and whose precondition no longer admits legal deleted-field-code documents — are retired by deletion, never by a proof placeholder
