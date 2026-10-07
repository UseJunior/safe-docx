## ADDED Requirements

### Requirement: Section-Break Inserts and Deletes Are Paragraph-Mark Revisions

When an aligned paragraph gains or loses its paragraph-owned `w:sectPr`, the comparison SHALL record the change on paragraph marks rather than as a `w:sectPrChange`. The content paragraph SHALL carry the revised properties and an inserted paragraph mark, and SHALL carry the revised full `w:sectPr` when the break was added. An empty boundary paragraph immediately after it SHALL carry the original base properties and a deleted paragraph mark, and SHALL carry the original full `w:sectPr`, including its header/footer references, when the break was removed. Accept All SHALL reproduce the revised document's sections and Reject All the original's, on both the docx-core and docx-compare appliers. A page-setup change to a section present on both sides SHALL still be recorded as `w:sectPrChange`.

#### Scenario: rejecting a removed section break restores its header and footer bindings

- **GIVEN** an original whose first paragraph ends a section bound to its own header and footer, and a revised document without that break
- **WHEN** the documents are compared and all changes are rejected
- **THEN** the rejected document has the original section count
- **AND** the restored section is bound to the original header and footer

#### Scenario: rejecting an added section break leaves the original section count

- **GIVEN** a revised document that adds a section break, with default or non-default properties, to an existing paragraph
- **WHEN** the documents are compared and all changes are rejected
- **THEN** no paragraph-owned `w:sectPr` remains
- **AND** accepting all changes instead keeps the added break

#### Scenario: a page-setup change to an existing section keeps w:sectPrChange

- **GIVEN** a paragraph-owned section present on both sides whose page size changes
- **WHEN** the documents are compared
- **THEN** one `w:sectPrChange` records the prior page setup and no boundary paragraph is added
