# mcp-server Specification

## Purpose
Define behavior guarantees for the Safe-Docx MCP server: stable paragraph identity, deterministic download contracts, robust session entry/control, and resilient text-matching fallbacks for document edits.
## Requirements
### Requirement: Persisted Intrinsic Node IDs

The MCP server SHALL use persisted intrinsic paragraph/node identifiers (`jr_para_*`) as canonical anchor identity.

The identifier strategy SHALL NOT use absolute sequential indexes as anchor identity.

#### Scenario: Re-opening unchanged document yields same IDs
- **GIVEN** a document opened in two independent MCP sessions with no content changes
- **WHEN** `read_file` is called in both sessions
- **THEN** equivalent paragraphs receive the same `jr_para_*` identifiers

#### Scenario: Inserting new paragraph does not renumber unrelated IDs
- **GIVEN** an existing session with stable `jr_para_*` IDs
- **WHEN** a new paragraph is inserted
- **THEN** existing untouched paragraphs retain their prior `jr_para_*` IDs
- **AND** only new/edited paragraphs receive newly minted intrinsic IDs as needed

#### Scenario: Two identical signature-block paragraphs remain uniquely addressable
- **GIVEN** a document containing duplicate text blocks such as:
- **AND** `Supplier / By: / Name: / Title:` and `Customer / By: / Name: / Title:`
- **WHEN** IDs are assigned and `read_file` is called
- **THEN** each paragraph instance has a distinct `jr_para_*` identifier
- **AND** those identifiers remain stable for subsequent edits and downloads

#### Scenario: Missing intrinsic IDs are backfilled once
- **GIVEN** a document paragraph without a `jr_para_*` identifier
- **WHEN** the document is opened
- **THEN** the server mints and persists a new `jr_para_*` identifier for that paragraph
- **AND** future reads use that same identifier

### Requirement: Dual-Variant Download by Default

The `download` tool SHALL return both `clean` and `redline` outputs by default when no variant override is provided.

#### Scenario: Default download returns both variants
- **GIVEN** a session with applied edits
- **WHEN** `download` is called without variant override
- **THEN** the response includes both `clean` and `redline` artifacts

#### Scenario: Explicit variant override returns subset
- **GIVEN** a session with applied edits
- **WHEN** `download` is called with an explicit variant override for only `clean`
- **THEN** only the clean artifact is returned
- **AND** no redline artifact is generated for that request

### Requirement: Session-Based Re-Download Without Re-Editing

The MCP server SHALL allow users to re-download previously generated artifacts by `session_id` without replaying edit operations.

#### Scenario: Repeat download reuses cached artifacts
- **GIVEN** a session and edit revision with previously generated `clean` and `redline` outputs
- **WHEN** `download` is called again for the same session and revision
- **THEN** the server returns cached artifacts
- **AND** the response indicates a cache hit
- **AND** no edit replay is performed

#### Scenario: New edit invalidates previous revision cache
- **GIVEN** cached artifacts for edit revision N
- **WHEN** a new edit creates revision N+1
- **THEN** subsequent downloads for the current state use revision N+1 artifacts
- **AND** stale revision N artifacts are not returned as current outputs

### Requirement: Download Operations Preserve Anchor Stability

Artifact generation for `download` SHALL NOT mutate the active session's paragraph anchor mapping.

#### Scenario: Anchors unchanged after dual download
- **GIVEN** a session with known paragraph IDs
- **WHEN** `download` is called with default dual-variant behavior
- **THEN** a subsequent `read_file` call returns the same paragraph IDs for unchanged paragraphs

#### Scenario: Generating clean artifact does not invalidate redline anchors
- **GIVEN** a session with applied edits
- **WHEN** a clean artifact is generated
- **THEN** paragraph anchor mappings remain valid for redline generation in the same session

### Requirement: Explicit Download Contract Metadata

The MCP server SHALL expose download defaults and re-download behavior in tool metadata and responses.

#### Scenario: Open response advertises download defaults
- **GIVEN** a successful `open_document` call
- **WHEN** tool metadata is returned
- **THEN** metadata states that default `download` behavior returns both `clean` and `redline`
- **AND** metadata describes override support

#### Scenario: Download response reports variant and cache details
- **GIVEN** any `download` invocation
- **WHEN** the response is returned
- **THEN** it includes returned variant list
- **AND** includes cache hit/miss status
- **AND** includes an edit revision marker

