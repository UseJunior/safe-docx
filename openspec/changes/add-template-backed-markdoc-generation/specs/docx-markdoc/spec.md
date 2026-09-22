## ADDED Requirements

### Requirement: Tag-free Markdoc can generate a body in a declared house style

The system SHALL compile a tag-free canonical Markdoc body against a declared
DOCX template and explicit existing paragraph-style mapping. Canonical body
text SHALL be the only source of emitted body text, and unsupported Markdown or
unresolvable style IDs SHALL fail before any output is written.

#### Scenario: [SDX-MDOC-GREEN-01] headings and paragraphs use declared template styles
- **GIVEN** a valid one-section template and tag-free Markdoc containing ATX headings and plain paragraphs
- **WHEN** greenfield compilation runs with a style profile whose used style IDs exist in the template
- **THEN** the clean DOCX body SHALL contain exactly the canonical heading and paragraph blocks in authored order
- **AND** each block SHALL use its resolved declared template paragraph style

#### Scenario: [SDX-MDOC-GREEN-02] unsupported syntax or style mapping fails transactionally
- **GIVEN** canonical input containing an unsupported parsed Markdown construct or a used heading/body style absent from the template
- **WHEN** greenfield compilation begins
- **THEN** it SHALL fail with a stable actionable diagnostic before writing any output
- **AND** literal legal-form text such as `Name: _____`, `A & B`, and `#not-a-heading` SHALL remain admissible while parsed `*emphasis*` and a standalone `_____` thematic break SHALL be rejected

### Requirement: Greenfield compilation preserves the admitted template package graph

The system SHALL preserve the admitted template's final section properties,
styles, numbering, theme, selected header/footer bindings, and all package
parts outside `word/document.xml`. It SHALL reject template body topology whose
preservation would require substantive noncanonical body content.

#### Scenario: [SDX-MDOC-GREEN-03] house-style and running-story scaffolding survive body replacement
- **GIVEN** an admitted template with styles, numbering, page setup, and relationship-selected headers or footers
- **WHEN** a greenfield body is compiled
- **THEN** the final section properties and selected story bindings SHALL be semantically unchanged
- **AND** every package part outside `word/document.xml` SHALL retain identical uncompressed bytes

#### Scenario: [SDX-MDOC-GREEN-04] ambiguous template topology is refused
- **GIVEN** a template with multiple sections, non-final section properties, existing revisions, or an invalid selected-story relationship graph
- **WHEN** greenfield compilation begins
- **THEN** it SHALL fail before output instead of flattening or guessing how to preserve that topology

### Requirement: Greenfield certificates bind inputs, output, and preservation evidence

The system SHALL emit a versioned verification certificate binding the exact
canonical Markdoc, template DOCX, optional style profile, and output DOCX bytes.
The certificate SHALL include body/style projection evidence, changed-part
inventory, section and selected-story preservation evidence, and confirmation
that the clean output contains no tracked revisions.

#### Scenario: [SDX-MDOC-GREEN-05] successful build is reproducible and independently auditable
- **GIVEN** identical template, canonical Markdoc, and style-profile bytes
- **WHEN** greenfield compilation runs twice
- **THEN** the DOCX outputs and certificate content SHALL be byte-identical
- **AND** the certificate SHALL identify `word/document.xml` as the only changed package part
- **AND** all input and output hashes and projection checks SHALL pass
- **AND** no selected revision story SHALL contain an element from the tracked-change element set

#### Scenario: [SDX-MDOC-GREEN-06] greenfield output never invents a reject-state redline
- **GIVEN** a presentation template whose placeholder body is not substantive source text
- **WHEN** greenfield compilation succeeds
- **THEN** it SHALL emit a clean DOCX and verification certificate
- **AND** it SHALL NOT emit or certify a tracked redline against the template body
