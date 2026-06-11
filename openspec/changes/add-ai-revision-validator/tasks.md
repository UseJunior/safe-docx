## 1. Core Validator

- [x] 1.1 Extract the field-structure validator into a shared module and re-export existing imports.
- [x] 1.2 Add a shared ECMA-376 tracked-change vocabulary constant covering Table A revision elements.
- [x] 1.3 Implement `validateAiRevisions(...)` with AI-scoped errors, foreign warnings, range-pair checks, field rules, placement rules, and package invariant checks.
- [x] 1.4 Add `DocxDocument.validateAiRevisions(...)` over document, story, header, footer, and note/comment parts.
- [x] 1.5 Add docx-core tests for valid AI revisions, malformed AI revisions, foreign warnings, range/field/package failures, and existing emitter output.

## 2. MCP Enforcement

- [x] 2.1 Extract shared story/side-part enumeration so docx-core and docx-mcp seed/validate the same package parts.
- [x] 2.2 Add a clone-preflight revision guard for write tools and ensure validation failures leave the live session unchanged.
- [x] 2.3 Wire save-time AI revision validation into `save` with a structured `INVALID_AI_REVISIONS` failure.
- [x] 2.4 Expand save-time revision diagnostics to use the shared vocabulary.
- [x] 2.5 Add docx-mcp tests for write-path validation failure and transactionality.

## 3. Verification

- [x] 3.1 Run `openspec validate add-ai-revision-validator --strict`.
- [x] 3.2 Run focused docx-core validator tests.
- [x] 3.3 Run focused docx-mcp revision guard/save tests.
