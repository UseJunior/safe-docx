## ADDED Requirements

### Requirement: ODF two-file `compare_documents` reports inline granularity

The ODF two-file `compare_documents` handler SHALL report `granularity: 'inline'`
(superseding the Slice-1 `'paragraph'` value) once intra-paragraph comparison lands in
`@usejunior/odf-core`, and its `message` SHALL describe the stats unit — changed-regions:
modified paragraphs count once in `modifications` with their inner inserted/deleted spans
counted in `insertions`/`deletions`; whole-paragraph changes count one each. The message SHALL
no longer claim that a modified paragraph counts as one deletion plus one insertion or that
counts run higher than the DOCX path.

All other Slice-1 surface behavior (two-file dispatch, output-path safety, session-mode
`UNSUPPORTED_FOR_ODF`, DOCX path untouched) SHALL be unchanged.

#### Scenario: [OPDI-01] Two-file `.odt` compare reports inline granularity and meaningful modifications
- **WHEN** `compare_documents` runs on two `.odt`s where one paragraph has a one-word edit
- **THEN** the response carries `granularity: 'inline'` and `stats.modifications` of at least 1

#### Scenario: [OPDI-02] Whole-paragraph-only diffs still report zero modifications
- **WHEN** `compare_documents` runs on two `.odt`s that differ only by added and removed paragraphs (no similar pair)
- **THEN** `stats.modifications` is 0 while `stats.insertions`/`stats.deletions` count the changed paragraphs
