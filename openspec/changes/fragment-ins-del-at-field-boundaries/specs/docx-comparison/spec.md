## ADDED Requirements

### Requirement: ECMA-376 Field-Fragmentation Conformance on the Deletion Side

The atomizer comparison pipeline SHALL emit tracked-change markup such that `w:fldChar` runs are never wrapped inside `<w:del>`. For any collapsed-field atom processed by the deletion path, the engine SHALL emit the constituent `w:fldChar` runs at run-sibling level and wrap only the `w:instrText` (renamed to `w:delInstrText`) and result-text (renamed to `w:delText`) payloads in `<w:del>` wrappers.

#### Scenario: deletion of an entire existing field fragments per ECMA-376

- **GIVEN** an original document containing a complex field (e.g., `NUMPAGES`) and a revised document with the field removed under tracked changes
- **WHEN** `compareDocumentsAtomizer` produces the combined output
- **THEN** no `w:fldChar` element SHALL appear inside any `<w:del>` wrapper
- **AND** the field's `w:fldChar` runs SHALL appear at run-sibling level in document order
- **AND** the field's `w:instrText` payload SHALL be wrapped in a `<w:del>` element (renamed to `w:delInstrText`)
- **AND** the field's result-text payload SHALL be wrapped in a `<w:del>` element (renamed to `w:delText`)
- **AND** `validateFieldStructure(acceptedXml)` SHALL return true
- **AND** `validateFieldStructure(rejectedXml)` SHALL return true

#### Scenario: modification of an existing field with a result-text change

- **GIVEN** an original document containing a complex field (e.g., `NUMPAGES` with result "3") and a revised document with the same field but a different result text (e.g., result "4")
- **WHEN** `compareDocumentsAtomizer` produces the combined output
- **THEN** no `w:fldChar` element SHALL appear inside any `<w:del>` wrapper
- **AND** the deleted side's `w:instrText` / result payloads SHALL be wrapped in `<w:del>` wrappers (renamed to `w:delInstrText` / `w:delText`)

#### Scenario: w:fldChar SHALL NOT appear inside w:del (universal rule)

- **GIVEN** any tracked-change scenario producing a combined output
- **WHEN** the combined output is emitted
- **THEN** no `w:fldChar` element SHALL appear as a descendant of any `<w:del>` element

#### Scenario: targeted combined-output safety gate rejects regressions

- **GIVEN** the inplace pipeline is producing combined XML
- **WHEN** the safety check phase runs
- **THEN** the pipeline SHALL call a targeted check that no `w:fldChar` element appears inside any `<w:del>` element in the combined output
- **AND** the pipeline SHALL continue to call `validateFieldStructure` on both the accept and reject projections
- **AND** if any of the three checks fails, the pipeline SHALL fall back to rebuild reconstruction

#### Scenario: insertion of a complete new field remains wrapped as one w:ins

- **GIVEN** an original document without a field and a revised document with a complete new field added under tracked changes
- **WHEN** `compareDocumentsAtomizer` produces the combined output
- **THEN** the new field's begin / instrText / separate / result / end runs MAY be wrapped together in a single `<w:ins>` element
- **AND** `validateFieldStructure(combinedXml)` SHALL return true
- **AND** the wrapper subtree SHALL satisfy field-context-neutrality under any outer field-stack context

#### Scenario: move-destination of a field remains wrapped as one w:moveTo

- **GIVEN** a tracked move whose destination contains a complete complex field
- **WHEN** `compareDocumentsAtomizer` produces the combined output
- **THEN** the move-destination's field runs MAY be wrapped together in a single `<w:moveTo>` element
- **AND** no `w:fldChar` element SHALL appear inside any `<w:del>` element
