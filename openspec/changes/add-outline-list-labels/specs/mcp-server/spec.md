## ADDED Requirements

### Requirement: Outline Entries Carry List Labels
Each `get_document_outline` entry SHALL carry the heading paragraph's list label, as the document view computes it, when the paragraph has one, including numbering the paragraph inherits from its paragraph style.

#### Scenario: numbered headings carry their list label
- **GIVEN** a document whose Heading 1 / Heading 2 styles are linked to an "ARTICLE %1" level and a legal "Section %1.%2" level
- **WHEN** `get_document_outline` is called
- **THEN** each heading entry SHALL include `list_label` with the number Word displays ("ARTICLE I", "Section 1.01", "Section 1.02", "ARTICLE II", "Section 2.01")
- **AND** the Markdown format SHALL prefix each heading with its label

#### Scenario: unnumbered headings omit the list label
- **GIVEN** a document whose headings carry no list numbering
- **WHEN** `get_document_outline` is called
- **THEN** its entries SHALL NOT include a `list_label` field
