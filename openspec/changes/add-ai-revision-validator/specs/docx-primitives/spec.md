## ADDED Requirements

### Requirement: AI-Emitted Revision Validation
The docx-primitives library SHALL validate AI-emitted WordprocessingML revision markup against the supported tracked-change vocabulary, including revision attributes, range pairing, field structure, and deletion text placement.

#### Scenario: session-owned malformed revision is reported as an error
- **GIVEN** a validation scope whose `sessionStartId` is `10`
- **AND** a revision element `<w:ins w:id="10">` missing required AI-emission metadata
- **WHEN** revision validation issues are partitioned by severity
- **THEN** the malformed session-owned revision SHALL be reported as an error

#### Scenario: pre-existing malformed revision remains a warning
- **GIVEN** a validation scope whose `sessionStartId` is `10`
- **AND** a malformed revision element with `w:id="9"`
- **WHEN** revision validation issues are partitioned by severity
- **THEN** the malformed pre-existing revision SHALL be reported as a warning

#### Scenario: marker family rules are vocabulary-complete
- **WHEN** the validator scans revision-bearing WordprocessingML elements
- **THEN** it SHALL recognize insertion, deletion, move, property-change, cell-change, table-grid-change, numbering-change, and customXml revision marker elements
- **AND** range-end marker elements SHALL be paired by `w:id` rather than rejected for lacking author/date metadata

#### Scenario: every revision element family has positive and negative validation coverage
- **WHEN** a schema-valid fixture for each revision element family is validated
- **THEN** the validator SHALL report no issues
- **AND** removing a required attribute from each family's fixture SHALL report a missing-attribute issue

#### Scenario: pre-existing non-revision marker defects are never attributed to the session
- **GIVEN** a comment or permission range marker whose numeric id falls inside the session revision-id range
- **AND** the marker defect existed when the session baseline was computed
- **WHEN** revision validation issues are partitioned by severity
- **THEN** the defect SHALL remain a warning, because comment and permission marker ids are allocated outside the revision id space
