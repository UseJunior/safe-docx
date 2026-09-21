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

#### Scenario: accept_changes produces clean document body with no revision markup
- **GIVEN** a document whose tracked changes (insertions, deletions, formatting changes, moves) are all of resolvable kinds
- **WHEN** `accept_changes` is called
- **THEN** the server SHALL return a document with those tracked changes accepted and no revision markup remaining
- **AND** the response SHALL include acceptance stats (insertions accepted, deletions accepted, moves resolved, property changes resolved)
- **AND** `unresolvedRowRevisions` SHALL be `0`
- **AND** supported tracked changes in relationship-selected headers and footers SHALL be accepted

#### Scenario: accepted document opens cleanly in Microsoft Word
- **GIVEN** a document whose tracked changes are all of resolvable kinds, processed by `accept_changes`
- **WHEN** the resulting document is opened in Microsoft Word
- **THEN** the document SHALL open without errors or repair prompts
- **AND** no tracked changes SHALL appear in the review pane

#### Scenario: original document is not mutated
- **GIVEN** a source document with tracked changes
- **WHEN** `accept_changes` is called
- **THEN** the original source document SHALL remain unchanged
- **AND** the accepted output SHALL be written to a separate file or session working copy

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

#### Scenario: [SDX-ROWREV-MCP-02] accepted output has no row marker and remains structurally valid
- **GIVEN** a document processed by `accept_changes` whose input carried row-level markers
- **WHEN** the output is inspected
- **THEN** no `w:trPr > w:ins|w:del` marker SHALL remain
- **AND** every remaining table cell SHALL end in a direct `w:p`
- **AND** the output SHALL remain well-formed
