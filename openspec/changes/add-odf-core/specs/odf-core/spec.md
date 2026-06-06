## ADDED Requirements

### Requirement: ODF Archive Handling

The system SHALL provide an `OdfArchive` that loads and saves `.odt` files as ODF
packages. `load()` SHALL reject a buffer missing `content.xml` or
`META-INF/manifest.xml`. `save()` SHALL emit the `mimetype` entry first and stored
uncompressed (no DEFLATE) — including across a load → modify → save round trip, which
requires rebuilding the archive rather than re-saving the loaded handle — and SHALL
preserve every entry the caller did not modify with byte-identical decompressed
content (the compressed container bytes may differ). The archive SHALL expose
part-path constants for `content.xml`, `styles.xml`, `meta.xml`, and
`META-INF/manifest.xml`.

#### Scenario: [OARCH-01] Load a valid `.odt`
- **WHEN** `OdfArchive.load(buffer)` is called with a real `.odt`
- **THEN** the archive loads and exposes `content.xml`

#### Scenario: [OARCH-02] Reject a non-ODF package
- **WHEN** `OdfArchive.load(buffer)` is called with a buffer lacking `content.xml` or `META-INF/manifest.xml`
- **THEN** loading fails with an invalid-ODF error

#### Scenario: [OARCH-03] mimetype is first and uncompressed after a load→save round trip
- **WHEN** an existing `.odt` is loaded, an entry is modified, and the archive is saved
- **THEN** the resulting ZIP's first entry is `mimetype`, stored uncompressed (method 0), with value `application/vnd.oasis.opendocument.text`

#### Scenario: [OARCH-04] Untouched entries are preserved
- **WHEN** only `content.xml` is modified and the archive is saved
- **THEN** every other entry (styles.xml, meta.xml, manifest, media) has decompressed content byte-identical to the input

### Requirement: ODF Archive Safety Guard

The system SHALL validate an ODF buffer before parsing using the format-agnostic
ZIP-entry inspection shared with DOCX (entry-count, single-entry size, total
uncompressed size, and compression-ratio limits), and SHALL additionally assert the
package declares the OpenDocument text mimetype. Unsafe or non-ODF archives SHALL be
rejected with an actionable error.

#### Scenario: [OSAFE-01] Reject a zip-bomb-shaped archive
- **WHEN** an ODF buffer exceeds the compression-ratio or uncompressed-size limits
- **THEN** the guard rejects it with an archive-safety error

#### Scenario: [OSAFE-02] Reject a ZIP without the ODF mimetype
- **WHEN** a ZIP without an `application/vnd.oasis.opendocument.text` mimetype is validated
- **THEN** the guard rejects it as not a valid `.odt`

### Requirement: ODF Document View and Stable Paragraph IDs

The system SHALL parse `content.xml` into a document-ordered list of block-level text
elements (`text:p` and `text:h`), including paragraphs nested inside
`table:table-cell`. Each element SHALL receive a deterministic structural paragraph
ID that is identical across reopens for identical stored bytes. The view SHALL return
a paragraph's visible text by ID.

#### Scenario: [ODV-01] Enumerate body paragraphs and headings
- **WHEN** a `.odt` with `text:p` and `text:h` blocks is parsed
- **THEN** all blocks appear in document order, each with a structural ID and its visible text

#### Scenario: [ODV-02] Include table-cell paragraphs
- **WHEN** the document contains a `table:table` with text in cells
- **THEN** the cell paragraphs are enumerated in document order alongside body paragraphs

#### Scenario: [ODV-03] IDs are deterministic across reopen
- **WHEN** the same stored `.odt` bytes are parsed twice
- **THEN** the structural paragraph IDs are identical

#### Scenario: [ODV-04] Read paragraph text by ID
- **WHEN** `getParagraphTextById(id)` is called with a valid ID
- **THEN** the visible text of that paragraph is returned

### Requirement: ODF Text Replacement

The system SHALL replace text within a paragraph identified by structural ID,
updating `content.xml` while preserving surrounding document structure. The
paragraph's visible text SHALL be computed by concatenating descendant text and
expanding `text:s` (to N spaces) and `text:tab` (to a tab). In Phase 1, replacement
SHALL be performed only when the matched region maps to a contiguous span within a
single `#text` node; a match that crosses node/element boundaries or includes an
expanded `text:s` / `text:tab` SHALL be rejected transactionally with
`MATCH_SPANS_MULTIPLE_NODES` and SHALL leave the document unchanged. The system SHALL
report `TEXT_NOT_FOUND` when the find text is absent and an anchor-not-found error
when the ID does not resolve.

#### Scenario: [OTR-01] Replace text contained in a single text node
- **WHEN** `replaceTextById(id, findText, replaceWith)` targets a body paragraph where `findText` lies within one `#text` node
- **THEN** the paragraph's text reflects the replacement and other paragraphs are unchanged

#### Scenario: [OTR-02] Replace text in a table cell
- **WHEN** `replaceTextById` targets a table-cell paragraph and the match lies within one `#text` node
- **THEN** the cell text is updated correctly

#### Scenario: [OTR-03] Missing find text is reported
- **WHEN** `findText` does not occur in the targeted paragraph's visible text
- **THEN** a `TEXT_NOT_FOUND` error is returned and the document is unchanged

#### Scenario: [OTR-04] Span-crossing match is rejected without mutation
- **WHEN** the match spans multiple `#text` nodes (e.g. across a `text:span`) or includes an expanded `text:s` / `text:tab`
- **THEN** a `MATCH_SPANS_MULTIPLE_NODES` error is returned and the document is unchanged

### Requirement: ODF Round-Trip Safety

After an open → replace_text → save → reopen cycle, the system SHALL guarantee
semantic and structural preservation (not byte equality): the `mimetype` remains
first and uncompressed, all unmodified entries are byte-identical, `content.xml`
remains well-formed, the edited paragraph reads back the expected text, and every
unchanged paragraph's text is preserved. A LibreOffice headless open SHALL be
exercised as compatibility evidence where `soffice` is available.

#### Scenario: [ORTS-01] Edited document reopens with expected text
- **WHEN** a `.odt` is opened, a paragraph is edited via `replace_text`, saved, and reopened
- **THEN** the edited paragraph reads the post-replace text and all other paragraphs are unchanged

#### Scenario: [ORTS-02] Saved `.odt` opens in LibreOffice
- **WHEN** `soffice` is available and the saved `.odt` is converted headlessly
- **THEN** the conversion succeeds with no error (skipped with a logged warning when `soffice` is absent)
