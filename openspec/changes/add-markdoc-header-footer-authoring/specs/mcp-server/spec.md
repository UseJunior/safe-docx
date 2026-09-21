## MODIFIED Requirements

### Requirement: Accept Tracked Changes Tool

The Safe-Docx MCP server SHALL provide an `accept_changes` tool that accepts
every tracked change the acceptance engine can resolve across the document body,
supported revisionable side stories (`footnotes.xml`, `endnotes.xml`,
`comments.xml`, `glossary/document.xml`), and every relationship-selected
header/footer story. Row-level markers (`w:trPr > w:ins|w:del`) SHALL resolve
semantically: accepting an inserted row keeps it, and accepting a deleted row
removes it. Records the engine cannot resolve SHALL remain preserved and
reported rather than stripped. Unselected orphan header/footer parts SHALL not
be swept by filename.

#### Scenario: [SDX-MCP-STORY-01] accept_changes resolves a selected header revision
- **GIVEN** a document with a supported tracked replacement in a relationship-selected header
- **WHEN** `accept_changes` is called
- **THEN** the selected header SHALL contain only its accepted text
- **AND** its tracked insertion and deletion markup SHALL be absent
- **AND** acceptance counters SHALL include the resolved header records
- **AND** an unselected orphan header/footer part SHALL remain unchanged

#### Scenario: [SDX-ROWREV-MCP-01] accept_changes resolves a deleted table row
- **GIVEN** a document whose table row carries a `w:trPr > w:del` marker and deleted cell content
- **WHEN** `accept_changes` is called
- **THEN** the row SHALL be absent from the saved document
- **AND** the response SHALL report `unresolvedRowRevisions` as `0`
- **AND** `deletionsAccepted` SHALL count the row marker once and SHALL NOT separately count removed inner records
