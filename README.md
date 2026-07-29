# Safe Docx

Edit Word and OpenDocument files with coding agents.

<!-- SYNC:badges BEGIN -->
[![CI](https://github.com/usejunior/safe-docx/actions/workflows/ci.yml/badge.svg)](https://github.com/usejunior/safe-docx/actions/workflows/ci.yml)
[![codecov](https://img.shields.io/codecov/c/github/usejunior/safe-docx/main)](https://app.codecov.io/gh/usejunior/safe-docx)
[![npm version](https://img.shields.io/npm/v/@usejunior/safe-docx)](https://www.npmjs.com/package/@usejunior/safe-docx)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache--2.0-green.svg)](https://github.com/UseJunior/safe-docx/blob/main/LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/UseJunior/safe-docx)](https://github.com/UseJunior/safe-docx/commits/main)
[![GitHub issues closed](https://img.shields.io/github/issues-closed/UseJunior/safe-docx)](https://github.com/UseJunior/safe-docx/issues?q=is%3Aissue+is%3Aclosed)
<!-- SYNC:badges END -->

<!-- SYNC:lang-nav BEGIN -->
[English](./README.md) · [Español](./README.es.md) · [简体中文](./README.zh.md) · [Português](./README.pt-br.md) · [Deutsch](./README.de.md)
<!-- SYNC:lang-nav END -->

Safe Docx is a local MCP server and CLI for reading, searching, editing, comparing, converting, and saving document files. It preserves DOCX structure and can produce clean or tracked-changes output.

## Example

Ask your coding agent:

```text
Edit NDA.docx. Change the governing law from New York to Delaware.
Save a clean copy and a tracked-changes copy. Do not change anything else.
```

Safe Docx finds the clause, applies the targeted edit, and writes both files for review. The rest of the document stays outside the requested edit.

Follow the complete [editing walkthrough](docs/tutorial.md).

## Comparisons

- [SuperDoc](docs/comparisons.md#superdoc)
- [Claude's built-in DOCX editing](docs/comparisons.md#claudes-built-in-docx-editing)
- [python-docx](docs/comparisons.md#python-docx)
- [DOCX compatibility matrix](docs/comparisons.md#compatibility-matrix)

## Install

```bash
npm install --global @usejunior/safe-docx
```

Then configure your MCP client with the installed executable's absolute path. For Claude Code:

```bash
claude mcp add safe-docx -- /absolute/path/to/safe-docx
```

See [Installation and verification](docs/installation.md) for locating the executable, pinning a version, and configuring clients.

## Documentation

- [Installation and verification](docs/installation.md)
- [Tool reference](packages/docx-mcp/docs/tool-reference.generated.md)
- [TypeScript library](packages/docx-core/README.md)
- [Architecture](docs/architecture.md)
- [Testing and evidence](docs/testing-and-evidence.md)
- [Trust and conformance](docs/trust-and-conformance.md)
- [Contributing](CONTRIBUTING.md)

## Standards Conformance

Browse the [Safe Docx Conformance Explorer](https://usejunior.com/engineering/safe-docx/conformance) to navigate ECMA-376 sections, OOXML schema declarations, capability claims, explicit non-goals, and measured cross-implementation outcomes.

The generated [repository conformance report](spec-compliance/CONFORMANCE.md) remains the source-controlled record of targeted sections, non-goals, and verification references.

## What Safe Docx Is Not Optimized For

Safe Docx is not a visual editor or layout engine. It does not provide browser rendering, real-time collaboration, or pixel-level pagination guarantees. `.dotx` templates must be converted to `.docx` before use.
