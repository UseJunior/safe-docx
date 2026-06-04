## ADDED Requirements

### Requirement: HTML serialization primitive

The docx-core primitives SHALL provide a serializer that converts a structured document view
(`DocumentViewNode[]` with inline formatting tags) and its footnotes into semantic HTML. The
serialization is the semantic tier (structural elements wrapping inline formatting), not a
pixel-faithful rendering: constructs without a clean semantic mapping are downgraded as
specified below. The inline-tag tokenizer is the reusable core shared with the Markdown
serializer, so the two never re-derive the tag grammar.

#### Scenario: word-style headings become heading elements
- **GIVEN** a node whose heading source is `word_style` with a numeric level N (1–6)
- **WHEN** the document is serialized to HTML
- **THEN** the paragraph SHALL render as an `<hN>` element with the level clamped to 1–6

#### Scenario: heuristic headings remain paragraphs
- **GIVEN** a node with a heuristic heading (level null, e.g. a run-in bold prefix)
- **WHEN** the document is serialized to HTML
- **THEN** the node SHALL render as a `<p>` element, not a heading element

#### Scenario: inline bold italic underline and link tags map to HTML
- **GIVEN** tagged text containing `<b>`, `<i>`, `<u>`, and `<a href="...">` tags
- **WHEN** the text is converted with the inline tokenizer
- **THEN** `<b>`, `<i>`, `<u>` SHALL be emitted as HTML `<b>`, `<i>`, `<u>` elements
- **AND** `<a href="u">t</a>` SHALL render as an anchor whose `href` attribute is escaped

#### Scenario: highlight maps to mark and font maps to a styled span
- **GIVEN** tagged text containing `<highlight>` and `<font color=... size=... face=...>` tags
- **WHEN** the text is converted with the inline tokenizer
- **THEN** `<highlight>` SHALL render as a `<mark>` element
- **AND** `<font ...>` SHALL render as a `<span>` whose `style` carries the color, font-size
  (in points), and font-family, with every CSS value sanitized so it cannot break out of the
  attribute

#### Scenario: consecutive list nodes group into nested lists
- **GIVEN** consecutive list nodes at varying `list_level` values
- **WHEN** the document is serialized to HTML
- **THEN** they SHALL be grouped into nested `<ul>`/`<ol>` elements whose depth reflects the
  levels, and the lists SHALL be well-formed (every opened list is closed)

#### Scenario: auto-numbered lists render as ordered lists
- **GIVEN** a list node whose `is_auto_numbered` is true
- **WHEN** the document is serialized to HTML
- **THEN** it SHALL render inside an `<ol>` element regardless of how its label classifies

#### Scenario: legal list labels are preserved
- **GIVEN** a list item carrying a literal label such as `Section 2.1`, `Article IV`, or `(a)`
- **WHEN** the document is serialized to HTML
- **THEN** the literal label SHALL appear in the rendered `<li>`

#### Scenario: a table renders as an HTML table
- **GIVEN** nodes sharing a `table_context.table_id` forming rows and columns
- **WHEN** the document is serialized to HTML
- **THEN** they SHALL render as a `<table>` with a `<thead>` header row and a `<tbody>` of data rows

#### Scenario: merged cell gaps are filled to preserve the grid
- **GIVEN** a table whose `col_index` values skip positions because of horizontally merged cells
- **WHEN** the document is serialized to HTML
- **THEN** the missing grid positions SHALL be filled with empty cells so every row has the full
  column count

#### Scenario: footnotes render as anchors and a definitions section
- **GIVEN** a document with footnotes
- **WHEN** the document is serialized to HTML
- **THEN** each injected `[^n]` marker SHALL render as a superscript anchor linking to the
  definition, and a footnotes `<section>` SHALL list the definitions, each linking back to its
  reference

#### Scenario: text special characters are HTML-escaped
- **GIVEN** literal text containing characters such as `&`, `<`, `>`, or `"`
- **WHEN** the text is serialized to HTML
- **THEN** those characters SHALL be replaced with HTML entities so they render literally

#### Scenario: a full HTML document is emitted by default
- **GIVEN** a structured document view
- **WHEN** it is serialized to HTML without the fragment option
- **THEN** the output SHALL be a complete document with a doctype, a `<head>` (charset and
  title), and a `<body>`
- **AND** with the fragment option the output SHALL contain only the body-level elements
