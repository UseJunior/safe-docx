## 1. Core Numbering Mutation

- [x] 1.1 Add typed direct-numbering mutation input/result models in
      `@usejunior/docx-core`.
- [x] 1.2 Implement paragraph-anchor resolution and read the target's complete
      direct `w:numPr` without falling back to style-inherited numbering.
- [x] 1.3 Validate `numId` instance, abstract numbering reference, and `ilvl`
      existence before changing the DOM.
- [x] 1.4 Implement schema-ordered set/remove behavior that preserves unrelated
      paragraph properties and creates a missing `w:pPr` only when setting.
- [x] 1.5 Emit `w:pPrChange` with session revision metadata for effective changes
      and make identical state requests no-ops.
- [x] 1.6 Expose the primitive through `DocxDocument` and package exports.

## 2. MCP Tool Surface

- [x] 2.1 Add the revisionable DOCX-only `format_numbering` schema to the tool
      catalog with mutually exclusive remove, match, and direct-reference forms.
- [x] 2.2 Implement file-first/session-first tool resolution, AI-revision
      preflight, validation, mutation, edit accounting, and structured response
      metadata.
- [x] 2.3 Register tool dispatch and ensure unsupported ODT and Google Docs
      requests fail with provider-specific structured errors.
- [x] 2.4 Return structured validation errors with remediation hints for missing
      anchors, incomplete source numbering, dangling instances, missing levels,
      and mutually exclusive inputs.

## 3. Tests And Conformance

- [x] 3.1 Add core unit tests for set, remove, container creation, schema order,
      unrelated-property preservation, and deterministic no-op behavior.
- [x] 3.2 Add tracked-change tests proving the prior numbering is captured in one
      `w:pPrChange` and clean accept/reject semantics restore the expected state.
- [x] 3.3 Add MCP integration tests for all three modes, session reuse, edit
      accounting, and structured result metadata.
- [x] 3.4 Add transactional failure tests proving invalid anchors and dangling
      numbering references leave serialized document XML unchanged.
- [x] 3.5 Add read-after-write tests proving copied numbering joins the source
      `numId`/`ilvl` and produces the expected list-label sequence.
- [x] 3.6 Add ECMA-376 conformance citations and Allure evidence for
      `w:numPr`, `w:numId`, and `w:ilvl`.
- [x] 3.7 Run an end-to-end real-DOCX smoke covering clean and tracked outputs,
      package/XML validation, and LibreOffice rendering.

## 4. Documentation

- [x] 4.1 Regenerate the MCP tool reference from the catalog.
- [x] 4.2 Add canonical tutorial examples for removing direct numbering and
      matching another paragraph.
- [x] 4.3 Document the v1 boundaries: existing definitions only, direct
      numbering only, and no guaranteed label without surrounding list context.

## 5. Validation

- [x] 5.1 `openspec validate add-paragraph-numbering-formatting --strict`
      passes.
- [x] 5.2 Tool-documentation freshness and site checks pass.
- [x] 5.3 The repository's mandatory build, lint, test, spec-coverage, and
      conformance pre-submit suite passes.
