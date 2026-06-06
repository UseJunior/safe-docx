## ADDED Requirements

### Requirement: Provider-Aware Local Resolution for `.odt`

The MCP server SHALL treat `.odt` as a first-class local provider via a parallel
resolver lane, leaving the DOCX and Google Docs resolution paths unchanged. An
`OdfSession` SHALL be a member of the session union. A `.odt` `file_path` SHALL
auto-open an ODF session on first use (parity with `.docx`), and a `.odt` `file_path`
that resolves to an existing `OdfSession` SHALL reuse it. (Provider dispatch keys on
the `.odt` file extension for race-free, synchronous routing; reusing an open ODF
session via an aliased path whose spelling does not end in `.odt` is a Phase-2
refinement.) The `read_file`,
`replace_text`, `save`, `get_file_status`, and `close_file` tools SHALL service ODF
sessions; every other tool invoked against an ODF session (or a `.odt` `file_path`)
SHALL return an `UNSUPPORTED_FOR_ODF` error rather than running DOCX logic — enforced
by a provider-check chokepoint in the shared session resolver so unsupported tools
never reach DOCX-only fields. Genuinely unsupported extensions SHALL still return
`INVALID_FILE_TYPE`.

#### Scenario: [OPLR-01] Open a local `.odt`
- **WHEN** `open_document` (or any auto-opening tool) is called with a `.odt` path
- **THEN** an ODF session is created and a paragraph count / read result is returned

#### Scenario: [OPLR-02] Unsupported extensions still rejected
- **WHEN** a local-file tool is called with an unsupported extension (e.g. `.rtf`)
- **THEN** `INVALID_FILE_TYPE` is returned

#### Scenario: [OPLR-03] Supported tools route to the ODF handler
- **WHEN** `read_file` / `replace_text` / `save` / `get_file_status` / `close_file` is invoked against a path bound to an ODF session
- **THEN** the ODF handler services it and the DOCX/gdocs handlers are not invoked

#### Scenario: [OPLR-04] Unsupported tools are guarded for ODF
- **WHEN** a Phase-2 tool (e.g. `compare_documents`, `add_comment`) is invoked against an ODF session
- **THEN** an `UNSUPPORTED_FOR_ODF` error is returned and no DOCX logic runs

#### Scenario: [OPLR-05] File-first `.odt` auto-opens
- **WHEN** `read_file` is called with a `.odt` path and no prior `open_document`
- **THEN** the ODF session is auto-opened and the read succeeds (DOCX resolver untouched)