### Requirement: Tool Session Entry for Safe-Docx MCP
The Safe-Docx MCP server SHALL support file-first entry for document tools while preserving explicit session semantics.

#### Scenario: document tools accept file-first entry without pre-open
- **WHEN** any document tool (`read_file`, `grep`, `replace_text`, `insert_paragraph`, `download`, `get_session_status`) is called with `file_path` and without `session_id`
- **THEN** the server SHALL resolve a session for that file (reusing an active one or creating a new one)
- **AND** return `resolved_session_id` and `resolved_file_path` in response metadata

### Requirement: Matching Fallback Parity
The Safe-Docx MCP matching behavior SHALL retain Python-compatible fallback semantics for robust in-paragraph targeting.

#### Scenario: quote-normalized fallback matches smart quotes and ASCII quotes
- **GIVEN** paragraph text containing smart quotes
- **WHEN** `smart_edit` is called with equivalent ASCII-quote `old_string`
- **THEN** the server SHALL resolve a unique fallback match and apply the edit

#### Scenario: flexible-whitespace fallback ignores spacing variance
- **GIVEN** paragraph text containing repeated/mixed whitespace
- **WHEN** `smart_edit` is called with normalized spacing in `old_string`
- **THEN** the server SHALL resolve a unique fallback match and apply the edit

#### Scenario: quote-optional fallback matches quoted and unquoted term references
- **GIVEN** paragraph text containing quoted term occurrences
- **WHEN** `smart_edit` is called with unquoted equivalent `old_string`
- **THEN** the server SHALL resolve a unique fallback match and apply the edit

#### Scenario: quote-normalization scenarios are test-mapped in Allure coverage
- **WHEN** safe-docx Allure tests and spec-coverage validation run in CI
- **THEN** each quote-normalization fallback scenario SHALL be mapped to OpenSpec scenario IDs
- **AND** the validation step SHALL fail when mappings are missing

### Requirement: Explicit Session Control
The Safe-Docx MCP server SHALL provide explicit tools to clear session state without waiting for TTL expiry.

#### Scenario: clear one session by id
- **WHEN** `clear_session` is called with `session_id`
- **THEN** the server SHALL remove that session
- **AND** future use of that id SHALL return `SESSION_NOT_FOUND`

#### Scenario: clear sessions by file path clears all sessions for that file
- **WHEN** `clear_session` is called with `file_path`
- **THEN** the server SHALL clear all active sessions mapped to that normalized file path
- **AND** the response SHALL report exactly which session IDs were cleared

#### Scenario: clear all sessions requires explicit confirmation
- **WHEN** `clear_session` is called with `clear_all=true`
- **THEN** the server SHALL require explicit confirmation input
- **AND** reject the call if confirmation is missing

### Requirement: Deprecated Explicit Open Step
The Safe-Docx MCP server SHALL deprecate `open_document` as the primary entrypoint in favor of file-first tool calls.

#### Scenario: open_document remains callable with deprecation warning
- **WHEN** `open_document` is called
- **THEN** the server SHALL continue returning a valid `session_id`
- **AND** SHALL include deprecation guidance directing callers to file-first usage

### Requirement: Tool Feature Parity
The TypeScript Safe-Docx MCP server SHALL match the Python editing pipeline’s formatting fidelity for core editing operations, not merely structural validity.

#### Scenario: read_file returns TOON schema with structure columns
- **WHEN** `read_file` is called for a session
- **THEN** the server SHALL return TOON output using the schema:
  - `#SCHEMA id | list_label | header | style | text`
- **AND** each row SHALL include:
  - `id` as `jr_para_*`
  - `list_label` derived programmatically (empty for non-list paragraphs)
  - `header` derived programmatically for run-in headers (empty otherwise)
  - `style` as a stable, fingerprint-derived style ID (e.g., `body_1`, `section`)
  - `text` as the paragraph’s LLM-visible text (with header stripped when header column is populated)

#### Scenario: smart_edit preserves mixed-run formatting
- **GIVEN** a paragraph whose visible text spans multiple runs with different formatting (e.g., underline on one run, plain on the next)
- **WHEN** `smart_edit` replaces a substring spanning those runs
- **THEN** the output paragraph SHALL preserve the original mixed formatting structure as closely as possible
- **AND** SHALL NOT flatten the entire replacement span to a single run’s formatting template

#### Scenario: smart_insert preserves header/definition semantics
- **WHEN** `smart_insert` inserts content that includes explicit definitions and/or a run-in header
- **THEN** the inserted paragraph(s) SHALL preserve formatting conventions via role models
- **AND** run-in headers SHALL populate the `header` column rather than being duplicated inline

