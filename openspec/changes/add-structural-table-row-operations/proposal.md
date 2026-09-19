# Change: Add Structural Table Row Operations

## Why

safe-docx can now edit paragraphs inside existing table cells, but callers still
need direct OOXML surgery to add or remove rows. That gap blocks form updates
whose repeated records live in tables and prevents tracked accept/reject from
proving the two required table topologies.

Issue #764 ultimately covers a full logical grid model, columns, cells, merges,
and comparison. This change is its deliberately bounded first implementation:
rectangular, unmerged rows in existing body-level tables.

## What Changes

- Add docx-core operations that insert a row before or after an anchored row and
  delete an anchored row, in clean or tracked mode.
- Address rows through an existing paragraph bookmark so a caller does not rely
  on unstable raw XML indexes, and return new paragraph anchors so callers can
  chain multiple row insertions in one tracked document.
- Clone the selected row's row/cell formatting shell for insertion, populate one
  paragraph per supplied cell, strip cloned bookmarks, and guarantee every cell
  ends in a direct `w:p`.
- Emit `w:trPr > w:ins` and `w:trPr > w:del` plus corresponding paragraph-mark
  and run-content revisions for tracked insertion and deletion, and teach
  accept/reject to resolve row markers semantically in every processed story.
- Validate the entire target body-level table before mutation and fail
  transactionally unless it is a rectangular, unmerged table whose direct rows
  contain no nested tables or unsupported topology revisions. Pre-existing text
  revisions and row markers remain admissible so multiple tracked row operations
  can compose before accept/reject.
- Preserve the selected row's direct formatting/property shell without copying
  bookmark identities, paragraph text, fields, comments, or revisions into an
  inserted row.

## Impact

- Affected specs: `docx-primitives`.
- Affected code: table-addressing and row-mutation primitives, accept/reject,
  document facade exports, shared OOXML test fixtures, and conformance adapter.
- Compatibility: the mutation API is additive, but accept/reject now resolves
  row-level markers that it previously preserved and reported as unresolved.
  The counter remains for source compatibility and future unsupported classes.
- This change does not add a Markdoc command. A following change may expose the
  primitive through canonical Markdoc once the lower-level topology contract is
  merged and stable.

## Non-Goals

- Column or individual-cell insertion/deletion.
- `w:gridSpan`, `w:vMerge`, `w:gridBefore`, or `w:gridAfter` transformations.
- Nested-table row editing or cloning nested tables into new rows.
- Inferring a row shape from heterogeneous or malformed tables.
- Two-file comparison of structural table changes.
- Cloning fields, comments, bookmarks, content controls, drawings, or existing
  revisions from the template row.

Refs #998, #764.
