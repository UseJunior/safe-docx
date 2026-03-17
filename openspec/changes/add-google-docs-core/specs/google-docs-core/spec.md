## ADDED Requirements

### Requirement: Document Loading and Structure

The system SHALL load a Google Docs document by ID via the Docs API v1 with `includeTabsContent=true`. The `GoogleDocsDocument` class SHALL cache the document structure including all paragraphs (body and table), tables, tabs, and revision ID. The cache SHALL be refreshable via `fetchDocument()`.

#### Scenario: [GDC-01] Load document and cache structure
- **WHEN** `GoogleDocsDocument.load(docId, credentials)` is called with valid credentials
- **THEN** the document is fetched, paragraphs and tables are parsed, and the structure cache is populated

#### Scenario: [GDC-02] Tab-aware parsing extracts tab metadata
- **WHEN** a document has one or more tabs
- **THEN** each tab's `tabId` and `title` are extracted and paragraphs are tagged with their tab ID

### Requirement: Table Cell Metadata

The system SHALL parse table cells with full metadata including `tableIndex`, `tableId`, `rowIndex`, `colIndex`, `totalRows`, `totalCols`, `isHeaderRow`, `paraInCell`, `cellParaCount`, and `colHeader`. Column headers SHALL be extracted from the first row of each table.

#### Scenario: [GDC-03] Table paragraphs have complete metadata
- **WHEN** a document contains a table
- **THEN** each cell paragraph has `tableMetadata` with correct row/column indices, header detection, and grid dimensions

#### Scenario: [GDC-04] Multi-paragraph cells track paraInCell
- **WHEN** a table cell contains multiple paragraphs
- **THEN** `paraInCell` increments from 0 for each paragraph within the cell, and `cellParaCount` reflects the total

#### Scenario: [GDC-05] paraInCell resets between cells
- **WHEN** consecutive table cells each contain paragraphs
- **THEN** the `paraInCell` counter resets to 0 at the start of each new cell

### Requirement: Named Range Anchors

The system SHALL use Google Docs Named Ranges with the `_bk_` prefix as stable paragraph anchors. Anchors SHALL be injected at `startIndex` to `startIndex+1` for each unanchored paragraph. Anchor names SHALL be generated as `_bk_` followed by a zero-padded 12-digit hex counter.

#### Scenario: [GDC-06] Inject anchors into all paragraphs
- **WHEN** `injectAnchors()` is called on a document with unanchored paragraphs
- **THEN** each paragraph receives a unique `_bk_`-prefixed named range anchor

#### Scenario: [GDC-07] Anchors survive re-fetch and fresh load
- **WHEN** the document is re-fetched or loaded fresh after anchor injection
- **THEN** all previously injected anchors are still present and matched to their paragraphs

#### Scenario: [GDC-08] Read paragraph by anchor ID
- **WHEN** `getParagraphTextById(anchorId)` is called with a valid anchor
- **THEN** the paragraph text is returned for both body and table cell paragraphs

### Requirement: Text Replacement

The system SHALL support replacing text within a paragraph identified by anchor ID. The replacement SHALL use delete+insert at UTF-16 code unit offsets. The system SHALL throw `TEXT_NOT_FOUND` if the find text is not in the paragraph, and `ANCHOR_NOT_FOUND` if the anchor does not exist.

#### Scenario: [GDC-09] Replace text in body paragraph
- **WHEN** `replaceText(anchorId, findText, replaceWith)` is called
- **THEN** the matching text is replaced and the document is re-fetched

#### Scenario: [GDC-10] Replace text in table cell
- **WHEN** `replaceText` is called targeting a table cell paragraph
- **THEN** the cell text is updated correctly

### Requirement: Paragraph Insertion

The system SHALL support inserting new paragraphs BEFORE or AFTER an anchored paragraph. For AFTER insertion, the insert index SHALL be `endIndex - 1` (before the trailing newline, within paragraph bounds). For BEFORE insertion, the insert index SHALL be `startIndex`. The new paragraph SHALL receive an anchor via automatic `injectAnchors()`.

