# Change: Add Section Page Setup Formatting

## Why

Safe DOCX can now discover sections and restart page numbering, but callers still
have to edit `word/document.xml` directly to change a section's paper size,
orientation, or margins. Raw XML bypasses validation, tracked-change attribution,
and the preservation guarantees already established for section properties.

## What Changes

- Extend the DOCX section primitive with one atomic partial mutation for page
  numbering, page size/orientation, and page margins.
- Extend `format_section` with optional `page_size` and `margins` objects while
  preserving the existing `page_number_start` contract.
- Emit one native `w:sectPrChange` snapshot for an effective multi-property
  request and make an already-matching request a deterministic no-op.
- Validate twip values and orientation before live mutation, including the full
  required margin set when a document has no existing `w:pgMar`.
- Preserve section topology, page-number format, columns, break type,
  header/footer references, and all untargeted attributes.

## Impact

- Affected specs:
  - `docx-primitives`
  - `mcp-server`
- Affected code:
  - `packages/docx-core/src/primitives/sections.ts` and `DocxDocument`
  - `packages/docx-mcp/src/tools/format_section.ts` and the tool catalog
  - generated tool documentation, support matrices, and tutorial
  - unit, canonical-emission, conformance, and real-DOCX tests

## Non-Goals

- Inserting, removing, splitting, or reordering sections.
- Changing section-break type, columns, line numbering, page borders, or
  vertical alignment.
- Creating, deleting, or editing header/footer parts or relationships.
- Changing page-number format or chapter-number settings.
- Automatically swapping page dimensions when orientation changes.
- Removing an existing page-size, margin, orientation, or restart setting.
