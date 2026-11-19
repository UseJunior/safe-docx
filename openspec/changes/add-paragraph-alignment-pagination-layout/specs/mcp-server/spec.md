## ADDED Requirements

### Requirement: Paragraph Alignment and Pagination Layout Controls

The `format_layout` tool SHALL accept a `paragraph_properties` group for DOCX
sessions that targets one or more paragraph ids and sets the direct paragraph
alignment (`left`, `center`, `right` or `both`, written as `w:jc`) and sets
(`true`) or removes (`false`) the direct `w:pageBreakBefore`, `w:keepNext`
and `w:keepLines` properties, without changing paragraph text or count.

#### Scenario: Center an existing paragraph as a tracked property change

- **GIVEN** a two-paragraph document whose first paragraph is centered and whose second is left-aligned
- **WHEN** `format_layout` is called with `paragraph_properties.alignment` set to `center` for the second paragraph
- **THEN** the second paragraph SHALL carry `w:jc w:val="center"`
- **AND** it SHALL carry one `w:pPrChange` whose snapshot holds the prior paragraph properties

#### Scenario: Remove a redundant page break before a new section

- **GIVEN** a paragraph with a direct `w:pageBreakBefore` that a `nextPage` section break now precedes
- **WHEN** `format_layout` is called with `paragraph_properties.page_break_before` set to `false`
- **THEN** the paragraph SHALL no longer carry a direct `w:pageBreakBefore`
- **AND** its `w:pPrChange` snapshot SHALL still hold the removed property

#### Scenario: Accept keeps and reject restores paragraph properties

- **WHEN** a tracked alignment or pagination change is accepted
- **THEN** the new properties SHALL remain and the `w:pPrChange` SHALL be removed
- **WHEN** the same change is rejected instead
- **THEN** the prior paragraph properties SHALL be restored

#### Scenario: Existing paragraph-property revisions keep a sound baseline

- **GIVEN** a paragraph whose alignment the same AI author already changed in a tracked `w:pPrChange`
- **WHEN** a later `format_layout` call changes its spacing or pagination flags
- **THEN** the paragraph SHALL keep one `w:pPrChange` whose snapshot is the state before the first change
- **AND** rejecting the AI edits SHALL restore that state
- **WHEN** the existing `w:pPrChange` belongs to a different author
- **THEN** a `paragraph_properties` request for that paragraph, alone or combined with `paragraph_spacing`, SHALL fail with `FOREIGN_PARAGRAPH_REVISION` without mutating the session

#### Scenario: Pagination flags are set in schema order

- **WHEN** `keep_next`, `keep_lines` and `page_break_before` are set on a paragraph that already has a style, spacing and alignment
- **THEN** the paragraph properties SHALL follow the `CT_PPrBase` child sequence

#### Scenario: Unchanged paragraph properties are a no-op

- **WHEN** every requested property already has the requested direct value, including an explicit on value such as `w:val="1"`
- **THEN** the tool SHALL report zero affected paragraphs
- **AND** it SHALL emit no revision markup and leave edit accounting unchanged

#### Scenario: Invalid paragraph property input is rejected

- **WHEN** `paragraph_properties` has an unsupported alignment, a non-boolean flag, no property, or a missing paragraph id in strict mode
- **THEN** the tool SHALL return a structured error without mutating the session
- **AND** Google Docs sessions SHALL receive `UNSUPPORTED_FOR_PROVIDER`
