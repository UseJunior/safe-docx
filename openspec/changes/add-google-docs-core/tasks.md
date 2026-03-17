## 1. Package Foundation
- [x] 1.1 Create package.json with @usejunior/google-docs-core name and googleapis dependency
- [x] 1.2 Create tsconfig.build.json and tsconfig.json
- [x] 1.3 Create barrel export (src/index.ts)

## 2. Document Model
- [x] 2.1 Implement GoogleDocsDocument class with static load() factory
- [x] 2.2 Implement tab-aware document parsing (extractTabs, getTabBody)
- [x] 2.3 Implement paragraph text extraction with inline object and autoText handling
- [x] 2.4 Implement table cell parsing with full metadata (row/col, header detection, paraInCell, colHeader)
- [x] 2.5 Fix paraInCell counter — increment within multi-paragraph cells (was always 0)

## 3. Anchors & Index Tracking
- [x] 3.1 Implement named range anchor injection (buildNamedRangeInjectionRequests)
- [x] 3.2 Implement anchor extraction from tab-level namedRanges
- [x] 3.3 Implement anchor-to-paragraph matching by startIndex proximity
- [x] 3.4 Implement anchor cleanup (buildAnchorCleanupRequests)
- [x] 3.5 Implement IndexTracker for UTF-16 surrogate pair accounting

## 4. Write Operations & Formatting
- [x] 4.1 Implement replaceText with delete+insert at UTF-16 offsets
- [x] 4.2 Implement insertParagraph BEFORE/AFTER with automatic anchor injection
- [x] 4.3 Fix insertParagraph AFTER — use endIndex - 1 to stay within paragraph bounds
- [x] 4.4 Implement buildBatchUpdateRequests with reverse-index ordering
- [x] 4.5 Implement buildParagraphStyleRequest for alignment and indent

## 5. Supporting Infrastructure
- [x] 5.1 Implement resolveCredentials for SA + OAuth2 authentication
- [x] 5.2 Implement error mapping (mapGoogleError) with retry strategies
- [x] 5.3 Implement withRetry with exponential backoff and jitter
- [x] 5.4 Implement concurrency control (revisionId-based writeControl)
- [x] 5.5 Implement save semantics (checkpoint, pin, snapshot)
- [x] 5.6 Implement document view builder (buildDocumentViewNodes)

## 6. Testing
- [x] 6.1 Unit tests for anchors (17 tests)
- [x] 6.2 Unit tests for tabs (7 tests)
- [x] 6.3 Unit tests for concurrency (6 tests)
- [x] 6.4 Unit tests for errors (18 tests)
- [x] 6.5 Unit tests for write-operations (8 tests)
- [x] 6.6 Unit tests for index-tracker (27 tests)
- [x] 6.7 Unit tests for types (11 tests)
- [x] 6.8 Unit tests for document-view (5 tests)
- [x] 6.9 Unit tests for save (5 tests)
- [x] 6.10 Unit tests for bookmarks compat (5 tests)
- [x] 6.11 Unit tests for document.ts bug fixes — paraInCell counter + insertParagraph endIndex-1 (5 tests)
- [x] 6.12 E2E tests — 35 tests across 8 phases with 2-doc isolation
- [x] 6.13 DRY E2E test helpers (RICH_DOC_CONTENT, getRawParagraphStyle, getMultiParaCellParagraphs)
- [x] 6.14 Fix test:e2e script (replace Jest --testPathPattern with vitest path filter)

## 7. OpenSpec
- [x] 7.1 Create change proposal
- [x] 7.2 Create tasks checklist
- [x] 7.3 Create capability spec with scenarios
