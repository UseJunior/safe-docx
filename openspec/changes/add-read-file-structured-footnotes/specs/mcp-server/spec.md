## ADDED Requirements

### Requirement: Single-Call Body and Footnotes Retrieval in read_file

When `read_file` is called with `include_footnotes=true`, the server SHALL
return the full-fidelity footnote bodies alongside the body content in the same
call, without requiring a separate `get_footnotes` call and manual stitching.
For `format="json"`, the response SHALL include a document-wide TOP-LEVEL
`footnotes` array; each entry SHALL contain `id`, `display_number`,
`ref_paragraph_ids` (an ARRAY of the paragraph ids that reference the footnote),
and `paragraphs` (each with `text`, a run-formatting-preserving `tagged_text`,
and `style`). This top-level array SHALL NOT be inlined into `content[]`, so the
1:1 `content[]` index invariant is preserved. For backward compatibility the
server MAY also attach a lightweight per-node `footnotes` array
(`{id, display_number, text}`) to each anchoring paragraph node. For
`format="toon"`, the server SHALL append a trailing `#FOOTNOTES` sidecar block
symmetric with the `#COMMENTS` block. Footnotes with an empty body or
`display_number` 0 SHALL be excluded. When `include_footnotes` is absent or
false, output SHALL be byte-identical to output produced without the parameter.
A footnote part that fails to load SHALL degrade to a `footnote_load_error`
metadata field and SHALL NOT fail the read. The parameter SHALL be a no-op for
Google Docs and ODT sessions.

#### Scenario: JSON top-level footnotes array

- **WHEN** `read_file` is called with `format="json"` and `include_footnotes=true`
- **THEN** the response SHALL contain a top-level `footnotes` array
- **AND** each entry SHALL carry `id`, `display_number`, `ref_paragraph_ids` (array), and `paragraphs`
- **AND** the top-level `footnotes` SHALL NOT appear inside any `content[]` node

#### Scenario: multi-paragraph footnote body reported with node-level fidelity

- **GIVEN** a footnote whose body spans multiple paragraphs with bold/italic runs
- **WHEN** `read_file` is called with `format="json"` and `include_footnotes=true`
- **THEN** the footnote's `paragraphs` SHALL contain one entry per paragraph
- **AND** each entry's `tagged_text` SHALL preserve the run-level formatting tags

#### Scenario: toon FOOTNOTES sidecar

- **WHEN** `read_file` is called with `format="toon"` and `include_footnotes=true`
- **THEN** the output SHALL end with a `#FOOTNOTES` block listing each footnote

#### Scenario: default output is byte-identical

- **WHEN** `read_file` is called without `include_footnotes` and again with `include_footnotes=false`
- **THEN** both outputs SHALL be byte-identical to the output produced before the parameter existed
- **AND** no top-level `footnotes` field SHALL be present

#### Scenario: scale document enumerates every footnote

- **GIVEN** a document with over 100 footnotes
- **WHEN** `read_file` is called with `format="json"` and `include_footnotes=true`
- **THEN** the read SHALL exit cleanly with every renderable footnote represented in the top-level `footnotes` array
