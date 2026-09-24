## ADDED Requirements

### Requirement: Merge-aware table row edits require explicit opt-in

Row insertion and deletion invoked without an explicit merge-aware opt-in SHALL reject a target table containing `w:gridSpan` or `w:vMerge` before mutation. Adding a logical occupancy inventory SHALL NOT relax this compatibility boundary implicitly.

#### Scenario: [SDX-MERGEDROW-GUARD-01] default row edits still refuse merged tables
- **GIVEN** a valid body-level table with a vertical merge or horizontal span
- **WHEN** a caller requests row insertion or deletion without a merge-aware opt-in
- **THEN** the operation SHALL fail with `UNSUPPORTED_EDIT` and a coordinate-level feature diagnostic
- **AND** serialized XML and the revision-ID state SHALL remain unchanged

### Requirement: Read-only logical occupancy precedes merge-aware row edits

The engine SHALL inventory direct physical cells against `w:tblGrid` in logical
column coordinates without rewriting source XML. A physical `w:gridSpan` cell
owns its full horizontal interval; each `w:vMerge` continuation SHALL refer to
an immediately preceding, equal-width restart-owned interval. Explicit
`w:gridBefore` and `w:gridAfter` offsets SHALL be represented as empty grid slots,
not synthetic cells. The inventory SHALL fail closed on wrapped row/cell
containers, legacy `w:hMerge`, malformed arithmetic, orphan continuations, and
pending topology revisions. This read-only inventory does not by itself admit
vertical row mutations.

#### Scenario: [SDX-MERGEDROW-INV-01] rectangular merge ownership is stable
- **GIVEN** a table with a two-dimensional rectangular vertical merge and an omitted-value continuation
- **WHEN** the logical occupancy inventory is built
- **THEN** each continuation slot SHALL point to the original restart owner and source XML SHALL remain unchanged

#### Scenario: [SDX-MERGEDROW-INV-02] invalid or unmodeled topology fails closed
- **GIVEN** an orphan or changed-width continuation, a grid overfill or implicit hole, a wrapped row, a pending cell topology revision, or legacy `w:hMerge`
- **WHEN** the logical occupancy inventory is built
- **THEN** it SHALL reject with a coordinate-level diagnostic instead of silently skipping the structure

### Requirement: Explicit horizontal-span row operations

With `mergeAware: true`, row insertion and deletion SHALL admit a body-level
table with valid horizontal `w:gridSpan` cells but no vertical merge, row
offset, legacy `w:hMerge`, or other unsupported topology. `cellTexts` SHALL
contain one value per new physical cell, and the new row SHALL copy only safe
formatting and physical-cell geometry from its anchor row. Clean and tracked
operations SHALL preserve inverse row projections and unaffected content.
Resolving a selected row marker SHALL remove a now-empty `w:trPr`; an authored
empty source `w:trPr` is normalized to schema-equivalent absence at that
specific boundary. This opt-in is experimental and SHALL remain absent from
MCP and Markdoc until vertical-merge semantics and a Word oracle are complete.

#### Scenario: [SDX-MERGEDROW-01] horizontal insertion clones geometry only
- **GIVEN** a valid table with a horizontally spanning physical cell
- **WHEN** a caller inserts a row beside it with `mergeAware: true` and one text value per physical cell
- **THEN** the new row SHALL preserve the span geometry without cloning the anchor's authored text or identifiers

#### Scenario: [SDX-MERGEDROW-02] tracked horizontal edits have inverse projections
- **GIVEN** a valid table with a horizontally spanning physical cell
- **WHEN** a caller inserts or deletes a row in tracked mode with `mergeAware: true`
- **THEN** accept-all SHALL equal the clean edit and reject-all SHALL equal the source outside the explicitly normalized empty-`w:trPr` boundary

#### Scenario: [SDX-MERGEDROW-05] legacy horizontal merge is not misread
- **GIVEN** a table containing legacy `w:hMerge`
- **WHEN** insertion or deletion is requested with or without `mergeAware: true`
- **THEN** the operation SHALL fail before mutation and SHALL not consume a revision ID

#### Scenario: [SDX-MERGEDROW-06] empty row properties normalize explicitly
- **GIVEN** a row with an authored-empty `w:trPr`
- **WHEN** its tracked deletion is rejected
- **THEN** the row SHALL be restored exactly except that the empty `w:trPr` is removed

## MODIFIED Requirements

### Requirement: Ambiguous table topology fails closed

By default, row operations SHALL reject `w:gridSpan`, `w:hMerge`, `w:vMerge`,
`w:gridBefore`, `w:gridAfter`, nested tables, `w:tblPrEx`, wrapped row/cell
containers, heterogeneous direct occupancy, missing trailing cell paragraphs,
and topology revision records. An explicit `mergeAware: true` SHALL admit only
the validated horizontal-span subset above; it SHALL continue to reject
vertical merges, row offsets, legacy `w:hMerge`, and other unsupported
topology. Ordinary content revisions and row-level markers SHALL remain
admissible; tracked deletion of a row already marked inserted or deleted
SHALL fail. Failed tracked operations SHALL leave both serialized XML and
`ctx.idState.nextId` unchanged.

#### Scenario: [SDX-TABLEROW-07] merge, wrapper, and nested-table guards are table-wide
- **GIVEN** a target table containing a span, vertical merge, row offset, nested table, `w:tblPrEx`, or wrapped row/cell anywhere
- **WHEN** insertion or deletion is requested against any row without `mergeAware: true`
- **THEN** the operation SHALL fail before mutation
- **AND** `SafeDocxError` code SHALL be `UNSUPPORTED_EDIT`
- **AND** its detail SHALL identify the unsupported feature and row/cell or child coordinate

#### Scenario: [SDX-TABLEROW-08] malformed and topology-revised tables are transactional
- **GIVEN** heterogeneous occupancy, a cell not ending in a direct paragraph, a topology revision, an invalid value count, or final-row deletion
- **WHEN** insertion or deletion is requested, including with `mergeAware: true` when applicable
- **THEN** the operation SHALL fail without changing serialized document XML
- **AND** the error SHALL distinguish `UNSUPPORTED_EDIT` topology from `INVALID_ARGUMENT` input
- **AND** `ctx.idState.nextId` SHALL be unchanged
