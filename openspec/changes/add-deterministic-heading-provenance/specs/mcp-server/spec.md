## ADDED Requirements

### Requirement: Document outline includes all deterministic heading sources by default

`get_document_outline` SHALL include `word_style`, `list_metadata`, and
`outline_level` headings without an inference opt-in. Existing heuristic
heading sources SHALL remain excluded by default and included only when
`include_heuristic_headings=true`.

#### Scenario: [HEAD-OUTLINE-01] Default outline includes mixed deterministic sources

- **GIVEN** a DOCX with headings sourced from a built-in style, active list
  metadata, and effective outline level
- **WHEN** `get_document_outline` is called with default options
- **THEN** all three headings SHALL appear in document order
- **AND** each entry SHALL expose its exact `source`, `level`, text, and stable
  paragraph id

#### Scenario: [HEAD-OUTLINE-02] Heuristic boundary remains opt-in

- **GIVEN** a DOCX containing deterministic and heuristic headings
- **WHEN** `get_document_outline` is called without
  `include_heuristic_headings`
- **THEN** only deterministic headings SHALL appear
- **AND** when `include_heuristic_headings=true`, the existing heuristic
  headings SHALL also appear with their existing source values

#### Scenario: [HEAD-OUTLINE-03] Structured levels exceed Markdown syntax safely

- **GIVEN** a deterministic Heading 7 through Heading 9
- **WHEN** JSON output is requested
- **THEN** the exact level 7 through 9 SHALL be returned
- **AND** when Markdown output is requested, rendering SHALL clamp the visual
  ATX depth to 6 without changing the underlying structured heading level

### Requirement: MCP reference documents heading provenance

Generated MCP reference material SHALL document the `HeadingValue` fields, all
deterministic and heuristic source values, first-match precedence, default
outline filtering, and the Markdown depth clamp.

#### Scenario: [HEAD-OUTLINE-04] Generated reference lists the complete taxonomy

- **WHEN** the generated MCP tool reference is rebuilt
- **THEN** it SHALL list `word_style`, `list_metadata`, `outline_level`,
  `run_in_header`, `title_with_period`, `title_with_colon`,
  `title_caps_centered`, and `title_bare`
- **AND** it SHALL distinguish default deterministic sources from opt-in
  heuristic sources
