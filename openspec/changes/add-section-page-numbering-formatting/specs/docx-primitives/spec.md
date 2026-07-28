## ADDED Requirements

### Requirement: Deterministic Main-Document Section Inventory
The DOCX primitives library SHALL enumerate canonically placed main-document
section properties in document order without treating nested revision snapshots
as live sections.

#### Scenario: Paragraph boundaries precede the final body section
- **GIVEN** a document with direct `w:p/w:pPr/w:sectPr` boundaries and a final
  direct `w:body/w:sectPr`
- **WHEN** the section inventory is read
- **THEN** paragraph-boundary sections SHALL appear in document order
- **AND** the final body section SHALL appear last

#### Scenario: Section inventory projects existing settings
- **GIVEN** section properties containing page numbering, page size, margins,
  and header/footer references
- **WHEN** the section inventory is read
- **THEN** the corresponding values and relationship roles SHALL be returned
- **AND** reading SHALL NOT mutate serialized document XML

#### Scenario: Revision snapshots are not live sections
- **GIVEN** a live `w:sectPr` containing `w:sectPrChange/w:sectPr`
- **WHEN** the section inventory is read
- **THEN** the nested prior-properties snapshot SHALL NOT receive a
  `section_index`

### Requirement: Section Page Number Restart Mutation
The DOCX primitives library SHALL set the page-number restart of one indexed
main-document section by changing only `w:sectPr/w:pgNumType/@w:start`.

#### Scenario: Missing page numbering settings are created in schema order
- **GIVEN** a valid section without `w:pgNumType`
- **WHEN** its restart is set
- **THEN** one `w:pgNumType` SHALL be inserted in the `CT_SectPr` schema slot
- **AND** its `w:start` SHALL equal the requested non-negative integer

#### Scenario: Existing page numbering attributes are preserved
- **GIVEN** `w:pgNumType` with format or chapter-number attributes
- **WHEN** its restart is changed
- **THEN** only `w:start` SHALL change
- **AND** `w:fmt`, `w:chapStyle`, and `w:chapSep` SHALL remain unchanged

#### Scenario: Unrelated section properties are preserved
- **GIVEN** a section with page size, margins, columns, and header/footer
  references
- **WHEN** its restart is changed
- **THEN** those untargeted properties and relationships SHALL remain unchanged
- **AND** section count, paragraph count, and visible text SHALL remain unchanged

#### Scenario: Identical page number restart is a deterministic no-op
- **GIVEN** a section whose `w:start` already equals the requested value
- **WHEN** the same restart is requested
- **THEN** the mutation SHALL report `changed: false`
- **AND** SHALL NOT allocate or append a section-property revision

### Requirement: Section Page Number Changes Are Reviewable
An effective section restart mutation SHALL be represented as a native
section-property tracked change.

#### Scenario: Prior section properties are captured
- **GIVEN** a section whose page-number restart changes
- **WHEN** the mutation receives a revision context
- **THEN** the live `w:sectPr` SHALL contain one `w:sectPrChange`
- **AND** its nested `w:sectPr` SHALL contain the prior section properties
- **AND** no `w:sectPrChange` SHALL be nested inside that snapshot

#### Scenario: Accept and reject preserve section semantics
- **GIVEN** a restart recorded as `w:sectPrChange`
- **WHEN** the revision is accepted or rejected
- **THEN** acceptance SHALL keep the requested restart
- **AND** rejection SHALL restore the prior restart and unrelated properties