### Requirement: DocumentView IR and JSON Mode
The TypeScript Safe-Docx MCP server SHALL build and cache a DocumentView IR per session and support a machine-readable JSON output mode for parity testing and downstream tooling.

#### Scenario: read_file JSON mode returns node metadata
- **WHEN** `read_file` is called with `format="json"`
- **THEN** the server SHALL return a JSON payload containing nodes with:
  - `id`, `list_label`, `header`, `style`, `text`
  - `style_fingerprint` (raw stable fingerprint)
  - `header_formatting` (bold/italic/underline metadata when applicable)
  - numbering metadata (e.g., `numId`, `ilvl`) when applicable

### Requirement: Style Fingerprinting and Stable Style IDs
The server SHALL compute a deterministic, stable style fingerprint for each paragraph and map fingerprints to stable style IDs suitable for LLM consumption.

#### Scenario: fingerprint ignores volatile attributes
- **GIVEN** two documents that differ only by volatile OOXML attributes (e.g., `w:rsid*`, revision IDs/dates)
- **WHEN** the server computes style fingerprints for corresponding paragraphs
- **THEN** the fingerprints SHALL be equal
- **AND** the derived `style` IDs in TOON output SHALL be equal

#### Scenario: stable style IDs within a session
- **WHEN** `read_file` is called multiple times within a session
- **THEN** the same paragraph SHALL retain the same `style` value unless its paragraph/run properties meaningfully change

### Requirement: Header Column Detection and De-Duplication
The server SHALL detect run-in headers programmatically and represent them in the dedicated `header` column, without duplicating the header text in the `text` column.

#### Scenario: formatting-based header detection
- **GIVEN** a paragraph beginning with a short bold/underlined span ending in punctuation (e.g., `“Security Incidents:”`)
- **WHEN** the document is ingested to DocumentView
- **THEN** the server SHALL extract `Security Incidents` into the `header` column
- **AND** SHALL strip the header span from the `text` column
- **AND** SHALL record `header_formatting` metadata for edit rendering

### Requirement: Semantic Tags and Role Model Rendering
The server SHALL support semantic tags in inserted/replacement text and render them into concrete OOXML formatting using role models discovered in the document.

#### Scenario: header semantics accepted via tags for backward compatibility
- **WHEN** an edit includes `<RunInHeader>Header</RunInHeader>` or `<header>Header</header>`
- **THEN** the server SHALL render the header into the `header` column representation
- **AND** apply stored header formatting metadata when writing OOXML runs

### Requirement: Font Tag Support in Replacement Strings
The server SHALL support `<font>` tags in `replace_text` and `insert_paragraph` `new_string` parameters to control font color, size, and face on sub-runs. The `size` attribute uses points (e.g., `<font size="14">` = 14pt). The `color` attribute is a hex string (e.g., `"FF0000"`). The `face` attribute is a font family name.

#### Scenario: font tag applies color, size, and face to OOXML runs
- **WHEN** an edit includes `<font color="FF0000" size="14" face="Arial">text</font>`
- **THEN** the server SHALL produce OOXML runs with `<w:color w:val="FF0000"/>`, `<w:sz w:val="28"/>`, and `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>`
- **AND** the saved `.docx` SHALL NOT contain the literal `<font>` tag text

### Requirement: Font Tag Emission in read_file Output
The server SHALL emit `<font>` tags in `read_file` output (with `show_formatting=true`) when font properties vary within a paragraph, using paragraph-local baselines.

#### Scenario: paragraph-local font baseline suppression
- **GIVEN** a paragraph where all runs share the same color, font size, and font name
- **WHEN** `read_file` is called with `show_formatting=true`
- **THEN** no `<font>` tags SHALL be emitted for that paragraph

#### Scenario: mixed-font paragraph emits font tags for deviations
- **GIVEN** a paragraph where one run has a different color from the modal baseline
- **WHEN** `read_file` is called with `show_formatting=true`
- **THEN** only the deviating run SHALL be wrapped in `<font color="...">` tags

### Requirement: Formatting Surgeon (Deterministic)
The server SHALL use a deterministic formatting surgeon for edits that require run splitting, multi-run replacements, and field-aware visible-text mapping.

