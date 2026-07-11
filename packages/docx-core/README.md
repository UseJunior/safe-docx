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

## Development

```bash
npm run build -w @usejunior/docx-core
npm run test:run -w @usejunior/docx-core
```

See the repository [architecture](../../docs/architecture.md), [support contract](SUPPORT.md), and [contribution guide](../../CONTRIBUTING.md).
