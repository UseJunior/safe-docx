## 1. Implementation

- [x] 1.1 Slide zero-width insertion hunks across equal characters to an
      unambiguous in-run offset for body edits without declared formatting.
- [x] 1.2 Use the same placement for rationale ranges.

## 2. Tests

- [x] 2.1 `insertion-placement.test.ts` with
      `TEST_FEATURE = 'add-markdoc-equivalent-insertion-placement'` and
      `[SDX-MDOC-155]`: slide succeeds; no-equivalent case fails closed;
      declared `format-source` keeps the exact offset.
- [x] 2.2 Keep a genuinely ambiguous fail-closed case in the SDX-MDOC-10
      drift test.

## 3. Verify

- [ ] 3.1 Package tests, spec coverage, workspace lint, strict validation.