#### Scenario: field-aware visible text does not destroy fields
- **GIVEN** a paragraph containing Word fields (e.g., `MERGEFIELD`, `REF`, etc.)
- **WHEN** a `smart_edit` targets visible text adjacent to fields
- **THEN** the server SHALL preserve field structure (`w:fldChar`, `w:instrText`, etc.)
- **AND** SHALL refuse edits that would require unsafe field rewrites

### Requirement: Hook Pipeline (Normalization + Invariants)
The server SHALL run a hook pipeline around tool execution to normalize inputs and enforce invariants comparable to the Python editing pipeline.

#### Scenario: pagination rules deterministic for zero offset
- **WHEN** `read_file` is called with `offset=0`
- **THEN** the server SHALL treat `offset=0` as start-of-document
- **AND** SHALL return the same window as `offset` omitted (subject to `limit`)

#### Scenario: post-edit invariants prevent empty paragraph stubs
- **WHEN** an edit operation splits runs or inserts/removes paragraph-level nodes
- **THEN** the server SHALL remove empty runs/paragraph stubs introduced by the operation
- **AND** the resulting document SHALL open cleanly in Microsoft Word

### Requirement: Accept Tracked Changes Tool
The Safe-Docx MCP server SHALL provide an `accept_changes` tool that accepts all tracked changes in the document body, producing a clean .docx with no revision markup in the body. v1 scope is document body only; headers, footers, footnotes, and endnotes are deferred.

#### Scenario: accept_changes produces clean document body with no revision markup
- **GIVEN** a document containing tracked changes (insertions, deletions, formatting changes, moves) in the document body
- **WHEN** `accept_changes` is called
- **THEN** the server SHALL return a document with all tracked changes in the body accepted
- **AND** the response SHALL include acceptance stats (insertions accepted, deletions accepted, moves resolved, property changes resolved)
- **AND** tracked changes in headers, footers, footnotes, and endnotes SHALL remain unmodified in v1

#### Scenario: accepted document opens cleanly in Microsoft Word
- **GIVEN** a document with tracked changes that has been processed by `accept_changes`
- **WHEN** the resulting document is opened in Microsoft Word
- **THEN** the document SHALL open without errors or repair prompts
- **AND** no tracked changes SHALL appear in the review pane

#### Scenario: original document is not mutated
- **GIVEN** a source document with tracked changes
- **WHEN** `accept_changes` is called
- **THEN** the original source document SHALL remain unchanged
- **AND** the accepted output SHALL be written to a separate file or session working copy

### Requirement: Automatic Document Normalization
The Safe-Docx MCP server SHALL automatically normalize documents on open by running merge_runs and simplify_redlines preprocessing, improving text matching accuracy and read_file context efficiency.

#### Scenario: document is normalized on open by default
- **WHEN** a document is opened via `open_document` or file-first entry without `skip_normalization`
- **THEN** the server SHALL run merge_runs and simplify_redlines on the working copy
- **AND** SHALL report normalization stats (`runs_merged`, `redlines_simplified`) in session metadata

#### Scenario: skip_normalization bypasses preprocessing
- **WHEN** a document is opened with `skip_normalization=true`
- **THEN** the server SHALL NOT run merge_runs or simplify_redlines
- **AND** session metadata SHALL report `normalization_skipped=true`

#### Scenario: normalization stats in session metadata
- **GIVEN** a document that has been normalized on open
- **WHEN** `get_session_status` is called
- **THEN** the response SHALL include `runs_merged`, `redlines_simplified`, and `normalization_skipped` fields

#### Scenario: jr_para_* IDs stable across normalization
- **GIVEN** a document opened with normalization enabled
- **AND** the same document opened with normalization disabled
- **WHEN** `read_file` is called in both sessions
- **THEN** unchanged paragraphs SHALL receive the same `jr_para_*` identifiers regardless of normalization

### Requirement: Revision Extraction Returns Structured Per-Paragraph Diffs

The `extract_revisions` tool SHALL walk tracked-change markup in a session document and return a JSON array of per-paragraph revision records, each containing before text, after text, individual revision details, and associated comments. Paragraph matching uses `jr_para_*` bookmark IDs as primary keys across accepted/rejected clones, not positional traversal.

#### Scenario: [SDX-ER-001] extracting revisions from a document with insertions and deletions
- **GIVEN** a session containing a document with `w:ins` and `w:del` tracked changes
- **WHEN** `extract_revisions` is called with that session
- **THEN** the response contains a `changes` array with one entry per changed paragraph
- **AND** each entry has `para_id`, `before_text`, `after_text`, and `revisions[]`
- **AND** `before_text` reflects the document state with all changes rejected (deleted text restored via `w:delText` → `w:t` conversion)
- **AND** `after_text` reflects the document state with all changes accepted
- **AND** each revision has `type` (one of `INSERTION`, `DELETION`, `MOVE_FROM`, `MOVE_TO`, `FORMAT_CHANGE`), `text`, and `author`

