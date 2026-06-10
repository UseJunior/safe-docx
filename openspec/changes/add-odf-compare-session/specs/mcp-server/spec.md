## ADDED Requirements

### Requirement: ODF session-mode `compare_documents` (redline a `.odt` session against its original)

The MCP server SHALL service `compare_documents` for a `.odt` `file_path` (session mode) by
dispatching through the standard ODF session-resolution lane (`dispatchOdf`), opening or reusing
the `.odt` session, and comparing the session's current edited state against the original document
the session was opened from. The original SHALL be the `content.xml` extracted from the session's
immutable open-time `originalBuffer` (via a freshly loaded archive — the live session archive is
stamped with edited content on save and SHALL NOT be used as the baseline source or mutated by
comparison), and the revised SHALL be the live session document's serialization. The comparison
SHALL use the same paragraph-granularity engine as two-file mode and SHALL inherit whatever
granularity that engine supports.

Mode precedence SHALL be two-file first for ALL providers: when both `original_file_path` and
`revised_file_path` are present, the request SHALL be handled in two-file mode (the stateless ODF
handler when an input is `.odt`, the DOCX tool otherwise) even if a `file_path` is also supplied.

The redline SHALL be packaged on the original package (valid because ODF session edit tools
currently mutate only `content.xml`) and written to `save_to_local_path` with the same output-path
safety as two-file mode: the server SHALL reject a `save_to_local_path` resolving to the session's
original file with no `allow_overwrite` escape, and SHALL enforce the write-path policy before
writing. The live session SHALL NOT be mutated: a subsequent `save` SHALL produce the edited
document without tracked-changes markup.

The response SHALL carry `mode: 'session'`, `provider: 'odf'`, `original_file_path`, `saved_to`,
`size_bytes`, `author`, `granularity: 'paragraph'`, `stats: { insertions, deletions,
modifications }`, a `message`, and the standard session-resolution metadata
(`session_resolution`, `resolved_file_path`, and `reused_session_context` when reused). DOCX-only
fields (`engine`, `reconstruction_mode`) SHALL be omitted. A session with no edits SHALL succeed
with zero stats (an empty change set), not an error.

#### Scenario: [OPCS-01] Session edits produce a tracked-changes redline
- **WHEN** a `.odt` session has accumulated edits and `compare_documents` is invoked with that `file_path` plus `save_to_local_path`
- **THEN** a tracked-changes `.odt` is written to `save_to_local_path` and the response reports `mode: 'session'`, `provider: 'odf'`, `granularity: 'paragraph'`, and non-zero `stats`

#### Scenario: [OPCS-02] An unedited session produces an empty redline
- **WHEN** `compare_documents` is invoked on a freshly opened, unedited `.odt` session — including one whose content uses serialization-sensitive constructs (`text:s`, `text:tab`, `text:line-break`, `text:h`, entity-escaped text, `office:annotation`)
- **THEN** the call succeeds with `stats` of zero insertions, zero deletions, zero modifications, and no phantom changes appear in the output

#### Scenario: [OPCS-03] The session redline reopens with deleted content out-of-line
- **WHEN** the redline produced by a session-mode compare is reloaded
- **THEN** the revised (edited) text is present in the body and the deleted original text does not leak into the visible content

#### Scenario: [OPCS-04] Output path may not overwrite the session's original
- **WHEN** session-mode `compare_documents` is invoked with a `save_to_local_path` that resolves to the session's original file
- **THEN** an `OVERWRITE_BLOCKED` error is returned and the original file is untouched

#### Scenario: [OPCS-05] Session-resolution metadata is attached
- **WHEN** session-mode `compare_documents` opens a fresh `.odt` session, or reuses one created by a prior edit
- **THEN** the response carries `session_resolution: 'opened'` for the fresh path, or `session_resolution: 'reused'` plus `reused_session_context` for the reused path

#### Scenario: [OPCS-06] Comparison does not mutate the live session
- **WHEN** a session-mode compare runs and the session is subsequently saved
- **THEN** the saved document contains the session's edits and no tracked-changes markup

#### Scenario: [OPCS-07] Two-file mode keeps precedence over a stray `file_path`
- **WHEN** `compare_documents` is invoked with two `.docx` input paths and a stray `.odt` `file_path`
- **THEN** the DOCX two-file comparison runs and no ODF session is opened
