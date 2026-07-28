## ADDED Requirements

### Requirement: Atomic Section Page Setup Mutation
The DOCX primitives library SHALL atomically apply a non-empty partial page
setup mutation to one indexed main-document section.

#### Scenario: Existing page size receives a partial update
- **GIVEN** a section with `w:pgSz` width, height, orientation, and paper code
- **WHEN** a subset of width, height, or orientation is changed
- **THEN** only the requested attributes SHALL change
- **AND** the paper code and unspecified page-size attributes SHALL remain
  unchanged

#### Scenario: Missing page size is created with explicit dimensions
- **GIVEN** a section without `w:pgSz`
- **WHEN** positive width and height plus an optional orientation are requested
- **THEN** one `w:pgSz` SHALL be inserted in its `CT_SectPr` schema slot
- **AND** a request lacking either dimension SHALL fail before mutation

#### Scenario: Existing margins receive a partial update
- **GIVEN** a section with a complete `w:pgMar`
- **WHEN** one or more margins are changed
- **THEN** only the requested margin attributes SHALL change
- **AND** unspecified margins SHALL remain unchanged

#### Scenario: Missing margins require the complete attribute set
- **GIVEN** a section without `w:pgMar`
- **WHEN** all seven required margins are requested
- **THEN** one complete `w:pgMar` SHALL be inserted in its `CT_SectPr` schema
  slot
- **AND** an incomplete margin request SHALL fail before mutation

#### Scenario: Page setup values follow their OOXML domains
- **WHEN** a page-setup mutation is validated
- **THEN** page dimensions SHALL be positive safe integers
- **AND** top and bottom margins SHALL be signed safe integers
- **AND** other margins SHALL be non-negative safe integers
- **AND** orientation SHALL be `portrait` or `landscape`

#### Scenario: Mixed page setup changes are atomic
- **GIVEN** a request changing page numbering, page size, and margins together
- **WHEN** the mutation succeeds with a revision context
- **THEN** all requested values SHALL be applied
- **AND** exactly one `w:sectPrChange` SHALL snapshot the section state before
  the request

#### Scenario: Identical page setup is a deterministic no-op
- **GIVEN** every requested page-setup value already matches the section
- **WHEN** the mutation is applied
- **THEN** it SHALL report `changed: false`
- **AND** serialized XML and revision allocation SHALL remain unchanged

### Requirement: Section Page Setup Preservation And Review
An effective page-setup mutation SHALL preserve untargeted section semantics and
remain reversible through native section-property revisions.

#### Scenario: Untargeted section properties survive page setup editing
- **GIVEN** a section with page-number format, break type, columns, page
  borders, and header/footer references
- **WHEN** its page setup changes
- **THEN** those untargeted settings and relationships SHALL remain unchanged
- **AND** section count, paragraph count, anchors, and visible text SHALL remain
  unchanged

#### Scenario: Accept and reject preserve page setup semantics
- **GIVEN** page setup changes recorded by one `w:sectPrChange`
- **WHEN** the revision is accepted or rejected
- **THEN** acceptance SHALL keep every requested current value
- **AND** rejection SHALL restore the complete prior page setup and unrelated
  properties
