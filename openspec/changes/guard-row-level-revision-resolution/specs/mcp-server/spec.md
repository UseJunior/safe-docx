## MODIFIED Requirements

### Requirement: Accept Tracked Changes Tool
The Safe-Docx MCP server SHALL provide an `accept_changes` tool that accepts every tracked change the acceptance engine can resolve, across the document body and the revisionable side stories it supports (`footnotes.xml`, `endnotes.xml`, `comments.xml`, `glossary/document.xml`); headers and footers remain deferred. Revision records the engine cannot resolve SHALL be preserved rather than stripped, and SHALL be reported to the caller, so the tool never claims a clean document while leaving unresolved markup behind.

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

#### Scenario: [SDX-ROWREV-MCP-01] accept_changes reports unresolved row revisions instead of claiming a clean document
- **GIVEN** a document whose table row carries a `w:trPr > w:del` row-level revision marker
- **WHEN** `accept_changes` is called
- **THEN** the response SHALL report `unresolvedRowRevisions` as a non-zero count
- **AND** the marker SHALL remain in the saved document rather than being stripped
- **AND** the row SHALL remain in the saved document

#### Scenario: [SDX-ROWREV-MCP-02] a document holding unresolved row revisions stays structurally valid
- **GIVEN** a document processed by `accept_changes` that still holds a preserved row-level revision marker
- **WHEN** the output is inspected
- **THEN** the preserved marker SHALL remain a child of `w:trPr`, the only position the schema admits
- **AND** the output SHALL remain well-formed
- **AND** this scenario SHALL NOT be read as evidence about Microsoft Word's review pane, which is covered separately and only by resolvable input
