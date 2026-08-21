## ADDED Requirements

### Requirement: Eligible comments convert to footnotes transactionally

The system SHALL convert selected root Word comments to footnotes after complete
preflight, place each reference at the comment range's visible endpoint, preserve
operative text and unselected content, and return a complete disposition report.

#### Scenario: [SDX-PRIM-210] Selected comments become footnotes
- **GIVEN** supported root comments selected explicitly or by an all-comments selector
- **WHEN** conversion succeeds
- **THEN** each selected comment SHALL produce one footnote reference and definition
- **AND** obsolete comment markers, references, and definitions SHALL be removed
- **AND** substantive footnotes and unselected comments SHALL remain unchanged

#### Scenario: [SDX-PRIM-211] Unsupported selection is atomic
- **GIVEN** a selected comment with an unsupported anchor or invalid presentation styling
- **WHEN** conversion is requested
- **THEN** preflight SHALL fail before publishing output
- **AND** no selected or unselected note SHALL be partially mutated

#### Scenario: [SDX-PRIM-212] Footnote markers render as superscript
- **GIVEN** a source whose `FootnoteReference` character style is absent or incomplete
- **WHEN** a converted footnote is emitted
- **THEN** its body reference and definition reference SHALL carry explicit superscript run properties

### Requirement: Thread flattening is explicit and reported as lossy

Threaded comments SHALL fail conversion by default and SHALL flatten only under
an explicit policy that preserves deterministic message order.

#### Scenario: [SDX-PRIM-213] Thread is rejected by default
- **GIVEN** a selected root comment with replies
- **WHEN** conversion is requested without flattening
- **THEN** conversion SHALL fail before mutation

#### Scenario: [SDX-PRIM-214] Explicit flattening is auditable
- **GIVEN** a selected thread and explicit flattening
- **WHEN** conversion succeeds
- **THEN** the root and replies SHALL appear in deterministic order
- **AND** the report SHALL mark the transformation as lossy
