## MODIFIED Requirements

### Requirement: Accept Tracked Changes Tool

The Safe-Docx MCP server SHALL provide an `accept_changes` tool that accepts
every tracked change the acceptance engine can resolve across the document body
and supported revisionable side stories (`footnotes.xml`, `endnotes.xml`,
`comments.xml`, `glossary/document.xml`); headers and footers remain deferred.
Row-level markers (`w:trPr > w:ins|w:del`) SHALL resolve semantically: accepting
an inserted row keeps it, and accepting a deleted row removes it. Records the
engine cannot resolve SHALL remain preserved and reported rather than stripped.

#### Scenario: accept_changes produces clean document body with no revision markup
- **GIVEN** a document whose tracked changes (insertions, deletions, formatting changes, moves) are all of resolvable kinds
- **WHEN** `accept_changes` is called
- **THEN** the server SHALL return a document with those tracked changes accepted and no revision markup remaining
- **AND** the response SHALL include acceptance stats (insertions accepted, deletions accepted, moves resolved, property changes resolved)
- **AND** `unresolvedRowRevisions` SHALL be `0`
- **AND** tracked changes in headers and footers SHALL remain unmodified

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
