# Change: Admit Markdoc Table-Cell Text Edits

## Why

Canonical brownfield Markdoc imports table-cell paragraphs with stable anchors,
but compilation rejects every operation targeting those anchors. This forces
ordinary cell-text changes into raw OOXML even though the existing paragraph
editing and comparison layers already preserve the surrounding table.

## What Changes

- Admit anchored text replacement, insertion, and deletion inside existing
  table cells.
- Preserve the table's row, cell, grid, merge, and property topology unchanged.
- Require inserted paragraphs to use a formatting source in the same physical
  cell, reject any operation set that deletes every direct cell paragraph, and
  keep vertical-merge continuation cells fail-closed because their content is
  not independently visible.
- Keep structural row, column, cell, and merged-grid operations owned by issue
  #764.
- Report structural table editing, rather than all table content, as the
  excluded capability in compilation certificates.

## Impact

- Affected specs: pending `docx-markdoc` capability from
  `add-brownfield-markdoc-authoring`.
- Affected code: `packages/docx-markdoc` source validation, tests, and docs.
- Compatibility: additive. Existing non-table compilation is unchanged.
