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
  on unstable raw XML indexes.
- Clone the selected row's row/cell formatting shell for insertion, populate one
  paragraph per supplied cell, strip cloned bookmarks, and guarantee every cell
  ends in a direct `w:p`.
- Emit `w:trPr > w:ins` and `w:trPr > w:del` for tracked insertion and deletion,
  and teach accept/reject to resolve those row markers semantically.
- Validate the entire target body-level table before mutation and fail
  transactionally unless it is a rectangular, revision-free, unmerged table
  whose direct rows contain no nested tables.
- Preserve the selected row's direct formatting/property shell without copying
  bookmark identities, paragraph text, fields, comments, or revisions into an
  inserted row.

## Impact

- Affected specs: `docx-primitives`.
- Affected code: table-addressing and row-mutation primitives, accept/reject,
  document facade exports, shared OOXML test fixtures, and conformance adapter.
- Compatibility: additive API surface. The prior unresolved-row counters remain,
  but supported row markers are resolved and therefore no longer counted.
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
