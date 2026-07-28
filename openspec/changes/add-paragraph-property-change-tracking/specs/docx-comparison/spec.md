## ADDED Requirements

### Requirement: Explicit paragraph style changes are tracked once per aligned paragraph

The atomizer comparison engine SHALL detect an addition, removal, or
replacement of the direct `w:pStyle/@w:val` reference on an otherwise aligned
paragraph. It SHALL represent the difference as one paragraph-level format
change regardless of the paragraph's run fragmentation or whether the
paragraph is empty.

The engine SHALL NOT classify inserted, deleted, moved, or text-divergent
paragraphs as paragraph-style-only changes. Direct paragraph formatting,
numbering properties, style-definition changes, and effective-style resolution
are outside this requirement.

#### Scenario: [SDX-CMP-PSTYLE-01] Non-empty paragraph style replacement is detected once

- **GIVEN** aligned original and revised paragraphs with identical text and run properties
- **AND** the original paragraph directly references `Heading1`
- **AND** the revised paragraph directly references `Normal`
- **WHEN** atomizer comparison runs with formatting detection enabled
- **THEN** exactly one paragraph-level format change SHALL be reported
- **AND** insertion and deletion counts SHALL remain zero

#### Scenario: [SDX-CMP-PSTYLE-02] Empty paragraph style replacement uses the same classification

- **GIVEN** aligned empty original and revised paragraphs
- **AND** their only substantive difference is direct `w:pStyle`
- **WHEN** atomizer comparison runs with formatting detection enabled
- **THEN** exactly one paragraph-level format change SHALL be reported
- **AND** the paragraph SHALL NOT be represented as a delete-and-insert pair

#### Scenario: [SDX-CMP-PSTYLE-03] Run fragmentation does not multiply paragraph changes

- **GIVEN** an aligned paragraph whose unchanged text is split across multiple runs
- **AND** its direct `w:pStyle` reference changes
- **WHEN** atomizer comparison runs with formatting detection enabled
- **THEN** exactly one paragraph-level format change SHALL be reported

### Requirement: Paragraph style changes use native paragraph-property revision markup

For each detected paragraph-style change, the comparison output SHALL keep the
revised direct paragraph properties active and SHALL append one
`w:pPrChange` containing the original paragraph properties as a bounded
`w:pPr` snapshot. The change record SHALL carry the comparison author, date,
and an allocated revision identifier, and SHALL occupy the schema-defined
position in `w:pPr`.

Inplace and rebuild reconstruction SHALL produce equivalent accept and reject
paragraph-style projections: accept SHALL expose the revised style and reject
SHALL restore the original style.

#### Scenario: [SDX-CMP-PSTYLE-04] Style replacement emits a reversible pPrChange

- **GIVEN** an aligned paragraph whose direct style changes from `Heading1` to `Normal`
- **WHEN** comparison runs in either reconstruction mode
- **THEN** the live `w:pPr` SHALL contain `w:pStyle w:val="Normal"`
- **AND** one `w:pPrChange` SHALL contain an original `w:pPr` snapshot with `w:pStyle w:val="Heading1"`
- **AND** the change record SHALL carry `w:id`, `w:author`, and `w:date`
- **AND** accept SHALL retain `Normal` while reject SHALL restore `Heading1`

#### Scenario: [SDX-CMP-PSTYLE-05] Style addition and removal remain reversible

- **GIVEN** aligned paragraph pairs that respectively add and remove a direct style reference
- **WHEN** comparison runs in each reconstruction mode
- **THEN** each output SHALL contain one schema-valid `w:pPrChange`
- **AND** accept and reject SHALL recover the corresponding revised and original direct style states

### Requirement: Ignored paragraph style changes use the revised style consistently

When `ignoreFormatting` is `true`, the comparison engine SHALL suppress
paragraph-style format-change reporting and `w:pPrChange` emission. Both
reconstruction modes SHALL retain the revised direct style reference as the
untracked formatting baseline.

#### Scenario: [SDX-CMP-PSTYLE-06] ignoreFormatting suppresses paragraph style markup

- **GIVEN** aligned paragraphs whose only difference is direct `w:pStyle`
- **WHEN** comparison runs with `ignoreFormatting: true` in either reconstruction mode
- **THEN** no paragraph-level format change SHALL be reported
- **AND** no `w:pPrChange` SHALL be emitted for that difference
- **AND** both outputs SHALL retain the revised direct style

### Requirement: Real-corpus comparison does not invent paragraph style changes

The required SHA-256-pinned real-corpus comparison evidence SHALL verify that
aligned paragraphs with unchanged direct `w:pStyle` references do not enter
the paragraph-style change inventory or acquire a `w:pPrChange` attributable
to paragraph-style detection.

#### Scenario: [SDX-CMP-PSTYLE-07] Unchanged real paragraph styles produce no phantom markup

- **GIVEN** the required SHA-256-verified real DOCX corpus
- **WHEN** its comparison pairs run in both reconstruction modes
- **THEN** every paragraph-style change inventory entry SHALL correspond to an explicit direct style-reference difference in the aligned inputs
- **AND** an aligned paragraph with equal direct style references SHALL acquire no `w:pPrChange` attributable to paragraph-style detection