#### Scenario: [SDX-ER-002] extracting revisions from a document with no tracked changes
- **GIVEN** a session containing a clean document with no tracked changes
- **WHEN** `extract_revisions` is called
- **THEN** the response has `total_changes: 0` and an empty `changes` array

#### Scenario: extracting revisions includes associated comments
- **GIVEN** a session containing a document with tracked changes and comments anchored to changed paragraphs
- **WHEN** `extract_revisions` is called
- **THEN** each changed paragraph entry includes a `comments[]` array
- **AND** each comment has `author`, `text`, and `date` (ISO 8601 string or null)
- **AND** threaded replies are nested under their parent comment

#### Scenario: property-only changes are included in extraction
- **GIVEN** a session containing a document with `w:rPrChange` or `w:pPrChange` elements
- **WHEN** `extract_revisions` is called
- **THEN** paragraphs with only formatting changes appear in the `changes` array
- **AND** the revision `type` is `FORMAT_CHANGE`

#### Scenario: inserted-only paragraph has empty before text
- **GIVEN** a session containing a document where a paragraph was entirely inserted (tracked)
- **WHEN** `extract_revisions` is called
- **THEN** the entry for that paragraph has `before_text: ""` and a non-empty `after_text`

#### Scenario: deleted-only paragraph has empty after text
- **GIVEN** a session containing a document where a paragraph was entirely deleted (tracked)
- **WHEN** `extract_revisions` is called
- **THEN** the entry for that paragraph has a non-empty `before_text` and `after_text: ""`

#### Scenario: changed paragraphs inside table cells are extracted
- **GIVEN** a session containing a document with tracked changes inside `w:tc` table cells
- **WHEN** `extract_revisions` is called
- **THEN** the changes array includes entries for those table-cell paragraphs

#### Scenario: structurally-empty inserted paragraphs are filtered out
- **GIVEN** a session containing a document with an empty paragraph bearing only a paragraph-level insertion marker (`w:pPr/w:rPr/w:ins`) and no text content
- **WHEN** `extract_revisions` is called
- **THEN** that paragraph is NOT included in the `changes` array
- **AND** `total_changes` does not count it

#### Scenario: real DOCX redline with tracked changes extracts correctly
- **GIVEN** a session opened from a real DOCX file containing tracked changes (insertions and deletions across multiple paragraphs)
- **WHEN** `extract_revisions` is called
- **THEN** `total_changes` is greater than zero
- **AND** each change has a non-empty `para_id`, at least one revision entry, and at least one of `before_text` or `after_text` non-empty
- **AND** revision types are all valid (`INSERTION`, `DELETION`, `MOVE_FROM`, `MOVE_TO`, or `FORMAT_CHANGE`)

### Requirement: Revision Extraction Supports Pagination

The `extract_revisions` tool SHALL support 0-based `offset` and `limit` parameters for paginating large revision sets. Results are ordered by document position for deterministic pagination.

#### Scenario: paginating through revisions with offset and limit
- **GIVEN** a session containing a document with more than 10 changed paragraphs
- **WHEN** `extract_revisions` is called with `limit: 5` and no offset
- **THEN** the response contains at most 5 entries in `changes`
- **AND** `total_changes` reflects the full count
- **AND** `has_more` is `true`

#### Scenario: retrieving subsequent pages with offset
- **GIVEN** a first call returned `has_more: true` with 5 results
- **WHEN** `extract_revisions` is called with `offset: 5, limit: 5`
- **THEN** the response contains the next page of results
- **AND** entries do not overlap with the first page

#### Scenario: offset beyond total returns empty page
- **GIVEN** a document with 3 changed paragraphs
- **WHEN** `extract_revisions` is called with `offset: 10`
- **THEN** the response has an empty `changes` array and `has_more: false`

#### Scenario: invalid limit is rejected
- **GIVEN** `extract_revisions` is called with `limit: 0` or `limit: 501`
- **WHEN** the tool validates the input
- **THEN** the response is an `INVALID_LIMIT` error with hint about valid range (1–500)

