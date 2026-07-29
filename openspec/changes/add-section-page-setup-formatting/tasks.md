## 1. Core Section Mutation

- [x] 1.1 Add atomic section-property mutation and result models.
- [x] 1.2 Validate partial page size, orientation, and signed/unsigned margins.
- [x] 1.3 Update or schema-order-create `w:pgSz` and `w:pgMar` while preserving
      untargeted attributes and children.
- [x] 1.4 Emit one prior-state `w:sectPrChange` for an effective multi-property
      mutation and retain deterministic no-op behavior.
- [x] 1.5 Delegate the existing page-number setter through the atomic primitive
      and expose it through `DocxDocument`.

## 2. MCP Tool Surface

- [x] 2.1 Extend the `format_section` catalog schema with partial `page_size`
      and `margins` inputs.
- [x] 2.2 Validate at least one writable leaf and return structured hints for
      invalid, incomplete, and out-of-range requests.
- [x] 2.3 Apply page-number and page-setup changes in one AI-revision preflight
      and one live mutation.
- [x] 2.4 Return previous/resulting page-size and margin projections while
      retaining topology and edit-accounting invariants.

## 3. Tests And Conformance

- [x] 3.1 Add core tests for partial updates, schema-ordered creation,
      orientation, signed margins, invalid values, missing-element completion,
      preservation, and no-op behavior.
- [x] 3.2 Add tracked accept/reject tests proving an atomic request snapshots
      and restores the complete prior section.
- [x] 3.3 Add MCP tests for mixed property requests, file/session reuse,
      validation, accounting, and unsupported providers.
- [x] 3.4 Extend canonical-emission and emitted-schema coverage for `w:pgSz`,
      `w:pgMar`, and `w:sectPrChange`.
- [x] 3.5 Run a real-DOCX smoke covering portrait-to-landscape page setup,
      clean/tracked outputs, accept/reject, schema validation, and rendering.

## 4. Documentation

- [x] 4.1 Regenerate the MCP tool reference and pass freshness checks.
- [x] 4.2 Update support matrices and tutorial examples with partial-update,
      missing-margin, and literal-orientation behavior.
- [x] 4.3 Update ECMA-376 evidence for §§ 17.6.13 and 17.6.11.

## 5. Validation

- [x] 5.1 `openspec validate add-section-page-setup-formatting --strict`
      passes.
- [x] 5.2 Focused core and MCP suites pass.
- [x] 5.3 The mandatory build, lint, test, spec-coverage, and conformance
      pre-submit suite passes.
