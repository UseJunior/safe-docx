## 1. Core primitive

- [x] 1.1 Add `setParagraphProperties` (alignment and on/off pagination flags) with schema-ordered insertion and `w:pPrChange` tracking.
- [x] 1.2 Expose it through `DocxDocument`.

## 2. MCP tool

- [x] 2.1 Add the `paragraph_properties` group to the `format_layout` schema, validation, strict selectors and revision preflight.
- [x] 2.2 Reject the group for Google Docs sessions.
- [x] 2.3 Add MCP tests with OpenSpec traceability, including accept/reject and the section-break case.

## 3. Verification

- [x] 3.1 Regenerate tool documentation and add ECMA-376 registry entries.
- [x] 3.2 Run OpenSpec strict validation and the mandatory pre-submit checks.
