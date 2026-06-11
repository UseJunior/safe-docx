## 1. Core Validator

- [ ] 1.1 Extract the field-structure validator into a shared module and re-export existing imports.
- [ ] 1.2 Add a shared ECMA-376 tracked-change vocabulary constant covering Table A revision elements.
- [ ] 1.3 Implement `validateAiRevisions(...)` with AI-scoped errors, foreign warnings, range-pair checks, field rules, placement rules, and package invariant checks.
- [ ] 1.4 Add `DocxDocument.validateAiRevisions(...)` over document, story, header, footer, and note/comment parts.
- [ ] 1.5 Add docx-core tests for valid AI revisions, malformed AI revisions, foreign warnings, range/field/package failures, and existing emitter output.

## 2. MCP Enforcement

- [ ] 2.1 Extract shared story/side-part enumeration so docx-core and docx-mcp seed/validate the same package parts.
- [ ] 2.2 Add a clone-preflight revision guard for write tools and ensure validation failures leave the live session unchanged.
- [ ] 2.3 Wire save-time AI revision validation into `save` with a structured `INVALID_AI_REVISIONS` failure.
- [ ] 2.4 Expand save-time revision diagnostics to use the shared vocabulary.
- [ ] 2.5 Add docx-mcp tests for write-path validation failure and transactionality.

## 3. Verification

- [ ] 3.1 Run `openspec validate add-ai-revision-validator --strict`.
- [ ] 3.2 Run focused docx-core validator tests.
- [ ] 3.3 Run focused docx-mcp revision guard/save tests.
