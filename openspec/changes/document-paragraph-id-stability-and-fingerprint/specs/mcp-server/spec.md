# mcp-server delta — clarify `_bk_*` paragraph ID stability and add opt-in `content_fingerprint`

## MODIFIED Requirements

### Requirement: Persisted Intrinsic Node IDs

The MCP server SHALL use persisted intrinsic paragraph/node identifiers (`_bk_*`) as canonical anchor identity.

The identifier strategy SHALL NOT use absolute sequential indexes as anchor identity.

`_bk_*` identifiers are deterministic. For a given paragraph in a given document, the identifier SHALL be byte-identical across re-opens, machines, and processes. Identifiers prefer the document's intrinsic Word `w14:paraId` when present; otherwise they are derived from a deterministic hash of the paragraph's normalized visible text together with neighbor and ancestor context. Consumers MAY persist `_bk_*` identifiers in indexes, citation databases, and other external stores keyed off the same source document.

#### Scenario: Re-opening unchanged document yields same IDs
- **GIVEN** a document opened in two independent MCP sessions with no content changes
- **WHEN** `read_file` is called in both sessions
- **THEN** equivalent paragraphs receive the same `_bk_*` identifiers

#### Scenario: Inserting new paragraph does not renumber unrelated IDs
- **GIVEN** an existing session with stable `_bk_*` IDs
- **WHEN** a new paragraph is inserted
- **THEN** existing untouched paragraphs retain their prior `_bk_*` IDs
- **AND** only new/edited paragraphs receive newly minted intrinsic IDs as needed

#### Scenario: Two identical signature-block paragraphs remain uniquely addressable
- **GIVEN** a document containing duplicate text blocks such as:
- **AND** `Supplier / By: / Name: / Title:` and `Customer / By: / Name: / Title:`
- **WHEN** IDs are assigned and `read_file` is called
- **THEN** each paragraph instance has a distinct `_bk_*` identifier
- **AND** those identifiers remain stable for subsequent edits and downloads

#### Scenario: Missing intrinsic IDs are backfilled once
- **GIVEN** a document paragraph without a `_bk_*` identifier
- **WHEN** the document is opened
- **THEN** the server mints and persists a new `_bk_*` identifier for that paragraph
- **AND** future reads use that same identifier

#### Scenario: Identifiers are byte-identical across machines for unchanged documents
- **GIVEN** the same DOCX file opened on two different machines
- **WHEN** `read_file` is called on each
- **THEN** every paragraph receives the same `_bk_*` identifier on both machines
- **AND** consumers MAY persist these identifiers in external stores without invalidating them on machine change

## ADDED Requirements

### Requirement: Optional Content Fingerprint on read_file JSON

The `read_file` tool SHALL accept an optional `include_fingerprint` boolean parameter. When `include_fingerprint=true` and `format="json"` for a DOCX session, the server SHALL emit a `content_fingerprint` field on each paragraph node.

The fingerprint SHALL be computed as `"sha256:nfkc:" + sha256( NFKC(rawVisibleText).replace(/\s+/g, " ").trim() )` truncated to the first 32 hex characters of the SHA-256 digest. The input `rawVisibleText` is the paragraph's raw visible text (the same surface used by the `_bk_*` fallback seed via `getParagraphText`), NOT the post-processed `clean_text` that has list labels stripped or footnote display markers appended.

The fingerprint is read-only metadata. Edit tools (`replace_text`, `insert_paragraph`, `apply_plan`, etc.) SHALL continue to accept ONLY `_bk_*` identifiers as anchors. `content_fingerprint` SHALL NEVER be accepted as an edit anchor.

When `include_fingerprint=true` is passed with `format="toon"` or `format="simple"`, the flag SHALL have no effect (TOON and simple outputs are unchanged).

When `include_fingerprint=true` is passed with `google_doc_id` (Google Docs path), the server SHALL silently ignore the flag (no field added to gdocs nodes). Google Docs fingerprint support is out of scope for this requirement.

#### Scenario: opt-in fingerprint adds field on JSON output
- **GIVEN** a DOCX session
- **WHEN** `read_file` is called with `format="json"` and `include_fingerprint=true`
- **THEN** each paragraph object in the JSON response SHALL include a `content_fingerprint` string
- **AND** the fingerprint SHALL match the pattern `sha256:nfkc:[0-9a-f]{32}`

#### Scenario: default JSON output omits fingerprint
- **GIVEN** a DOCX session
- **WHEN** `read_file` is called with `format="json"` and no `include_fingerprint` parameter
- **THEN** paragraph objects SHALL NOT contain a `content_fingerprint` field

#### Scenario: same paragraph text produces same fingerprint across documents
- **GIVEN** two different DOCX files that each contain a paragraph with identical visible text
- **WHEN** `read_file` is called on both with `format="json"` and `include_fingerprint=true`
- **THEN** the corresponding paragraphs SHALL receive byte-identical `content_fingerprint` values

#### Scenario: TOON format ignores include_fingerprint
- **GIVEN** a DOCX session
- **WHEN** `read_file` is called with `format="toon"` and `include_fingerprint=true`
- **THEN** the TOON output SHALL be identical to the output produced without `include_fingerprint`
