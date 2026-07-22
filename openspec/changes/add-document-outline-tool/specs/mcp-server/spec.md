## ADDED Requirements

### Requirement: Document Outline Tool
The Safe-Docx MCP server SHALL provide a read-only `get_document_outline` tool that returns a compact structural map of a document's headings, each carrying the stable paragraph id so an agent can follow up with a targeted read or edit. The tool SHALL operate on DOCX sessions.

#### Scenario: word-style headings are projected with level and paragraph id
- **WHEN** `get_document_outline` is called on a document containing Word `HeadingN`-styled paragraphs
- **THEN** the response SHALL include an `outline` array with one entry per heading paragraph
- **AND** each entry SHALL include the heading `text`, the outline `level`, the heading `source`, and the stable `paragraph_id`

#### Scenario: heuristic headings are excluded by default and included on opt-in
- **WHEN** `get_document_outline` is called on a document whose only headings are heuristic (manual title / run-in / centered-caps, not Word styles)
- **THEN** the default response SHALL omit those headings from `outline`
- **AND** WHEN the same call sets `include_heuristic_headings=true` the response SHALL include those headings with their heuristic `source`

#### Scenario: markdown format renders an indented outline
- **WHEN** `get_document_outline` is called with `format="markdown"`
- **THEN** the response SHALL return a `content` string rendering the headings as an indented Markdown outline
- **AND** the depth of each heading SHALL reflect its outline level
