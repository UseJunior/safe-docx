# @usejunior/docx-core

OOXML primitives and DOCX generation in TypeScript.

[![npm](https://img.shields.io/npm/v/%40usejunior%2Fdocx-core)](https://www.npmjs.com/package/@usejunior/docx-core)
[![Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-green.svg)](../../LICENSE)

## Install

```bash
npm install @usejunior/docx-core
```

## Example

```ts
import { writeFile } from 'node:fs/promises';
import { generateDocx } from '@usejunior/docx-core';

const document = await generateDocx({
  sections: [{
    blocks: [{
      kind: 'paragraph',
      runs: [{ kind: 'text', text: 'Hello' }],
    }],
  }],
});

await writeFile('hello.docx', document);
```

`DocumentSpec` supports sections, headers and footers, fields, styles, tables, numbering, footnotes, and comments. The supported runtime uses `jszip` and `@xmldom/xmldom`; it does not require Word, LibreOffice, Python, or .NET.

For two-document comparison, use [`@usejunior/docx-compare`](../docx-compare). For agent-driven editing, use [`@usejunior/safe-docx`](../safe-docx).

See the repository [architecture](../../docs/architecture.md), [support contract](SUPPORT.md), and [package source and examples](https://github.com/UseJunior/safe-docx/tree/main/packages/docx-core).

## Document mutation versions

`DocxDocument.getMutationVersion()` returns an instance-local invalidation token
that increases for body, selected header/footer, footnote, and comment edits.
Built-in mutators notify automatically. After changing an element returned by
`getParagraphs()` or `getParagraphElementById()`, call `doc.markMutated()`.
Document views reuse cached nodes only when the mutation version and rendering
options match. Reads and serialization never reset the version. Temporary story
traversal isolates its cache and restores body state without rewinding history.

Versions are not counts of tool calls or transactional commit IDs: an operation
can advance the version more than once, and a failed operation can conservatively
invalidate a view. Compare versions only within the same loaded document.

## Bounded table-row editing

`DocxDocument.insertTableRow(...)` and `deleteTableRow(...)` edit existing body-level tables in clean or tracked mode. By default they accept only rectangular, unmerged tables with direct rows and cells; the experimental `mergeAware: true` option also admits validated horizontal `gridSpan` rows. Vertical merges, row offsets, nested tables, wrapped topology, table-property exceptions, and topology revisions still fail with a typed `SafeDocxError.detail`. Insertions return fresh paragraph anchors for chaining, and accept/reject resolve the emitted row revisions in body and supported side-story parts. For tracked edits, callers must seed `RevisionContext.idState` above existing package revision IDs; the MCP session layer performs that scan automatically.

## Bounded table-column editing

`DocxDocument.insertTableColumn(...)` and `deleteTableColumn(...)` address zero-based logical `tblGrid` columns. Insertion requires a positive `widthTwips` and one explicit `rowActions` entry per row: `{ kind: 'cell', text }` creates a physical cell, while `{ kind: 'growCell', side: 'left' | 'right' }` widens the cell on that side of the boundary. These operations are clean-only and admit simple and horizontal-`gridSpan` rows. They reject tracked requests, vertical merges, offsets, nested tables, pending topology revisions, and deletion of cells with unresolved revisions. Invalid requests leave the document unchanged and report row/column/cell coordinates in `SafeDocxError.detail`; successful insertions return paragraph IDs for newly created cells. Column edits preserve live references to unaffected DOM elements.

## Bounded table-cell editing

`DocxDocument.splitTableCell({ anchorParagraphId, splitColumnIndex, existingSide, newCellText })` splits a horizontally spanning physical cell at the boundary before zero-based logical column `splitColumnIndex`, retaining its authored content on `existingSide` and returning the new cell's paragraph anchor. `DocxDocument.absorbTableCell({ anchorParagraphId, absorbSide })` removes the anchored physical cell, **discards its content**, and expands the adjacent cell on `absorbSide` to cover the vacated grid slots. Neither changes `tblGrid` or other rows. A bookmark or comment range cut by removal loses its surviving partner endpoint even if that endpoint is in another cell or row. Both operations are clean-only and require direct body-level, non-vertically-merged tables with resolvable affected widths; percentage-width splits and percentage-width absorbing cells fail closed. Pending row/cell topology, revisions in a removed cell, nested tables, offsets, and tracked requests also fail before mutation. These APIs do not perform Word's shift-right/down insertion or shift-left/up deletion; those remain separate work under #1042.