#### Scenario: [GDC-11] Insert paragraph AFTER uses endIndex - 1
- **WHEN** `insertParagraph(anchorId, 'AFTER', text)` is called
- **THEN** the text is inserted at `endIndex - 1` with a leading `\n`, and the new paragraph receives an anchor

#### Scenario: [GDC-12] Insert paragraph BEFORE uses startIndex
- **WHEN** `insertParagraph(anchorId, 'BEFORE', text)` is called
- **THEN** the text is inserted at `startIndex` with a trailing `\n`, and the new paragraph receives an anchor

#### Scenario: [GDC-13] Existing anchor survives adjacent insertion
- **WHEN** a paragraph is inserted before or after an existing anchored paragraph
- **THEN** the original paragraph's anchor remains valid and resolves to the correct text

### Requirement: Paragraph Styling

The system SHALL support applying paragraph styles via `buildParagraphStyleRequest()` including alignment and indentation. Style requests SHALL include `tabId` when operating on a specific tab.

#### Scenario: [GDC-14] Apply alignment style
- **WHEN** a CENTER alignment request is executed via `executeBatchUpdate`
- **THEN** the paragraph's `paragraphStyle.alignment` is updated to `CENTER`

#### Scenario: [GDC-15] Apply first-line indent
- **WHEN** a first-line indent request is executed
- **THEN** the paragraph's `paragraphStyle.indentFirstLine.magnitude` reflects the specified value

### Requirement: UTF-16 Index Math

The system SHALL account for UTF-16 encoding in all index calculations. Emoji characters that are surrogate pairs (above U+FFFF) SHALL be counted as 2 code units. BMP characters (including CJK) SHALL be counted as 1 code unit. The `IndexTracker` SHALL provide `countSurrogatePairs()` for validation.

#### Scenario: [GDC-16] Emoji surrogate pair accounting
- **WHEN** a paragraph contains emoji above U+FFFF (e.g., 🎉)
- **THEN** `countSurrogatePairs` returns the correct count and `endIndex - startIndex` equals `text.length + 1`

#### Scenario: [GDC-17] CJK BMP characters
- **WHEN** a paragraph contains CJK characters (BMP range)
- **THEN** `countSurrogatePairs` returns 0 and index math is correct

### Requirement: Batch Update Ordering

`buildBatchUpdateRequests()` SHALL sort edit operations in descending order by `startIndex` to prevent index drift when applying multiple edits in a single batch.

#### Scenario: [GDC-18] Reverse index ordering
- **WHEN** multiple edit operations are submitted with varying start indices
- **THEN** the resulting requests are ordered from highest to lowest start index

### Requirement: Error Handling

The system SHALL map Google API HTTP error codes to MCP error codes via `mapGoogleError()`. The system SHALL throw `TEXT_NOT_FOUND` for missing find text, `ANCHOR_NOT_FOUND` for invalid anchor IDs, and `NOT_FOUND` for invalid document IDs. Retriable errors (429, 500, 503) SHALL be retried with exponential backoff and jitter.

#### Scenario: [GDC-19] TEXT_NOT_FOUND error
- **WHEN** `replaceText` is called with text not present in the paragraph
- **THEN** the error message contains `TEXT_NOT_FOUND`

#### Scenario: [GDC-20] NOT_FOUND for invalid document
- **WHEN** `GoogleDocsDocument.load` is called with a nonexistent document ID
- **THEN** `mapGoogleError` maps the error to code `NOT_FOUND`

### Requirement: Concurrency Control

The system SHALL track the document revision ID and use `writeControl.requiredRevisionId` on all batch updates. The revision SHALL update after each successful write. `isRevisionFresh()` SHALL return true if the revision was fetched within 23 hours.

#### Scenario: [GDC-21] Revision changes after edit
- **WHEN** a batch update is executed
- **THEN** the stored revision ID is updated to the new value from the response

#### Scenario: [GDC-22] Anchor cleanup and re-injection
- **WHEN** all `_bk_` named ranges are deleted and `injectAnchors()` is called
- **THEN** new anchors are injected for all paragraphs
