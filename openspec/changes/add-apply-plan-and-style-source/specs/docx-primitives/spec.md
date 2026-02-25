## MODIFIED Requirements

### Requirement: Paragraph Insertion with Style Source Decoupling
The `insertParagraph` primitive SHALL accept an optional `styleSourceId` parameter. When provided, paragraph properties and template run formatting are cloned from the style source paragraph instead of the positional anchor.

#### Scenario: styleSourceId clones pPr from specified paragraph
- **GIVEN** a document with anchor paragraph (heading style) and style source paragraph (body style)
- **WHEN** `insertParagraph` is called with `positionalAnchorNodeId` set to the heading and `styleSourceId` set to the body paragraph
- **THEN** the new paragraph's `w:pPr` SHALL be cloned from the style source paragraph
- **AND** the new paragraph SHALL be positioned relative to the anchor paragraph

#### Scenario: styleSourceId selects template run from style source
- **GIVEN** a style source paragraph with runs containing specific run properties
- **WHEN** `insertParagraph` is called with that `styleSourceId`
- **THEN** the template run for the new paragraph's text SHALL be selected from the style source paragraph (longest visible run)
- **AND** the new run SHALL use `cloneRunFormattingOnly` from the style source's template run

#### Scenario: styleSourceId not found falls back to anchor
- **GIVEN** a `styleSourceId` that does not match any paragraph's bookmark ID in the document
- **WHEN** `insertParagraph` is called with that `styleSourceId`
- **THEN** the primitive SHALL fall back to cloning pPr and template run from the positional anchor
- **AND** SHALL include a `styleSourceFallback: true` flag in the return value

#### Scenario: styleSourceId omitted preserves existing behavior
- **WHEN** `insertParagraph` is called without `styleSourceId`
- **THEN** the primitive SHALL clone pPr and template run from the positional anchor
- **AND** behavior SHALL be identical to the pre-change implementation
