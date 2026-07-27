# Change: Add Paragraph Numbering Formatting

## Why

Safe DOCX exposes a paragraph's effective numbering through `read_file`, but no
editing tool can change its direct `w:numPr`. Callers therefore cannot remove a
stray auto-number or reconnect a paragraph to an existing list without manually
editing `word/document.xml`, which bypasses tracked changes and the normal
mutation safeguards.

## What Changes

- Add a DOCX-only `format_numbering` MCP tool targeting one paragraph anchor.
- Support three mutually exclusive operations:
  - remove the target paragraph's direct `w:numPr`;
  - copy the explicit `w:numId` and `w:ilvl` from another anchored paragraph;
  - set an explicit `w:numId` and `w:ilvl` that already exist in the document's
    numbering definitions.
- Validate all anchors and numbering references before mutation and return
  structured errors for invalid or ambiguous requests.
- Record an effective numbering change as a native `w:pPrChange`, using the
  repository's existing revision metadata and mutation guardrails.
- Preserve paragraph text, identity, unrelated paragraph properties, numbering
  definitions, and non-body package parts.
- Make repeated requests for the already-effective direct state deterministic
  no-ops rather than adding duplicate revision records.

## Impact

- Affected specs:
  - `mcp-server`
- Affected code:
  - `packages/docx-core/src/primitives/` for the tracked numbering mutation
  - `packages/docx-mcp/src/tools/`, `server.ts`, and `tool_catalog.ts` for the
    tool contract and dispatch
  - generated tool documentation and the canonical tutorial
  - unit, integration, conformance, and real-DOCX regression tests

## Non-Goals

- Creating, cloning, renumbering, or deleting definitions in
  `word/numbering.xml`.
- Editing numbering inherited only through paragraph styles.
- Restarting a list at an arbitrary value or changing label formats, indentation,
  justification, or numbering-level styles.
- Numbering edits in headers, footers, footnotes, endnotes, ODT, or Google Docs.
- Automatically choosing which list a paragraph should join.
