## 1. Spec

- [ ] 1.1 Add the `Author-to-compare round-trip guarantee` requirement with scenarios
      `SDX-GEN-100`..`SDX-GEN-104` to the `docx-generation` delta.

## 2. Tests

- [ ] 2.1 Add `packages/docx-core/src/generation/generation-compare-roundtrip.test.ts`
      with `TEST_FEATURE = 'add-generation-compare-roundtrip'` and `.openspec` IDs matching
      the delta scenarios.
- [ ] 2.2 SDX-GEN-100: self-compare of an authored doc reports zero changes.
- [ ] 2.3 SDX-GEN-101: a known single-paragraph replacement produces exactly that redline.
- [ ] 2.4 SDX-GEN-102: accept-all == revised, reject-all == original (rebuild + inplace).
- [ ] 2.5 SDX-GEN-103: a fields + tables spec (Page X of Y footer, coverTermsTable,
      signatureBlock) survives the compare round-trip.
- [ ] 2.6 SDX-GEN-104: negative control — a malformed authored field trips the
      `fieldStructure` guard.

## 3. Verify

- [ ] 3.1 `openspec validate add-generation-compare-roundtrip --strict` passes.
- [ ] 3.2 New test file passes; `npm run build`, `npm run test:run`, `npm run preflight:ci`
      pass (incl. `check:spec-coverage-generation` for this feature).
