## ADDED Requirements

### Requirement: Markdown serialization primitive

The docx-core primitives SHALL provide a serializer that converts a structured document view
(`DocumentViewNode[]` with inline formatting tags) and its footnotes into GitHub-Flavored
Markdown. The serialization is intentionally lossy: constructs without a Markdown equivalent
are downgraded as specified below rather than preserved for round-tripping. The inline-tag
tokenizer is the reusable core shared with future serializers (HTML, text).

#### Scenario: word-style headings become ATX headings
- **GIVEN** a node whose heading source is `word_style` with a numeric level N (1–6)
- **WHEN** the document is serialized to Markdown
- **THEN** the paragraph SHALL render as an ATX heading with N leading `#` characters

#### Scenario: heuristic headings remain paragraphs
- **GIVEN** a node with a heuristic heading (level null, e.g. a run-in bold prefix)
- **WHEN** the document is serialized to Markdown
- **THEN** the node SHALL render as a normal paragraph, not an ATX heading

#### Scenario: inline bold italic and link tags map to Markdown
- **GIVEN** tagged text containing `<b>`, `<i>`, and `<a href="...">` tags
- **WHEN** the text is converted with the inline tokenizer
- **THEN** `<b>` SHALL map to `**`, `<i>` to `*`, and `<a href="u">t</a>` to `[t](u)`

#### Scenario: underline passes through as raw HTML and font and highlight tags are stripped
- **GIVEN** tagged text containing `<u>`, `<font ...>`, and `<highlight>` tags
- **WHEN** the text is converted with the inline tokenizer
- **THEN** `<u>` SHALL be emitted verbatim as raw HTML
- **AND** `<font ...>` and `<highlight>` tags SHALL be removed while their inner text is kept

#### Scenario: nested ordered and bullet lists are indented by level
- **GIVEN** list nodes at increasing `list_level` values
- **WHEN** the document is serialized to Markdown
- **THEN** each item SHALL be indented in proportion to its level
- **AND** auto-numbered numeric items SHALL render as `1.` ordered items and unlabeled items as `-` bullets

#### Scenario: legal list labels are preserved
- **GIVEN** a list item carrying a literal label such as `Section 2.1`, `Article IV`, or `(a)`
- **WHEN** the document is serialized to Markdown
- **THEN** the literal label SHALL appear in the rendered item rather than being replaced by a bare `1.`

#### Scenario: a table renders as a GFM table
- **GIVEN** nodes sharing a `table_context.table_id` forming rows and columns
- **WHEN** the document is serialized to Markdown
- **THEN** they SHALL render as a GFM pipe table with a header separator row

#### Scenario: merged cell gaps are filled to preserve the grid
- **GIVEN** a table whose `col_index` values skip positions because of horizontally merged cells
- **WHEN** the document is serialized to Markdown
- **THEN** the missing grid positions SHALL be filled with empty cells so every row has the full column count

#### Scenario: footnote definitions are appended
- **GIVEN** a document with footnotes
- **WHEN** the document is serialized to Markdown
- **THEN** `[^n]: ...` definitions SHALL be appended, ordered by display number

#### Scenario: footnote markers are preserved when escaping text
- **GIVEN** text containing an injected `[^1]` footnote marker
- **WHEN** the text is escaped for Markdown
- **THEN** the `[^1]` marker SHALL remain intact and match its appended definition

#### Scenario: Markdown-significant characters in text are escaped
- **GIVEN** literal text containing characters such as `*`, `_`, `[`, or a leading `#`
- **WHEN** the text is serialized to Markdown
- **THEN** those characters SHALL be backslash-escaped so they render literally
