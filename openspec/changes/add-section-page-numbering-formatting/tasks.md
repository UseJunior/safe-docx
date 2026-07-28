## 1. Core Section Model And Mutation

- [x] 1.1 Add typed section inventory and page-number restart models.
- [x] 1.2 Enumerate canonical paragraph-boundary and final-body sections in
      document order, excluding revision snapshots.
- [x] 1.3 Project boundary, page-number, page-size, margin, and header/footer
      reference metadata without mutating the document.
- [x] 1.4 Set `w:pgNumType/@w:start` in schema order while preserving every
      unrelated section property and attribute.
- [x] 1.5 Add a `w:sectPrChange` emitter that snapshots prior section properties
      without nesting an existing change record.
- [x] 1.6 Expose inventory and mutation through `DocxDocument` and package
      exports.

## 2. MCP Tool Surface

- [x] 2.1 Add DOCX-only `get_sections` and revisionable `format_section` schemas
      to the tool catalog.
- [x] 2.2 Implement file-first/session-first section inventory responses.
- [x] 2.3 Implement section restart validation, AI-revision preflight, mutation,
      edit accounting, and structured response metadata.
- [x] 2.4 Register tool dispatch and structured unsupported-provider behavior.

## 3. Tests And Conformance

- [x] 3.1 Add core tests for section ordering, read projection, missing optional
      properties, schema-ordered creation, update, and deterministic no-op.
- [x] 3.2 Add preservation tests for page size, margins, page-number format,
      columns, header/footer references, paragraph count, and visible text.
- [x] 3.3 Add tracked-change and accept/reject tests proving the prior
      `w:sectPr` is captured and restored.
- [x] 3.4 Add MCP tests for both tools, session reuse, invalid input,
      transactional failure, edit accounting, and unsupported providers.
- [x] 3.5 Add canonical-emission regression coverage and ECMA-376 citation /
      Allure evidence for `w:pgNumType` and `w:sectPrChange`.
- [x] 3.6 Run a real-DOCX smoke for tracked and clean outputs, package/schema
      validation, accept/reject projections, and LibreOffice rendering.

## 4. Documentation

- [x] 4.1 Regenerate MCP tool reference and pass tool-doc freshness checks.
- [x] 4.2 Update support matrices and usage documentation with section-index
      stability and v1 write boundaries.

## 5. Validation

- [x] 5.1 `openspec validate add-section-page-numbering-formatting --strict`
      passes.
- [x] 5.2 Focused core and MCP test suites pass.
- [x] 5.3 The mandatory build, lint, test, spec-coverage, and conformance
      pre-submit suite passes.
