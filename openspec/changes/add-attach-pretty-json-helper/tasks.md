## 1. Implementation
- [x] 1.1 Add `attachPrettyJson(name, payload)` to shared Allure BDD context in `testing/allure-test-factory.js`
- [x] 1.2 Add TypeScript declarations for `attachPrettyJson` in `testing/allure-test-factory.d.ts`
- [x] 1.3 Verify `attachJsonLastStep` renders as a neutral step name (no forced BDD prefix) — verification-only, no code change needed
- [x] 1.4 Update branded report sizing in `scripts/brand_allure_report.mjs` to prevent nested vertical scrollbars for HTML attachments

## 2. Testing
- [ ] 2.1 Add/update targeted tests to verify pretty JSON attachment usage
- [ ] 2.2 Confirm a short HTML evidence attachment renders without unnecessary vertical scrollbar
- [ ] 2.3 Confirm long HTML evidence attachment uses a single vertical scrollbar at the container level

## 3. Verification
- [ ] 3.1 Run targeted safe-docx tests covering extract and replace evidence scenarios
- [ ] 3.2 Regenerate branded Allure report and manually verify rendering
- [ ] 3.3 `openspec validate add-attach-pretty-json-helper --strict` passes
