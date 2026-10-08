## 1. Spec

- [x] 1.1 Add the document-defaults requirement with scenario `SDX-GEN-110` to
      the `docx-generation` delta.

## 2. Implementation

- [x] 2.1 Add `DocumentDefaultsSpec` and `DocumentSpec.defaults`; re-export
      the new type.
- [x] 2.2 Emit `w:rPrDefault` / `w:pPrDefault` through the shared property
      builders over the Calibri 11pt baseline.
- [x] 2.4 Write `w:eastAsia` with the other three explicit font channels.
- [x] 2.3 Validate defaults and reject empty typeface names.

## 3. Tests

- [x] 3.1 Add `generation-document-defaults.test.ts` with
      `TEST_FEATURE = 'add-generation-document-defaults'` and `[SDX-GEN-110]`.

## 4. Verify

- [ ] 4.1 Package build/test, spec coverage, conformance citations, workspace
      lint, and `openspec validate add-generation-document-defaults --strict`.
