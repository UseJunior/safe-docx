## ADDED Requirements

### Requirement: Extended ODF Tool Support (`grep`, `insert_paragraph`)

The MCP server SHALL service `grep` and `insert_paragraph` for ODF sessions via the
provider-aware `.odt` lane, in addition to the Phase-1 tools (`read_file`, `replace_text`,
`save`, `get_file_status`, `close_file`). Both SHALL route to the ODF handler when the
`file_path` ends in `.odt` (or resolves to an existing `OdfSession`); the DOCX and Google
Docs paths SHALL remain unchanged, and every still-unsupported tool SHALL continue to return
`UNSUPPORTED_FOR_ODF`.

ODF `grep` SHALL operate in single-file session mode (a `.odt` `file_path`); multi-file
`file_paths` search remains a DOCX-lane capability. ODF paragraphs carry no list-label /
header context, so those fields SHALL be empty strings.

ODF `insert_paragraph` SHALL insert one or more `text:p` blocks before or after the anchor
paragraph (blank lines splitting `new_string` into separate paragraphs; single newlines
mapping to `text:line-break`), inheriting the anchor's paragraph style only when the anchor
is a body paragraph (never propagating a heading style). Because ODF paragraph IDs are
positional ordinals, the response SHALL return the inserted blocks' freshly recomputed IDs
and SHALL carry machine-actionable invalidation signals
(`invalidates_paragraph_ids_after`, `requires_reread_before_next_edit`) so the agent
re-reads before its next edit.

#### Scenario: [OPLR-06] `grep` searches an ODF session
- **WHEN** `grep` is invoked with a `.odt` `file_path` and a pattern
- **THEN** the ODF handler returns matches with paragraph IDs, 1-based indices, and context, and the DOCX/gdocs handlers are not invoked

#### Scenario: [OPLR-07] `insert_paragraph` inserts into an ODF session
- **WHEN** `insert_paragraph` is invoked with a `.odt` `file_path`, an anchor paragraph ID, and `new_string`
- **THEN** a new paragraph is inserted before/after the anchor, the response returns the new positional paragraph ID(s) and ID-invalidation fields, and re-reading reflects the inserted text

#### Scenario: [OPLR-08] Still-unsupported tools remain guarded
- **WHEN** a tool outside the ODF supported set (e.g. `compare_documents`) is invoked against a `.odt` path or ODF session
- **THEN** an `UNSUPPORTED_FOR_ODF` error is returned and no DOCX logic runs
