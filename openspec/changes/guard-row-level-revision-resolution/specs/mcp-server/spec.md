## MODIFIED Requirements

### Requirement: Accept Tracked Changes Tool
The Safe-Docx MCP server SHALL provide an `accept_changes` tool that accepts all tracked changes in the document body that the acceptance engine can resolve. v1 scope is document body only; headers, footers, footnotes, and endnotes are deferred. Revision records the engine cannot resolve SHALL be preserved rather than stripped, and SHALL be reported to the caller, so the tool never claims a clean document while leaving unresolved markup behind.

#### Scenario: accept_changes produces clean document body with no revision markup
- **GIVEN** a document containing tracked changes (insertions, deletions, formatting changes, moves) in the document body
- **WHEN** `accept_changes` is called
- **THEN** the server SHALL return a document with all resolvable tracked changes in the body accepted
- **AND** the response SHALL include acceptance stats (insertions accepted, deletions accepted, moves resolved, property changes resolved)
- **AND** tracked changes in headers, footers, footnotes, and endnotes SHALL remain unmodified in v1

#### Scenario: accepted document opens cleanly in Microsoft Word
- **GIVEN** a document with tracked changes that has been processed by `accept_changes`
- **WHEN** the resulting document is opened in Microsoft Word
- **THEN** the document SHALL open without errors or repair prompts
- **AND** no tracked changes SHALL appear in the review pane

#### Scenario: original document is not mutated
- **GIVEN** a source document with tracked changes
- **WHEN** `accept_changes` is called
- **THEN** the original source document SHALL remain unchanged
- **AND** the accepted output SHALL be written to a separate file or session working copy

#### Scenario: [SDX-ROWREV-MCP-01] accept_changes reports unresolved row revisions instead of claiming a clean document
- **GIVEN** a document whose table row carries a `w:trPr > w:del` row-level revision marker
- **WHEN** `accept_changes` is called
- **THEN** the response SHALL report `unresolvedRowRevisions` as a non-zero count
- **AND** the marker SHALL remain in the saved document rather than being stripped
- **AND** the row SHALL remain in the saved document
