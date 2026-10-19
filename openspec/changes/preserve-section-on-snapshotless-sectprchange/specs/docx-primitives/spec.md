## ADDED Requirements

### Requirement: Resolving a Snapshot-less Section Property Change Keeps the Live Section

When a `w:sectPrChange` has no `w:sectPr` snapshot child, the acceptance and rejection engines SHALL resolve it by removing only the `w:sectPrChange` element. The live `w:sectPr` SHALL keep its page setup, `w:titlePg` and header/footer references, and a paragraph-owned `w:sectPr` SHALL remain a section break. No references SHALL be carried to the following section. A section break SHALL be removed only when its paragraph mark is itself a revision that the operation removes; its references then carry forward as for any removed section boundary. Native `acceptChanges`/`rejectChanges` and docx-compare's `acceptAllChanges`/`rejectAllChanges` SHALL apply the same rule, matching Word's Accept All and Reject All.

#### Scenario: rejecting a snapshot-less paragraph section change keeps the section break

- **GIVEN** a paragraph-owned landscape `w:sectPr` with `w:titlePg`, with or without header and footer references, whose `w:sectPrChange` has no snapshot, followed by a body-level `w:sectPr`
- **WHEN** all changes are rejected
- **THEN** both sections remain
- **AND** the paragraph section keeps its page setup, `w:titlePg` and references
- **AND** the body section's references are unchanged

#### Scenario: rejecting a snapshot-less body section change keeps the final section

- **GIVEN** a body-level landscape `w:sectPr` with `w:titlePg`, with or without references, whose `w:sectPrChange` has no snapshot
- **WHEN** all changes are rejected
- **THEN** the body section keeps its page setup, `w:titlePg` and references

#### Scenario: accepting a snapshot-less section change keeps the live section

- **GIVEN** a paragraph-owned or body-level `w:sectPr` whose `w:sectPrChange` has no snapshot
- **WHEN** all changes are accepted
- **THEN** only the record is removed

#### Scenario: a snapshot-less section change on a removed break still carries its references

- **GIVEN** a paragraph-owned `w:sectPr` with references and a snapshot-less `w:sectPrChange`, whose paragraph mark is inserted or deleted
- **WHEN** rejecting the inserted mark, or accepting the deleted mark
- **THEN** the break is removed and the following section receives its references
- **AND** accepting the inserted mark, or rejecting the deleted mark, keeps the break with its page setup and references
