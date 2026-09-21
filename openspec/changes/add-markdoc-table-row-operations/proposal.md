# Change: Add Markdoc Table-Row Operations

## Why

Canonical Markdoc can edit paragraphs inside existing table cells, and
docx-core can now insert or delete rows in a bounded rectangular table, but no
Markdoc syntax connects those layers. A canonical build that needs several new
rows still requires an out-of-band OOXML step even though the safe structural
primitive and tracked comparison support already exist.

## What Changes

- Add canonical Markdoc syntax for inserting one or more rows before or after
  an anchored source row and for deleting an anchored source row.
- Represent each inserted row as an ordered list of exact plain-text cell
  attributes and apply
  a multi-row insertion as one attributable operation in authored order.
- Reuse docx-core's bounded table validation and safe formatting shell; retain
  its fail-closed rules for merges, spans, offsets, nested tables, wrapped
  topology, malformed cells, topology revisions, and final-row deletion.
- Extend tagged comparison so pure row insertion/deletion independently marks
  row topology, paragraph marks, and cell run contents as ECMA-376 requires.
- Verify source/reject and clean/accept table topology explicitly, in addition
  to the existing text and formatting projections.
- Document the new Markdoc surface in the package README and
  `packages/docx-core/SUPPORT.md`, and
  add canonical-emission regression coverage for native row markers.

## Impact

- Affected specs: pending `docx-markdoc` capability from
  `add-brownfield-markdoc-authoring`; canonical `docx-comparison` behavior for
  complete whole-row revision emission.
- Affected code: `packages/docx-markdoc` parser, IR, compiler, certificate,
  tests, and CLI documentation; `packages/docx-compare` row serialization and
  rationale attribution; `packages/docx-core/src/primitives/comments.ts`
  property-container safety; and `packages/docx-core/SUPPORT.md` plus
  canonical-emission coverage.
- Dependencies: builds on the merged `add-structural-table-row-operations`
  docx-core contract and tagged comparator row emission.
- Compatibility: additive. Existing Markdoc remains valid and documents with
  no structural row operations follow the unchanged compilation path.
- Scope boundary: this exposes the admitted rectangular-row primitive only;
  it does not add columns, cells, merged-grid transformations, or arbitrary
  table cloning.
