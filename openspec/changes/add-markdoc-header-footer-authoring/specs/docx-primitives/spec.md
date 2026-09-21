## ADDED Requirements

### Requirement: Selected header and footer revisions project package-wide

The accept and reject engines SHALL resolve supported revisions in every
relationship-selected header/footer part, enumerated through the package
relationship graph rather than filename patterns. They SHALL aggregate
per-part results with the body and existing revision side stories, SHALL NOT
apply note-reference pruning rules to headers or footers, and SHALL report any
revision they cannot resolve.

#### Scenario: [SDX-PRIM-STORY-01] Header date revisions accept and reject
- **GIVEN** a selected header containing a deletion of `17` and insertion of `18`
- **WHEN** package accept and reject projections run
- **THEN** accept SHALL retain `18` and remove the resolved revision wrappers
- **AND** reject SHALL restore `17` and remove the resolved revision wrappers
- **AND** the aggregate insertion/deletion counters SHALL include the header operations

### Requirement: Paragraph mutations can target one selected story

`DocxDocument` SHALL expose story-scoped paragraph bookmark insertion, lookup,
text lookup, replacement, insertion, deletion, and table-cell validation keyed
by selected part identity. Those operations SHALL share one package-wide
bookmark name and numeric-ID reservation set with the body and other stories,
and SHALL validate physical-cell topology against the targeted story DOM.

#### Scenario: [SDX-PRIM-STORY-02] Story bookmarks are package-unique
- **GIVEN** identical neighboring paragraph text in the body and a selected header
- **WHEN** paragraph anchors are allocated for both stories
- **THEN** bookmark names and numeric IDs SHALL be unique across the package
- **AND** story-scoped lookup SHALL resolve each anchor only in its declared part

#### Scenario: [SDX-PRIM-STORY-03] Story table-cell mutation uses its own DOM
- **GIVEN** an admitted paragraph in a selected header table cell
- **WHEN** insertion or deletion is validated
- **THEN** vMerge, nested-table, cross-cell style-source, and final-direct-paragraph checks SHALL inspect that physical header cell
- **AND** body table metadata SHALL NOT determine the result
