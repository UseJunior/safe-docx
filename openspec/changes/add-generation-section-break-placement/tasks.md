## 1. Spec

- [x] 1.1 Add the section-break-placement requirement with scenario
      `SDX-GEN-111` to the `docx-generation` delta.

## 2. Implementation

- [x] 2.1 Add `SectionSpec.breakPlacement`.
- [x] 2.2 Bind the `w:sectPr` into the last paragraph's `w:pPr` for
      `'lastParagraph'`.
- [x] 2.3 Validate the placement value and require a final paragraph.

## 3. Tests

- [x] 3.1 Add `generation-section-break-placement.test.ts` with
      `TEST_FEATURE = 'add-generation-section-break-placement'` and
      `[SDX-GEN-111]`.

## 4. Verify

- [ ] 4.1 Package build/test, spec coverage, conformance citations, workspace
      lint, and strict OpenSpec validation.
