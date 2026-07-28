## ADDED Requirements

### Requirement: Anchored Main-Document Section Break Insertion

The DOCX primitive SHALL insert exactly one dedicated section-boundary paragraph
after a uniquely resolved direct `w:body/w:p` anchor. The boundary SHALL contain
a live `w:sectPr` cloned from the containing section, SHALL use the requested
section break type, and SHALL preserve all existing header/footer relationship
references.

#### Scenario: Insert a boundary inside the final section

- **GIVEN** a body paragraph inside a section terminated by a final body `w:sectPr`
- **WHEN** a `nextPage` section break is inserted after that paragraph
- **THEN** one dedicated boundary paragraph SHALL be inserted after the anchor
- **AND** the document SHALL expose one additional ordered section
- **AND** the new boundary SHALL preserve the containing section's page setup and relationship references

#### Scenario: Reject unsupported or stale anchors atomically

- **WHEN** the anchor is missing, ambiguous, nested outside the direct body, or already ends a section
- **THEN** the primitive SHALL return a typed error
- **AND** the document SHALL remain unchanged

### Requirement: Following Section Initialization

The primitive SHALL allow the following section to retain its existing
properties or reset its non-relationship properties before applying an optional
atomic page-number/page-setup override. Header/footer relationship references
SHALL remain live and unchanged in either mode.

#### Scenario: Inherit and override the following section

- **WHEN** insertion requests inherited properties and a page-number restart
- **THEN** the following section SHALL preserve untargeted properties and references
- **AND** it SHALL contain the requested restart

#### Scenario: Reset non-relationship properties

- **WHEN** insertion disables property inheritance
- **THEN** the following section SHALL retain direct header/footer references
- **AND** untargeted page and layout properties SHALL be removed
- **AND** requested explicit overrides SHALL be applied

### Requirement: Section Break Insertion Is Reviewable

When revision attribution is supplied, the inserted boundary SHALL be recorded
as an inserted paragraph mark. Any following-section property change SHALL be
recorded as one `w:sectPrChange`.

#### Scenario: Accept and reject restore topology

- **GIVEN** a tracked section-break insertion with following-section overrides
- **WHEN** tracked changes are accepted
- **THEN** the additional section and overrides SHALL remain without revision markup
- **WHEN** tracked changes are rejected
- **THEN** the original section count and original following-section properties SHALL be restored

