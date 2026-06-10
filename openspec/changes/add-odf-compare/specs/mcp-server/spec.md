## ADDED Requirements

### Requirement: ODF two-file `compare_documents` (paragraph-granularity redline)

The MCP server SHALL service `compare_documents` for ODF inputs in **two-file mode**
(`original_file_path` + `revised_file_path` both ending in `.odt`) via the provider-aware lane,
in addition to the existing ODF tools. The DOCX and Google Docs paths SHALL remain unchanged,
and every still-unsupported tool SHALL continue to return `UNSUPPORTED_FOR_ODF`.

Because two-file `compare_documents` carries no `file_path`, it SHALL dispatch to a stateless
ODF compare handler directly (NOT through the session-resolution chokepoint, which requires
`file_path`). The handler SHALL load both `.odt`s, produce a paragraph-granularity
tracked-changes redline `.odt`, write it to `save_to_local_path`, and return a response of the
same shape as the DOCX tool with ODF-appropriate fields: `mode: 'two_file'`,
`original_file_path`, `revised_file_path`, `saved_to`, `size_bytes`, `author`,
`granularity: 'paragraph'`, `stats: { insertions, deletions, modifications }`, and a `message`.
DOCX-only fields (`engine`, `reconstruction_mode`) SHALL be omitted.

At paragraph granularity a modified paragraph SHALL be represented as a deletion of the old
paragraph plus an insertion of the new one, so `modifications` SHALL be `0` and the `message`
SHALL note that changes are tracked at the whole-paragraph level (so insertion/deletion counts
run higher than the DOCX atom-level path).

The ODF handler SHALL apply the same output-path safety as the DOCX tool: it SHALL reject when
`save_to_local_path` resolves to either source file, and SHALL enforce the write-path policy
before writing the redline.

ODF **session-mode** `compare_documents` (a `.odt` on `file_path`) is specified by the
`add-odf-compare-session` change; tools still outside the ODF supported set SHALL continue to
return `UNSUPPORTED_FOR_ODF`.

#### Scenario: [OPCD-01] Two-file `.odt` compare produces a redline
- **WHEN** `compare_documents` is invoked with `.odt` `original_file_path` and `revised_file_path` that differ by whole paragraphs, plus `save_to_local_path`
- **THEN** the ODF handler writes a tracked-changes `.odt` to `save_to_local_path` and returns `mode: 'two_file'`, `granularity: 'paragraph'`, and non-zero `stats`, and the DOCX/gdocs handlers are not invoked

#### Scenario: [OPCD-02] Inserted and deleted paragraphs are counted
- **WHEN** the revised `.odt` adds one paragraph and removes another relative to the original
- **THEN** `stats.insertions` and `stats.deletions` are each at least 1 and `stats.modifications` is 0

#### Scenario: [OPCD-03] DOCX two-file compare is unchanged
- **WHEN** `compare_documents` is invoked with two `.docx` paths
- **THEN** the existing DOCX comparison runs and returns its DOCX response shape (including `engine`), and no ODF logic runs

#### Scenario: [OPCD-04] Still-unsupported tools remain guarded for ODF sessions
- **WHEN** a tool outside the ODF supported set (e.g. `accept_changes`) is invoked against an open `.odt` session
- **THEN** an `UNSUPPORTED_FOR_ODF` error is returned and no DOCX logic runs

#### Scenario: [OPCD-05] The redline reopens with the changes preserved
- **WHEN** the redline `.odt` produced by a two-file compare is reloaded
- **THEN** its `text:tracked-changes` regions and in-body change markers are present, the unchanged paragraphs' visible text is preserved, and the package is mimetype-first STORED

#### Scenario: [OPCD-06] Output path may not overwrite a source
- **WHEN** `compare_documents` is invoked with `.odt` sources and a `save_to_local_path` that resolves to one of the source files
- **THEN** an error is returned and neither source file is overwritten