#### Scenario: invalid offset is rejected
- **GIVEN** `extract_revisions` is called with `offset: -1`
- **WHEN** the tool validates the input
- **THEN** the response is an `INVALID_OFFSET` error

### Requirement: Revision Extraction Is Read-Only and Cached

The `extract_revisions` tool SHALL NOT mutate the session document. The cloned accept/reject operations used to derive before/after text operate on ephemeral copies. Extraction results SHALL be cached per session by `edit_revision` to avoid recomputation during pagination.

#### Scenario: session document is unchanged after extraction
- **GIVEN** a session with tracked changes and a known `edit_revision`
- **WHEN** `extract_revisions` is called
- **THEN** the session's `edit_revision` is unchanged
- **AND** a subsequent `read_file` returns the same content as before extraction

#### Scenario: repeated extraction at same revision uses cache
- **GIVEN** an extraction was already computed for the current `edit_revision`
- **WHEN** `extract_revisions` is called again (e.g. for page 2)
- **THEN** the response is served from cache without recomputing
- **AND** `total_changes` is consistent with the first call

#### Scenario: new edit invalidates extraction cache
- **GIVEN** an extraction was cached for `edit_revision` N
- **WHEN** an edit creates `edit_revision` N+1
- **THEN** the next `extract_revisions` call recomputes from the updated document

### Requirement: Revision Extraction Requires Session Context

The `extract_revisions` tool SHALL require a session (via `session_id` or `file_path`) to provide the document with tracked changes.

#### Scenario: missing session context returns error
- **GIVEN** no `session_id` or `file_path` is provided
- **WHEN** `extract_revisions` is called
- **THEN** the response is `MISSING_SESSION_CONTEXT` error

#### Scenario: two-file comparison then extraction workflow
- **GIVEN** a redline DOCX produced by `compare_documents` and saved to disk
- **WHEN** `extract_revisions` is called with `file_path` pointing to the redline
- **THEN** the revisions are extracted from the redline document
- **AND** the response contains the structured diff

### Requirement: Formatting-Preserving Replacement with Run Normalization
The Safe-Docx MCP server SHALL support formatting-preserving text replacement via `smart_edit`, with an optional `normalize_first` flag to merge fragmented runs before searching.

#### Scenario: replace_text performs formatting-preserving replacement
- **GIVEN** a document paragraph targeted by stable `jr_para_*` identity
- **WHEN** `smart_edit` is called with a unique `old_string` and `new_string`
- **THEN** the server SHALL apply the replacement deterministically
- **AND** SHALL preserve surrounding run formatting as closely as possible

#### Scenario: replace_text can normalize fragmented runs before search
- **GIVEN** matching text is fragmented across adjacent format-identical runs
- **WHEN** `smart_edit` is called with `normalize_first` enabled
- **THEN** the server SHALL normalize mergeable runs before search
- **AND** SHALL apply replacement only after post-normalization uniqueness is confirmed

### Requirement: Comment and Reply Authoring
The Safe-Docx MCP server SHALL provide an `add_comment` helper tool that supports root comments and threaded replies with deterministic OOXML wiring.

#### Scenario: add root comment to target range
- **GIVEN** a document and a caller-provided comment body and author metadata
- **WHEN** `add_comment` is called for a target paragraph/range
- **THEN** the server SHALL create a comment entry and anchor markers in OOXML
- **AND** the saved document SHALL display the comment in Microsoft Word

#### Scenario: add threaded reply linked to parent comment
- **GIVEN** an existing parent comment ID
- **WHEN** `add_comment` is called with `parent_comment_id`
- **THEN** the server SHALL create a reply comment linked to that parent
- **AND** thread linkage metadata SHALL be persisted in the appropriate comment extension part

#### Scenario: comment parts are bootstrapped when missing
- **GIVEN** a DOCX file with no existing comment parts
- **WHEN** `add_comment` is called
- **THEN** the server SHALL create required comment XML parts from packaged templates
- **AND** SHALL add required relationship/content-type entries for those parts

### Requirement: Run Consolidation and Redline Simplification (Internal Primitives)
The Safe-Docx MCP server SHALL apply run consolidation and redline simplification as internal primitives during normalize-on-open, ensuring clean document state for downstream tools.

#### Scenario: merge_runs consolidates adjacent format-identical runs
- **WHEN** a document containing mergeable adjacent runs is opened
- **THEN** the server SHALL merge adjacent runs whose effective run properties are equivalent
- **AND** SHALL preserve visible text order and paragraph structure

