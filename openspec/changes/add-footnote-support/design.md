## Context
Safe-docx supports comments but not footnotes. Legal documents rely heavily on footnotes for definitions, cross-references, and commentary. This design covers footnote CRUD primitives and MCP tool wrappers. Endnotes are deferred.

## Goals / Non-Goals
- Goals: Full footnote CRUD (read, add, update, delete), inline `[^N]` markers in read_file output, Word-compatible footnote body skeleton
- Non-Goals: Endnote support, shared bootstrap refactoring with comments, cross-package imports from docx-comparison

## Decisions

### Reserved entry detection by type attribute
Real DOCX files use IDs `-1`/`0` for reserved footnotes (separator, continuationSeparator), but other generators may use `0`/`1`. Detection MUST use `w:type="separator"|"continuationSeparator"` attribute, NOT hardcoded numeric IDs.

### Point insertion via run splitting
Footnote references are point anchors, not ranges like comments. Insertion uses offset-accurate run splitting from `text.ts`, not the comment range-marker approach.

### Mixed-run handling
Real DOCX files have two patterns: (A) dedicated run with only `<w:footnoteReference/>`, (B) run containing text + `<w:footnoteReference/>`. Both must be handled for reading, rendering, and deletion. Delete removes only the reference element, not the containing run (unless empty after removal).

### View/edit isolation
`[^N]` markers are confined to `document_view.ts` only. `getParagraphRuns`/`getParagraphText` in `text.ts` are NOT modified — they are shared by `replace_text` and `add_comment`.

### No cross-package dependency for numbering
Display-number mapping reimplemented in docx-primitives using xmldom. Does NOT import from docx-comparison.

### Footnote body skeleton
Created footnotes include `<w:footnoteRef/>` run required by Word for inline footnote number display.

### Bootstrap pattern replication
Replicates Content_Types/relationship pattern from `comments.ts`. No shared helper extraction.

## Risks / Trade-offs
- Multi-paragraph footnote update is v1-limited (updates first paragraph text runs only)
- No endnote support in v1

## Open Questions
- None; peer review corrections incorporated
