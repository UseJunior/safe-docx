## ADDED Requirements

### Requirement: Pull Word edits on a create output back into its creation source

`docx-markdoc pull <edited.docx> <document.mdoc>` SHALL compare an edited
`create` output with the build its certificate records, regenerated from the
certified source, and report each body change against source lines and each
header or footer change per section. With `--apply` it SHALL write the
changes it can express into a new `.mdoc` that keeps the creation markup of
unchanged text, and SHALL keep a change only when the source still builds
and reads back as the edited DOCX. Every edit it cannot express SHALL be
reported as a typed diagnostic, and the paragraph it touches SHALL stay as
it was. It SHALL refuse tracked changes and a source or build the
certificate does not record. It SHALL exit 0 for no changes, 2 for reported
changes or diagnostics and 1 for an error. `create --replace` SHALL accept
the edited DOCX in place of the certified one only when a complete pull's
record binds that DOCX to the source being built.

#### Scenario: [SDX-MDOC-PULL-01] each known edit is reported at its source line and nothing is dropped silently
- **GIVEN** a created letter edited by XML surgery: a Word save that restates style and settings defaults (heading outline levels, a redundant left alignment, the default tab stop), a wording change, a defined-term change, a deleted heading, an added paragraph, a filled-in fill, edits inside bold and underlined text, list items edited, deleted and added, a signer name, an added header and `Page X of Y` footer, and a second section's footer
- **WHEN** each is pulled, and all four of the issue's edits at once
- **THEN** each change SHALL be reported with its kind and source line, the pull SHALL be complete, and the pulled source SHALL keep the frontmatter, signer, fill, cross-reference, underline, bold and section markup and rebuild to the edited body text, headers and footers
- **AND** an edit inside a cross-reference, a re-aligned style, a changed default tab stop, a changed title, changed margins, a word made bold, a re-aligned paragraph, a comment, a two-line header, a tab and an emptied fill-in SHALL each raise its diagnostic and leave the pull incomplete
- **AND** the harness SHALL fail when a reported change, its line or a diagnostic is removed, or when a pull claims completeness for a source that does not rebuild to the edited DOCX

#### Scenario: [SDX-MDOC-PULL-02] pull --apply writes a new .mdoc that keeps the creation markup and rebuilds to the edited body
- **GIVEN** a created letter whose DOCX was edited in place
- **WHEN** `pull` runs without and then with `--apply`
- **THEN** it SHALL print each change with its source line and exit 2, write nothing without `--apply`, write `<stem>.pulled.mdoc` and the pull record with it, leave the source unchanged, and refuse to overwrite an existing output
- **AND** the pulled source SHALL rebuild to the edited body text, and an unedited DOCX SHALL report no changes and exit 0

#### Scenario: [SDX-MDOC-PULL-03] an edit across markup is split or diagnosed, never written into the markup
- **GIVEN** edits around a bold span and a fill-in: a deletion across the span's boundary, an insertion whose formatting changes there, a fill-in typed over entirely, the span deleted entirely, a fill-in emptied inside its brackets, and new text holding Markdown syntax
- **WHEN** each is pulled
- **THEN** the boundary edits SHALL be split between the two sides, a container the edit covers SHALL be replaced, the new text SHALL be escaped, and the emptied fill-in SHALL raise `PULL_EDIT_CROSSES_MARKUP` with the paragraph left unwritten

#### Scenario: [SDX-MDOC-PULL-04] tracked changes and a mismatched certificate or source are refused with exit code 1
- **GIVEN** an edited DOCX holding a tracked insertion, a source other than the certified one, a DOCX without a certificate beside it, and `--output` without `--apply`
- **WHEN** `pull` runs
- **THEN** it SHALL exit 1 with `PULL_TRACKED_CHANGES`, `PULL_SOURCE_CHANGED`, `PULL_CERTIFICATE_MISSING` or a usage error and write nothing, and `--certificate` SHALL locate a certificate kept elsewhere

#### Scenario: [SDX-MDOC-PULL-05] create --replace accepts the edited DOCX only after a complete pull of exactly the source it builds
- **GIVEN** a created DOCX edited in place and pulled with `--apply`
- **WHEN** `create --replace` builds the original source, the pulled source with a later edit, and exactly the pulled source
- **THEN** the first two SHALL be refused with `CREATION_OUTPUT_EDITED`, and the last SHALL pass every check, keep the edited bytes, note the replacement, reproduce the edited body text and remove the record
- **AND** an incomplete pull SHALL write no record, so `create --replace` still refuses

#### Scenario: [SDX-MDOC-PULL-06] numbering, table structure, even-page running text and kept markup are never lost silently
- **GIVEN** a list restarted at 7 in `word/numbering.xml` (alone and beside a wording edit), a list label made red or letter-spaced, `Normal` made bold, a body word letter-spaced, an underline recoloured, a footnote run letter-spaced, a used style deleted, a footer paragraph indented, a page number made bold (all its runs, or only the run that displays it), italics moved within a cross-reference's cached result (alone and beside a wording edit), a cross-reference result split into more runs, a section set in two columns, Word's default `w:cols` and `w:docGrid`, an even-page header (plain and as a tracked insertion), two table cells merged with `w:gridSpan`, a column resized and a table caption added beside a wording edit, the cell margins Word adds on save, an edit beside a `{% literal %}` span, and plain text typed over a whole bold span
- **WHEN** each is pulled
- **THEN** the restart and the label formatting SHALL raise `PULL_NUMBERING_CHANGED`, the bold `Normal` and the deleted style `PULL_STYLE_CHANGED`, the letter-spaced word, the recoloured underline and the moved cross-reference italics `PULL_DIRECT_FORMATTING`, the letter-spaced footnote `PULL_FOOTNOTES_CHANGED`, the two columns `PULL_PAGE_SETUP`, the indented footer a running-text diagnostic, the bold page number `PULL_FOOTER_UNMAPPED`, the merge, the resized column and the caption `PULL_TABLE_STRUCTURE` and the even-page header `PULL_HEADER_UNMAPPED`, each leaving the pull incomplete so no pull record is written, and the tracked insertion SHALL be refused with `PULL_TRACKED_CHANGES`
- **AND** the Word-added cell margins, columns and grid and the split cross-reference result SHALL report no change, the edit beside the span SHALL be written without removing the span's markup, and the typed-over bold span SHALL be replaced