#### Scenario: simplify_redlines merges adjacent same-author tracked wrappers
- **GIVEN** adjacent tracked-change wrappers (`w:ins` or `w:del`) from the same author
- **WHEN** a document is opened with normalization enabled
- **THEN** the server SHALL merge adjacent wrappers of the same change type
- **AND** SHALL NOT merge across different change types or non-whitespace separators

#### Scenario: simplify_redlines reports tracked-change author summary
- **WHEN** a document with tracked changes is opened
- **THEN** the server SHALL return normalization statistics including tracked-change consolidation counts
- **AND** SHALL provide normalization metadata in the open response

### Requirement: Document Validation and Auto-Repair (Internal Primitives)
The Safe-Docx MCP server SHALL apply document validation as an internal primitive during download, and auto-repair as an internal primitive during normalize-on-open.

#### Scenario: validate packed or unpacked DOCX inputs
- **WHEN** a document is downloaded via the `download` tool
- **THEN** the server SHALL validate the document before output
- **AND** SHALL return structured pass/fail diagnostics on validation failure

#### Scenario: redline validation runs when original baseline is provided
- **GIVEN** an edited document with a baseline (original file retained in session)
- **WHEN** the document is downloaded in clean format
- **THEN** the server SHALL run validation checks against the edited content
- **AND** SHALL produce a valid output file

#### Scenario: auto-repair fixes known safe issues
- **GIVEN** a document containing known safe issues (e.g., proofErr elements, fragmented runs)
- **WHEN** the document is opened with normalization enabled
- **THEN** the server SHALL repair supported issue classes during normalization
- **AND** the repaired content SHALL remain accessible through standard read operations

### Requirement: Deterministic Layout Formatting Tool
The Safe-Docx MCP server SHALL provide a deterministic `format_layout` tool to mutate document layout geometry without changing paragraph text content.

#### Scenario: format paragraph spacing by paragraph ID
- **GIVEN** an active Safe-Docx session with known `jr_para_*` IDs
- **WHEN** `format_layout` is called with `paragraph_spacing` targeting one or more paragraph IDs
- **THEN** the server SHALL set OOXML paragraph spacing values on those paragraphs
- **AND** SHALL return the count of affected paragraphs

#### Scenario: format table row height and cell padding
- **GIVEN** an active session containing one or more tables
- **WHEN** `format_layout` is called with `row_height` and/or `cell_padding` selectors
- **THEN** the server SHALL set the requested table geometry values in OOXML
- **AND** SHALL return affected row/cell counts

#### Scenario: invalid layout values are rejected with structured error
- **WHEN** `format_layout` receives invalid enum values, negative geometry units, or malformed selectors
- **THEN** the server SHALL reject the request with a structured error response
- **AND** SHALL include remediation guidance in the error hint

### Requirement: Layout Mutations Preserve Document Identity
Layout formatting operations SHALL preserve paragraph identity and text structure.

#### Scenario: no spacer paragraphs are introduced
- **GIVEN** a document with N paragraphs before layout formatting
- **WHEN** `format_layout` is applied
- **THEN** the document SHALL still contain N paragraphs
- **AND** no empty spacer paragraph SHALL be inserted as a layout workaround

#### Scenario: paragraph IDs remain stable after layout formatting
- **GIVEN** a document with existing `jr_para_*` identifiers
- **WHEN** `format_layout` mutates paragraph spacing or table geometry
- **THEN** existing paragraph IDs SHALL remain addressable and unchanged for untouched paragraphs

### Requirement: Runtime Dependency Boundary for Safe-Docx
Safe-Docx runtime distribution SHALL remain Node/TypeScript-only and SHALL NOT require Aspose/Python runtime dependencies for layout formatting.

#### Scenario: npx runtime remains Python-free
- **WHEN** a user installs and runs `npx @usejunior/safe-docx`
- **THEN** layout formatting functionality SHALL be available without Python or Aspose runtime installation

#### Scenario: format_layout does not invoke external process tooling at runtime
- **GIVEN** a running Safe-Docx MCP session
- **WHEN** `format_layout` is called
- **THEN** the operation SHALL complete without invoking external process execution APIs
- **AND** no Python/Aspose runtime process SHALL be required

### Requirement: Plan Initialization for Coordinated Multi-Agent Editing
The Safe-Docx MCP server SHALL provide an `init_plan` tool that emits plan-context metadata for orchestrating multiple sub-agent plan submissions against a shared document revision.

