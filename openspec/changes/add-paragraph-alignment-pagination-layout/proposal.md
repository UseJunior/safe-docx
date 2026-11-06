# Change: Add paragraph alignment and pagination flags to format_layout

## Why

An agent editing an existing DOCX cannot set a paragraph's alignment or set
and clear its pagination flags. `format_layout` covers spacing, row height and
cell padding only, and `clear_formatting` targets run formatting. A common
failure case: after `insert_section_break` places a `nextPage` break before a
paragraph that already has `w:pageBreakBefore`, no tool can remove the now
redundant property, so the document risks an empty page (issue #1199).

## What Changes

- Add a `paragraph_properties` group to the DOCX `format_layout` tool:
  `alignment` (`left`, `center`, `right`, `both` written as `w:jc`) and the
  on/off flags `page_break_before`, `keep_next` and `keep_lines` (`true` sets
  the direct property, `false` removes it).
- Record each effective change as one native `w:pPrChange` holding the prior
  paragraph properties. An existing `w:pPrChange` is kept, so its older
  snapshot stays the reject baseline.
- Requests that change nothing are no-ops and emit no revision markup.
- Reject the group for Google Docs sessions.

## Impact

- Affected specs: `mcp-server`
- Affected code: `packages/docx-core/src/primitives/layout.ts`,
  `DocxDocument`, `packages/docx-mcp/src/tools/format_layout.ts`,
  `tool_catalog.ts`, the Google Docs `format_layout` adapter and generated
  tool documentation
- Conformance target: ECMA-376 5th edition, Part 1 §§ 17.3.1.13, 17.3.1.14,
  17.3.1.15, 17.3.1.23 and 17.13.5.29
