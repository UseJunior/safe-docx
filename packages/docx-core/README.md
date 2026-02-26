# @usejunior/docx-core

[![npm version](https://img.shields.io/npm/v/%40usejunior%2Fdocx-core)](https://www.npmjs.com/package/@usejunior/docx-core)
[![CI](https://github.com/UseJunior/safe-docx/actions/workflows/ci.yml/badge.svg)](https://github.com/UseJunior/safe-docx/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/UseJunior/safe-docx/blob/main/LICENSE)

Core Safe Docx library for brownfield editing and comparison of existing `.docx` files.

## What This Package Is

`@usejunior/docx-core` is the production engine behind Safe Docx. It is designed for surgical operations on existing Word documents where formatting fidelity and deterministic behavior matter.

Primary capabilities:

- tracked-change comparison output for review workflows
- revision extraction and OOXML-safe document primitives
- formatting-preserving text and paragraph operations
- comment and footnote primitive support

Default comparison is pure TypeScript atomizer (`engine: "auto"` -> `atomizer`).

## What This Package Is Not

- Not a hosted service
- Not a document-generation framework for creating new files from scratch
- Not dependent on .NET for supported runtime APIs

Internal benchmark code exists for maintainer analysis, but benchmarking is not a user-facing feature.

## Install

```bash
npm install @usejunior/docx-core
```

## Quickstart: Compare Two DOCX Files

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { compareDocuments } from '@usejunior/docx-core';

const original = await readFile('./original.docx');
const revised = await readFile('./revised.docx');

const result = await compareDocuments(original, revised, {
  author: 'Comparison',
  // engine defaults to "auto" (atomizer)
});

await writeFile('./output.redline.docx', result.document);
console.log(result.engine, result.stats);
```

## Engine Model

- `atomizer` (default via `auto`): primary production path
- `diffmatch`: optional baseline/debug path
- `wmlcomparer`: not available through supported programmatic API usage

## Dependency Footprint

Runtime dependencies are intentionally small:

- `@xmldom/xmldom` for XML DOM handling
- `jszip` for DOCX zip container handling
- `diff-match-patch` for optional `diffmatch` baseline behavior

No native binaries, and no .NET prerequisite for supported runtime API usage.

## Automated Fixture Coverage

In-repo automated fixtures currently include:

- Common Paper style mutual NDA variants
- Bonterms mutual NDA fixture
- Letter of Intent fixture
- ILPA limited partnership agreement redline fixtures

## Designed for Complex DOCX Classes

`@usejunior/docx-core` is designed to support complex legal/business document classes such as:

- NVCA financing forms
- YC SAFEs
- Offering memoranda
- Order forms and services agreements
- Limited partnership agreements

## From-Scratch Generation

If your primary use case is generating new documents from scratch, use a generation-oriented package such as [`docx`](https://www.npmjs.com/package/docx).

## Development

```bash
npm run build -w @usejunior/docx-core
npm run test:run -w @usejunior/docx-core
npm run lint -w @usejunior/docx-core
```

## License

MIT
