## ADDED Requirements

### Requirement: Inline footnote bodies in read_file

The `read_file` tool SHALL accept an opt-in `include_footnotes` boolean (default `false`).
When true and `format` is `json`, each returned paragraph node SHALL carry a `footnotes`
array of `{id, display_number, text}` objects for the footnotes anchored to that paragraph.
The payload SHALL be windowed to the returned paragraph slice and SHALL count toward the
existing read token budget. Bootstrap scaffolding (display number 0 or empty body) and
orphaned footnotes (no anchored paragraph) SHALL be excluded from inline output;
`get_footnotes` remains the authoritative whole-document enumeration. The flag SHALL have
no effect on TOON or simple output in v1.

#### Scenario: include_footnotes attaches anchored footnote bodies to json paragraph nodes
- **GIVEN** a document whose paragraphs carry footnotes
- **WHEN** `read_file` is called with `format` `json` and `include_footnotes` true
- **THEN** each anchoring paragraph node SHALL include a `footnotes` array
- **AND** each entry SHALL carry `id`, `display_number`, and the footnote body `text`
- **AND** paragraphs without footnotes SHALL NOT carry a `footnotes` key

#### Scenario: include_footnotes defaults off and existing json output is unchanged
- **GIVEN** a document whose paragraphs carry footnotes
- **WHEN** `read_file` is called with `format` `json` and no `include_footnotes`
- **THEN** no returned node SHALL carry a `footnotes` key

#### Scenario: a paginated json walk returns each inline footnote exactly once
- **GIVEN** a document with footnotes anchored to different paragraphs
- **WHEN** the document is read as `json` with `include_footnotes` true across multiple
  `offset`/`limit` slices
- **THEN** each footnote SHALL appear only on the slice containing its anchor paragraph
- **AND** a full paginated walk SHALL surface each eligible footnote exactly once

#### Scenario: inline footnote payload counts toward the read token budget
- **GIVEN** a paragraph whose anchored footnote body alone exceeds the default read budget
- **WHEN** `read_file` is called with `format` `json`, `include_footnotes` true, and no
  explicit pagination
- **THEN** the footnote payload SHALL count toward the budget like any other node content
- **AND** the response SHALL truncate the slice and signal pagination exactly as today

#### Scenario: scaffolding and orphaned footnotes are excluded from inline output
- **GIVEN** a footnotes part containing a referenced footnote with an empty body and a
  footnote no paragraph references
- **WHEN** `read_file` is called with `format` `json` and `include_footnotes` true
- **THEN** neither footnote SHALL appear in any node's `footnotes` array
- **AND** `get_footnotes` SHALL still return both

#### Scenario: include_footnotes has no effect on toon and simple output
- **GIVEN** a document whose paragraphs carry footnotes
- **WHEN** `read_file` is called with `include_footnotes` true and `format` `toon` or `simple`
- **THEN** the rendered content SHALL be identical to the same read without the flag

#### Scenario: footnote markers stay single-rendered when bodies are inlined
- **GIVEN** a real-document paragraph containing inline footnote references
- **WHEN** `read_file` renders it as `json` with `include_footnotes` true
- **THEN** each `[^N]` marker derived from `footnote_refs` SHALL appear exactly once in
  `text` and exactly once in `clean_text`

#### Scenario: the NVCA fixture round-trips all anchored footnotes inline
- **GIVEN** the NVCA SPA regression fixture with over one hundred anchored footnotes
- **WHEN** the document is fully walked as `json` with `include_footnotes` true
- **THEN** the union of inline `footnotes` entries SHALL equal the eligible set reported by
  `get_footnotes`, each appearing exactly once
