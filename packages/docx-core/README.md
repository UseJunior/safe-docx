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

`DocumentSpec` supports sections, headers and footers, fields, styles, tables, numbering, and comments. The supported runtime uses `jszip` and `@xmldom/xmldom`; it does not require Word, LibreOffice, Python, or .NET.

For two-document comparison, use [`@usejunior/docx-compare`](../docx-compare). For agent-driven editing, use [`@usejunior/safe-docx`](../safe-docx).

See the repository [architecture](../../docs/architecture.md), [support contract](SUPPORT.md), and [package source and examples](https://github.com/UseJunior/safe-docx/tree/main/packages/docx-core).

## Bounded table-row editing

`DocxDocument.insertTableRow(...)` and `deleteTableRow(...)` edit existing body-level tables in clean or tracked mode. The phase-one API intentionally accepts only rectangular, unmerged tables with direct rows and cells. It rejects spans, vertical merges, row offsets, nested tables, wrapped topology, table-property exceptions, and topology revisions with a typed `SafeDocxError.detail`; callers needing those shapes should use a lower-level OOXML workflow. Insertions return fresh paragraph anchors for chaining, and accept/reject resolve the emitted row revisions in body and supported side-story parts.
