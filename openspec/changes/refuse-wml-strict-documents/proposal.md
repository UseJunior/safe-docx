# Change: Refuse WML Strict documents at load

## Why

A document saved as ISO/IEC 29500 Strict uses `http://purl.oclc.org/ooxml/wordprocessingml/main` for every WordprocessingML element. The document model matches elements by the Transitional namespace only, so `DocxDocument.load` succeeded and every read returned empty text: an agent was told the document had no content. Comparison of the same file failed with an unrelated `AncillaryStorySafetyError`, so the two entry points disagreed and neither named the cause (#1025).

## What Changes

- `DocxDocument.load` refuses a package whose `word/document.xml` root element is in the Strict namespace with `UnsupportedConformanceClassError` (code `UNSUPPORTED_CONFORMANCE_CLASS`) that names the conformance class and says how to re-save as Transitional.
- `compareDocuments` applies the same gate to both inputs before any Transitional-only stage runs, naming the offending side.
- The MCP tools (`read_file`, `open_document`, `grep`, `compare_documents`) return the refusal as a structured tool error; the CLI prints the same JSON without a stack trace.
- Strict support stays out of scope. A Transitional document is unaffected.

## Impact

- Affected specs: `docx-primitives`, `docx-comparison`, `mcp-server`
- Affected code: `packages/docx-core/src/primitives/conformance.ts`, `document.ts`, `packages/docx-compare/src/tagged/pipeline.ts`, `packages/docx-mcp/src/tools/conformance_refusal.ts` and its callers, the CLI entry points
- Conformance registry: `ECMA-PART1-2-1` (document conformance classes)
