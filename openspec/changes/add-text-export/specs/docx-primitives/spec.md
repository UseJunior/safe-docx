## ADDED Requirements

### Requirement: Plain text serialization primitive

The docx-core primitives SHALL provide a serializer that converts a structured document view
(`DocumentViewNode[]` with inline formatting tags) and its footnotes into plain text with no
markup. The serialization is intentionally lossy: all inline and semantic formatting is
stripped, and only block structure survives as whitespace separators.

#### Scenario: all inline and semantic tags are stripped
- **GIVEN** tagged text containing `<b>`, `<i>`, `<u>`, `<a href="...">`, `<highlight>`, `<font ...>`, and heading marker tags
- **WHEN** the document is serialized to plain text
- **THEN** every such tag SHALL be removed while its inner text is kept

#### Scenario: paragraphs are separated by a blank line
- **GIVEN** consecutive paragraph nodes
- **WHEN** the document is serialized to plain text
- **THEN** each paragraph's visible text SHALL appear with a blank line separating adjacent blocks

#### Scenario: headings render as plain paragraphs
- **GIVEN** a node whose heading source is `word_style` with a numeric level
- **WHEN** the document is serialized to plain text
- **THEN** it SHALL render as its plain text with no heading markup (no `#`)

#### Scenario: list items render as simple bullets indented by level
- **GIVEN** list nodes at increasing `list_level` values with no literal label
- **WHEN** the document is serialized to plain text
- **THEN** each item SHALL render as a `- ` bullet indented in proportion to its level

#### Scenario: literal list labels are preserved
- **GIVEN** a list item carrying a literal label such as `Section 2.1`, `Article IV`, or `(a)`
- **WHEN** the document is serialized to plain text
- **THEN** the literal label SHALL appear in the rendered bullet

#### Scenario: a table renders as tab-separated rows
- **GIVEN** nodes sharing a `table_context.table_id` forming rows and columns
- **WHEN** the document is serialized to plain text
- **THEN** each row SHALL render on its own line with cells separated by tab characters

#### Scenario: merged cell gaps are filled to keep the column count
- **GIVEN** a table whose `col_index` values skip positions because of horizontally merged cells
- **WHEN** the document is serialized to plain text
- **THEN** the missing grid positions SHALL render as empty tab-delimited fields so every row has the full column count

#### Scenario: intra-cell newlines collapse to a space
- **GIVEN** a table cell whose text contains a line break
- **WHEN** the document is serialized to plain text
- **THEN** the line break SHALL be collapsed to a space rather than splitting the tab-delimited row

#### Scenario: footnote markers are preserved and definitions appended
- **GIVEN** a document with footnotes whose `[^n]` markers are injected into the text
- **WHEN** the document is serialized to plain text
- **THEN** the inline `[^n]` markers SHALL be preserved
- **AND** `[^n] ...` definitions SHALL be appended at the end, ordered by display number
