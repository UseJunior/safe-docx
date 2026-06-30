# mcp-server delta — opt-in fingerprint duplicate-disambiguation metadata on read_file

## ADDED Requirements

### Requirement: Optional Fingerprint Ordinal Disambiguation on read_file JSON

The `read_file` tool SHALL accept an optional `include_fingerprint_ordinal` boolean parameter
(default `false`). When `include_fingerprint_ordinal=true` AND `include_fingerprint=true` AND
`format="json"` for a DOCX session, the server SHALL emit three additional fields on each
paragraph node alongside `content_fingerprint`:

- `content_fingerprint_ordinal`: a 1-based integer giving the paragraph's position, in
  document order, among all paragraphs in the document that share its `content_fingerprint`.
- `content_fingerprint_count_in_document`: an integer giving the total number of paragraphs in
  the document that share that `content_fingerprint`.
- `portable_paragraph_ref`: the convenience composite string
  `"<content_fingerprint>#<content_fingerprint_ordinal>"`.

Ordinals and counts SHALL be computed over the **entire document** in document order, not over
the returned (paginated, `offset`/`limit`, or `node_ids`-filtered) slice. A paragraph in a
returned slice SHALL report the same ordinal and count it would report in a full read of the
document.

For a paragraph whose `content_fingerprint` is unique in the document, the ordinal SHALL be `1`
and the count SHALL be `1`.

The ordinal is a read-only disambiguator, NOT an edit anchor. Reordering duplicate paragraphs
MAY change ordinals. Edit tools SHALL continue to accept ONLY `_bk_*` identifiers as anchors,
and the paragraph `id` SHALL remain unchanged. The `content_fingerprint` algorithm SHALL remain
unchanged (NFKC normalization, Cf/invisible stripping, whitespace collapse + trim,
`sha256:nfkc:<32hex>`).

The flag SHALL have no effect unless `include_fingerprint=true` is also set: when
`include_fingerprint_ordinal=true` is passed without `include_fingerprint=true`, no ordinal
fields SHALL be emitted.

When `include_fingerprint_ordinal=true` is passed with `format="toon"` or `format="simple"`,
the flag SHALL have no effect (TOON and simple outputs are unchanged). When passed with a
Google Docs session (`google_doc_id`), the server SHALL silently ignore the flag.

#### Scenario: opt-in ordinal adds disambiguation fields on JSON output
- **GIVEN** a DOCX session
- **WHEN** `read_file` is called with `format="json"`, `include_fingerprint=true`, and `include_fingerprint_ordinal=true`
- **THEN** each paragraph object SHALL include integer `content_fingerprint_ordinal` and `content_fingerprint_count_in_document` fields
- **AND** a `portable_paragraph_ref` string of the form `<content_fingerprint>#<ordinal>`

#### Scenario: unique paragraph fingerprint reports ordinal 1 and count 1
- **GIVEN** a DOCX session whose paragraphs all have distinct normalized text
- **WHEN** `read_file` is called with `format="json"`, `include_fingerprint=true`, and `include_fingerprint_ordinal=true`
- **THEN** every paragraph SHALL report `content_fingerprint_ordinal` of `1`
- **AND** `content_fingerprint_count_in_document` of `1`

#### Scenario: duplicate normalized text receives deterministic document-order ordinals
- **GIVEN** a DOCX session with the same normalized paragraph text appearing three times
- **WHEN** `read_file` is called with `format="json"`, `include_fingerprint=true`, and `include_fingerprint_ordinal=true`
- **THEN** the three duplicate paragraphs SHALL receive `content_fingerprint_ordinal` values `1`, `2`, `3` in document order
- **AND** each SHALL report `content_fingerprint_count_in_document` of `3`

#### Scenario: whitespace-only variants share fingerprint and get distinct ordinals
- **GIVEN** a DOCX session with two paragraphs whose visible text differs only by collapsible whitespace
- **WHEN** `read_file` is called with `format="json"`, `include_fingerprint=true`, and `include_fingerprint_ordinal=true`
- **THEN** the two paragraphs SHALL share the same `content_fingerprint`
- **AND** SHALL receive distinct `content_fingerprint_ordinal` values `1` and `2`

#### Scenario: ordinal fields require include_fingerprint
- **GIVEN** a DOCX session
- **WHEN** `read_file` is called with `format="json"` and `include_fingerprint_ordinal=true` but without `include_fingerprint`
- **THEN** paragraph objects SHALL NOT contain `content_fingerprint_ordinal`, `content_fingerprint_count_in_document`, or `portable_paragraph_ref`

#### Scenario: portable_paragraph_ref composes fingerprint and ordinal
- **GIVEN** a DOCX session
- **WHEN** `read_file` is called with `format="json"`, `include_fingerprint=true`, and `include_fingerprint_ordinal=true`
- **THEN** each `portable_paragraph_ref` SHALL equal that node's `content_fingerprint` followed by `#` and its `content_fingerprint_ordinal`

#### Scenario: counts are document-wide across paginated windows
- **GIVEN** a DOCX session with a duplicated paragraph appearing three times across the document
- **WHEN** `read_file` is called with a `limit`/`node_ids` window that returns only some of the duplicates plus `include_fingerprint=true` and `include_fingerprint_ordinal=true`
- **THEN** the returned duplicate paragraphs SHALL report `content_fingerprint_count_in_document` of `3`
- **AND** their `content_fingerprint_ordinal` values SHALL match their document-order positions

#### Scenario: default JSON output omits ordinal fields
- **GIVEN** a DOCX session
- **WHEN** `read_file` is called with `format="json"` and `include_fingerprint=true` but no `include_fingerprint_ordinal`
- **THEN** paragraph objects SHALL contain `content_fingerprint` but NOT `content_fingerprint_ordinal`, `content_fingerprint_count_in_document`, or `portable_paragraph_ref`

#### Scenario: TOON format ignores include_fingerprint_ordinal
- **GIVEN** a DOCX session
- **WHEN** `read_file` is called with `format="toon"`, `include_fingerprint=true`, and `include_fingerprint_ordinal=true`
- **THEN** the TOON output SHALL be identical to the output produced without the flags

#### Scenario: simple format ignores include_fingerprint_ordinal
- **GIVEN** a DOCX session
- **WHEN** `read_file` is called with `format="simple"`, `include_fingerprint=true`, and `include_fingerprint_ordinal=true`
- **THEN** the simple output SHALL be identical to the output produced without the flags

#### Scenario: Google Docs ignores include_fingerprint_ordinal
- **GIVEN** a Google Docs session
- **WHEN** `read_file` is dispatched with `google_doc_id`, `format="json"`, `include_fingerprint=true`, and `include_fingerprint_ordinal=true`
- **THEN** the call SHALL succeed
- **AND** gdocs nodes SHALL NOT contain `content_fingerprint_ordinal`, `content_fingerprint_count_in_document`, or `portable_paragraph_ref`
