# Change: Add Section Break Insertion

## Why

Safe DOCX can inspect and format existing sections, but callers still cannot
split a DOCX section without editing `word/document.xml` directly. That blocks
section-specific page numbering and page setup whenever the desired section
does not already exist.

## What Changes

- Add an anchored DOCX primitive that inserts a dedicated section-break
  paragraph after a direct main-document paragraph.
- Preserve the current section's complete properties, including header/footer
  relationship references, on the newly inserted boundary.
- Allow the following section to inherit the current properties or reset its
  non-relationship properties before applying optional page-number and page
  setup overrides.
- Record the new boundary as an inserted paragraph mark and record following
  section property overrides as one `w:sectPrChange`.
- Add an `insert_section_break` MCP tool with strict validation, revision
  preflight, deterministic section-count projections, and generated docs.

## Impact

- Affected specs:
  - `docx-primitives`
  - `mcp-server`
- Affected code:
  - `packages/docx-core/src/primitives/sections.ts` and `DocxDocument`
  - `packages/docx-mcp/src/tools/`, `server.ts`, and `tool_catalog.ts`
  - tool documentation, tutorial, support matrix, and conformance evidence

