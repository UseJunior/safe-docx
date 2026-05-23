## ADDED Requirements

### Requirement: ECMA-376 Field-Fragmentation Conformance

The atomizer comparison pipeline SHALL emit tracked-change markup such that `w:fldChar` runs are never wrapped inside `<w:del>`, and SHALL fragment `<w:ins>` / `<w:del>` / `<w:moveTo>` wrappers around modified field content so that only `w:instrText` / `w:delInstrText` / result payloads are wrapped.

#### Scenario: modification of an existing field's instruction text emits fragmented markup

- **GIVEN** an original document containing a complex field (e.g., `FORMCHECKBOX`) with begin / instrText / separate / result / end runs
- **AND** a revised document in which the instruction text has been rewritten (e.g., `FORMTEXT`) under tracked changes
- **WHEN** `compareDocumentsAtomizer` produces the combined output
- **THEN** every `w:fldChar` run SHALL appear at run-sibling level, not inside any `<w:ins>` / `<w:del>` / `<w:moveTo>` wrapper
- **AND** the original `w:instrText` SHALL be wrapped inside a `<w:del>` (converted to `w:delInstrText`)
- **AND** the revised `w:instrText` SHALL be wrapped inside a `<w:ins>`
- **AND** `validateFieldStructure(combinedXml)` SHALL return true

#### Scenario: w:fldChar SHALL NOT appear inside w:del

- **GIVEN** any tracked-change scenario involving a field — modification, deletion, or move
- **WHEN** the combined output is emitted
- **THEN** no `w:fldChar` element SHALL appear as a descendant of any `<w:del>` element

#### Scenario: insertion of a complete new field remains wrapped as one w:ins

- **GIVEN** an original document without a field and a revised document with a complete new field added under tracked changes
- **WHEN** `compareDocumentsAtomizer` produces the combined output
- **THEN** the new field's begin / instrText / separate / result / end runs MAY be wrapped together in a single `<w:ins>` element
- **AND** `validateFieldStructure(combinedXml)` SHALL return true
- **AND** the wrapper subtree SHALL satisfy field-context-neutrality under any outer field-stack context

#### Scenario: combined-output safety gate rejects regressions

- **GIVEN** the inplace pipeline is producing combined XML
- **WHEN** the safety check phase runs
- **THEN** the pipeline SHALL call `validateFieldStructure` on the combined output in addition to the accept and reject projections
- **AND** if any of the three checks returns false, the pipeline SHALL fall back to rebuild reconstruction

#### Scenario: deletion of an entire existing field fragments per ECMA-376 representation

- **GIVEN** an original document containing a complex field and a revised document with the field removed under tracked changes
- **WHEN** `compareDocumentsAtomizer` produces the combined output
- **THEN** no `w:fldChar` element SHALL appear inside any `<w:del>` wrapper
- **AND** `validateFieldStructure(combinedXml)` SHALL return true
- **AND** both `validateFieldStructure(acceptedXml)` and `validateFieldStructure(rejectedXml)` SHALL return true
