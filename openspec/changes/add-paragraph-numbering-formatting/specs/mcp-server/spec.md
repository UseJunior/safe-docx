## ADDED Requirements

### Requirement: Deterministic Paragraph Numbering Formatting Tool
The Safe-DOCX MCP server SHALL provide a DOCX-only `format_numbering` tool that targets one main-document paragraph by anchor and changes its direct `w:numPr` without changing visible paragraph text.

#### Scenario: Remove direct paragraph numbering
- **GIVEN** a target paragraph with a direct `w:numPr`
- **WHEN** `format_numbering` is called with `remove: true`
- **THEN** the server SHALL remove the target's direct `w:numPr`
- **AND** SHALL preserve its text, anchor, and unrelated paragraph properties

#### Scenario: Match another paragraph's explicit numbering
- **GIVEN** source and target paragraph anchors in the same DOCX
- **AND** the source has a complete direct `w:numPr`
- **WHEN** `format_numbering` is called with the source as `match_paragraph_id`
- **THEN** the target SHALL receive the source's explicit `w:numId` and `w:ilvl`
- **AND** `word/numbering.xml` SHALL remain unchanged

#### Scenario: Set an existing numbering reference directly
- **GIVEN** a DOCX whose numbering part defines the requested numbering instance
  and level
- **WHEN** `format_numbering` is called with that `num_id` and `ilvl`
- **THEN** the target SHALL receive a schema-ordered `w:numPr` containing
  `w:ilvl` followed by `w:numId`
- **AND** no numbering definition SHALL be created or modified

#### Scenario: Identical direct numbering is a deterministic no-op
- **GIVEN** the target already has the requested direct `w:numId` and `w:ilvl`
- **WHEN** the same `format_numbering` request is repeated
- **THEN** the server SHALL report that no mutation occurred
- **AND** SHALL NOT increment edit accounting or add another property revision

### Requirement: Paragraph Numbering Validation Is Transactional
The paragraph numbering tool SHALL resolve and validate the complete request before mutating the document.

#### Scenario: Mutually exclusive operation forms are enforced
- **WHEN** a request supplies zero operation forms or combines remove, match, or
  direct-reference forms
- **THEN** the server SHALL reject it with a structured validation error
- **AND** SHALL include remediation guidance describing the accepted forms

#### Scenario: Match source must have complete direct numbering
- **GIVEN** a source paragraph that is unnumbered or numbered only through style
  inheritance
- **WHEN** it is supplied as `match_paragraph_id`
- **THEN** the server SHALL reject the request with a structured error
- **AND** the target paragraph SHALL remain unchanged

#### Scenario: Dangling numbering references are rejected before mutation
- **WHEN** a direct or matched `numId` instance, abstract definition, or `ilvl`
  cannot be resolved in `word/numbering.xml`
- **THEN** the server SHALL reject the request with a structured error and hint
- **AND** the serialized document XML SHALL remain unchanged

#### Scenario: Removing absent direct numbering is explicit
- **GIVEN** a target paragraph without a direct `w:numPr`
- **WHEN** `format_numbering` is called with `remove: true`
- **THEN** the server SHALL return a successful no-op with a warning
- **AND** SHALL NOT claim that style-inherited numbering was removed

#### Scenario: Unsupported providers are rejected
- **WHEN** `format_numbering` targets an ODT file or Google Doc
- **THEN** the server SHALL return a structured unsupported-provider error
- **AND** SHALL NOT mutate the source

### Requirement: Paragraph Numbering Changes Are Reviewable
An effective direct-numbering mutation SHALL be represented as a native paragraph-property tracked change using the session revision context.

#### Scenario: Effective numbering change emits prior properties
- **GIVEN** a target whose direct numbering differs from the requested state
- **WHEN** `format_numbering` applies the change
- **THEN** the target `w:pPr` SHALL contain one `w:pPrChange` with the prior
  paragraph properties
- **AND** its revision ID, author, and date SHALL come from the session revision
  context

#### Scenario: Clean and tracked saves represent the same numbering edit
- **GIVEN** a successful direct-numbering mutation
- **WHEN** the session is saved in clean and tracked forms
- **THEN** the clean output SHALL contain the requested current `w:numPr` state
- **AND** the tracked output SHALL retain a reviewable `w:pPrChange`

#### Scenario: Standard accept and reject semantics cover numbering changes
- **GIVEN** a numbering mutation recorded as `w:pPrChange`
- **WHEN** that property revision is accepted or rejected through supported
  revision workflows
- **THEN** acceptance SHALL keep the requested numbering state
- **AND** rejection SHALL restore the prior direct numbering state

### Requirement: Paragraph Numbering Mutation Preserves Document Identity
The paragraph numbering tool SHALL limit its mutation to the selected paragraph's direct numbering property and revision record.

#### Scenario: Text and paragraph anchors remain stable
- **GIVEN** a document with stable paragraph anchors
- **WHEN** one paragraph's direct numbering is changed
- **THEN** paragraph count and visible text SHALL remain unchanged
- **AND** every pre-existing paragraph anchor SHALL remain addressable

#### Scenario: Non-target package content remains unchanged
- **WHEN** `format_numbering` changes one paragraph
- **THEN** unrelated paragraph properties and non-target paragraphs SHALL remain
  unchanged
- **AND** numbering definitions and non-body package parts SHALL remain unchanged
