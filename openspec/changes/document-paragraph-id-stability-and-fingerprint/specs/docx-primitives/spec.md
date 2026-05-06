# docx-primitives delta — rename `jr_para_*` → `_bk_*`

## MODIFIED Requirements

### Requirement: Paragraph Bookmark Identity

The bookmark engine SHALL mint and persist stable `_bk_*` identifiers for paragraphs, ensuring unique addressability and idempotent allocation.

`_bk_*` identifiers are deterministic. The engine SHALL prefer the document's intrinsic Word `w14:paraId` when present, and SHALL otherwise derive identifiers from a deterministic hash of the paragraph's normalized visible text together with neighbor and ancestor context. Collision resolution SHALL append a deterministic salt suffix (`|salt:N` for `N=1..9999`) to the seed prior to hashing, ensuring unique addressability for duplicate-content paragraphs.

#### Scenario: insertParagraphBookmarks mints IDs matching expected pattern
- **WHEN** `insertParagraphBookmarks` is called on a document with paragraphs lacking bookmarks
- **THEN** each paragraph SHALL receive a `_bk_*` identifier matching the pattern `_bk_[0-9a-f]{12}`

#### Scenario: getParagraphBookmarkId retrieves minted ID
- **GIVEN** a paragraph with a previously minted `_bk_*` bookmark
- **WHEN** `getParagraphBookmarkId` is called
- **THEN** the result SHALL return the stable identifier

#### Scenario: Identifiers are stable across reopens of the same document
- **GIVEN** a document opened twice in independent processes with no content changes
- **WHEN** `insertParagraphBookmarks` runs on both opens
- **THEN** equivalent paragraphs SHALL receive byte-identical `_bk_*` identifiers
