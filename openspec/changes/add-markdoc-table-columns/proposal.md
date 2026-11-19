# Change: Author a table column in Markdoc

## Why

Issue #1480 needs a reviewer to return a received rectangular table with a
response column and, when necessary, a landscape page. Core already has a
clean column insertion primitive; #1401 and #1398 now provide Word-verified
resolution and comparison of the resulting grid and row changes.

## What Changes

- Add `insert-table-column`, anchored to an existing body-table paragraph,
  with a positive `width-twips`, optional zero-based `column-index` (append
  by default), an edit name, and optional `landscape=true`.
- Accept one `column-cell` per source row, in row order. A cell has a plain
  `text` attribute or one or more plain-text paragraphs. Do not silently
  discard unsupported inline formatting or block content.
- Reuse the clean core primitive, then the compiler's ordinary two-file
  comparison for tracked output. Do not invent native column tracking.
- Keep every unaffected source cell intact in clean output, inherit new
  cell properties from the neighbour chosen by core, update declared
  widths, and verify both topology projections in the certificate.
- Rotate only the containing section in clean output; the tracked output
  records that layout change and Reject All restores the original setup.
- Fail closed on merged/nested/wrapped/offset target tables, malformed
  arguments, pending revisions, wrong cell counts, repeated column edits
  on one table, and mixed row/column structural edits on the same table.
  Paragraph edit-pair export must refuse the structural operation.

## Scope and authorization

This specifies Steven's approved #1480 task. It exposes the complete
received-table workflow through Markdoc compilation, including clean
landscape output; it does not weaken MCP's requirement to track AI edits.
The initial surface covers direct-body simple rectangular tables. Existing
row authoring and paragraph editing contracts remain in force.

## Validation

Use synthetic boundary cases and the repository public Mutual NDA through
import/compile, native Accept/Reject, schema validation, actual Word grid,
width and page-setup projections, and LibreOffice content checks. Run
Codex dynamic peer review and exact-merge real-document smoke.
