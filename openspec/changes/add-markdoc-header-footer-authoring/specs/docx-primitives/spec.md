## ADDED Requirements

### Requirement: Package revision projection includes selected header and footer stories

The accept and reject engines SHALL relationship-walk the section bindings and
project every distinct selected physical header/footer story exactly once.
Counters SHALL aggregate with body and supported side-story counters. Header or
footer parts not selected by a section relationship SHALL remain untouched.

#### Scenario: [SDX-PRIM-STORY-01] Selected header revisions project package-wide
- **GIVEN** multiple section selectors resolve to one physical header containing supported tracked insertions and deletions
- **AND** the package also contains an unselected orphan header part
- **WHEN** package accept-all or reject-all is applied
- **THEN** the selected physical header SHALL be projected exactly once
- **AND** accept-all SHALL recover its accepted text and aggregate accept counters
- **AND** reject-all SHALL recover its rejected text and aggregate `insertionsRemoved` and `deletionsRestored`
- **AND** the orphan header part SHALL remain byte-for-byte unchanged

### Requirement: Paragraph primitives address relationship-selected stories

The paragraph mutation facade SHALL bookmark, look up, replace text in, insert
beside, and delete paragraphs in an existing relationship-selected header or
footer when addressed by canonical OPC part path plus story-local anchor. The
facade SHALL reserve bookmark names and numeric IDs across the body and all
selected stories, SHALL evaluate table-cell safety against the owning story
DOM, and SHALL reject unselected parts, cross-story anchors or style sources,
vertical-merge continuation cells, and deletions that would remove the final
direct table-cell paragraph.

#### Scenario: [SDX-PRIM-STORY-02] Story paragraph mutations stay local and table-safe
- **GIVEN** a package with body paragraphs, selected shared header/footer stories, table-cell paragraphs, and an unselected orphan story
- **WHEN** callers allocate paragraph bookmarks and apply ordinary story-scoped paragraph mutations
- **THEN** bookmark names and numeric IDs SHALL be unique package-wide
- **AND** each anchor SHALL resolve only inside the addressed selected story
- **AND** successful mutations SHALL change only the addressed physical story part
- **AND** table-cell insertion and deletion SHALL preserve a final direct paragraph
- **AND** unsafe table-cell operations and orphan-story addressing SHALL fail before mutation
