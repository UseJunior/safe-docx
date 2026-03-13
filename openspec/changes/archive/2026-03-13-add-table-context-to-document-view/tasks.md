## 1. Implementation
- [x] 1.1 Add `isW()` and `getDirectChildrenByName()` to `dom-helpers.ts`
- [x] 1.2 Update `tables.ts` to import shared helpers from `dom-helpers.ts`
- [x] 1.3 Add `TableContext` type and extend `DocumentViewNode` in `document_view.ts`
- [x] 1.4 Update `buildNodesForDocumentView()` to accept and pass through `tableContext`
- [x] 1.5 Add `formatToonDataLine()`, `collectTableMarkerInfo()`, `formatTableMarker()` helpers
- [x] 1.6 Update `renderToon()` to emit `#TABLE`/`#END_TABLE` markers with `th(r,c)`/`td(r,c)` styles
- [x] 1.7 Add `buildTableMetaMap()` and `deriveTableContext()` in `document.ts`
- [x] 1.8 Augment `buildDocumentView()` with ancestor-derived table context
- [x] 1.9 Fix `renderToonWithBudget()` to use `formatToonDataLine()` directly
- [x] 1.10 Update `renderSimpleWithBudget()` and non-budget simple format for table markers
- [x] 1.11 Remove private `isW` from `document.ts`, import from `dom-helpers.ts`

## 2. Testing
- [x] 2.1 Simple table context test (2-row x 3-col)
- [x] 2.2 Paragraph parity test (IDs match order)
- [x] 2.3 `w:ins`-wrapped row test
- [x] 2.4 `gridSpan` grid-aware coordinates test
- [x] 2.5 `vMerge` continuation cell test
- [x] 2.6 Multi-paragraph cell test (para_in_cell)
- [x] 2.7 Empty table cell preservation test
- [x] 2.8 Multiple tables test (table_index/table_id)
- [x] 2.9 Mixed body content test
- [x] 2.10 Nested table test (inner paragraphs get outer cell context)
- [x] 2.11 `renderToon` #TABLE/#END_TABLE markers test
- [x] 2.12 `renderToon` th/td style test
- [x] 2.13 `formatToonDataLine` test
- [x] 2.14 `collectTableMarkerInfo` + `formatTableMarker` test
- [x] 2.15 Table markers in toon pagination output
- [x] 2.16 #TABLE markers don't inflate paragraphsReturned
- [x] 2.17 Table markers in simple format
- [x] 2.18 table_context in JSON format

## 3. OpenSpec
- [x] 3.1 Create change proposal
- [x] 3.2 Create tasks checklist
- [x] 3.3 Create delta specs for docx-primitives and mcp-server