#### Scenario: init_plan returns revision-bound context
- **WHEN** `init_plan` is called with `session_id` or `file_path`
- **THEN** the server returns a plan context containing resolved session/file metadata
- **AND** includes `base_revision` derived from the active editing session
- **AND** includes a generated `plan_context_id` for caller-side audit correlation

#### Scenario: init_plan uses file-first session resolution
- **WHEN** `init_plan` is called with `file_path` and no `session_id`
- **THEN** the server resolves a session using standard file-first behavior
- **AND** returns `resolved_session_id` and `resolved_file_path`

### Requirement: Deterministic Plan Merge and Conflict Analysis
The Safe-Docx MCP server SHALL provide `merge_plans` to deterministically combine multiple sub-agent plans and detect structural conflicts before apply.

#### Scenario: merge_plans returns merged artifact when no conflicts
- **GIVEN** multiple valid plans sharing one `base_revision`
- **AND** no hard conflicts are detected
- **WHEN** `merge_plans` is called
- **THEN** the server returns `has_conflicts=false`
- **AND** returns a deterministic `merged_plan` artifact preserving stable step order

#### Scenario: merge_plans reports base-revision conflict
- **GIVEN** plans with mismatched `base_revision` values
- **WHEN** `merge_plans` is called
- **THEN** the server reports a `BASE_REVISION_CONFLICT`

#### Scenario: merge_plans reports overlapping replace ranges
- **GIVEN** two replace steps targeting the same paragraph with overlapping `[start,end)` ranges
- **WHEN** `merge_plans` is called
- **THEN** the server reports `OVERLAPPING_REPLACE_RANGE`

#### Scenario: merge_plans reports unknown-range conflict for same paragraph
- **GIVEN** two replace steps targeting the same paragraph
- **AND** one or both steps omit explicit range metadata
- **WHEN** `merge_plans` is called
- **THEN** the server reports `UNKNOWN_REPLACE_RANGE`

#### Scenario: merge_plans reports insert-slot collision
- **GIVEN** two insert steps targeting the same anchor paragraph and same insertion position
- **WHEN** `merge_plans` is called
- **THEN** the server reports `INSERT_SLOT_COLLISION`

#### Scenario: merge_plans reports duplicate step IDs
- **GIVEN** two submitted steps share the same `step_id`
- **WHEN** `merge_plans` is called
- **THEN** the server reports `DUPLICATE_STEP_ID`

#### Scenario: merge_plans fails by default when conflicts exist
- **GIVEN** one or more hard conflicts are detected
- **WHEN** `merge_plans` is called without overriding conflict behavior
- **THEN** the server returns an error result with conflict diagnostics

#### Scenario: merge_plans can return diagnostics without hard failure
- **GIVEN** one or more hard conflicts are detected
- **WHEN** `merge_plans` is called with `fail_on_conflict=false`
- **THEN** the server returns success with `has_conflicts=true`
- **AND** includes conflict diagnostics and a partial merged artifact for caller review

### Requirement: Canonical Edit and Insert Naming Only
The Safe-Docx MCP surface SHALL expose canonical mutation tool names and SHALL NOT expose legacy smart aliases.

#### Scenario: canonical names are advertised
- **WHEN** clients request the MCP tool catalog
- **THEN** canonical names `replace_text` and `insert_paragraph` are listed

#### Scenario: legacy aliases are unavailable
- **WHEN** clients inspect the MCP tool catalog
- **THEN** `smart_edit` and `smart_insert` are not listed

#### Scenario: legacy aliases are rejected inside plan operations
- **GIVEN** a merge plan step declares `operation: smart_edit` or `operation: smart_insert`
- **WHEN** `merge_plans` validates that step
- **THEN** the step is rejected with an unsupported operation conflict

### Requirement: MCP Tool Catalog Uses File-First Entry Without open_document
The MCP-exposed tool surface SHALL rely on file-first session entry and SHALL NOT expose `open_document` as a callable MCP tool.

#### Scenario: MCP catalog omits open_document
- **WHEN** clients request the MCP tool catalog
- **THEN** `open_document` is not listed
- **AND** file-first document tools remain available for session auto-resolution

#### Scenario: open_document call is rejected as unsupported
- **WHEN** a client attempts to call `open_document` via MCP
- **THEN** the server returns an unknown/unsupported tool error
- **AND** error guidance directs callers to file-first tool calls (`read_file`, `grep`, `replace_text`, `insert_paragraph`, `download`, `get_session_status`)

