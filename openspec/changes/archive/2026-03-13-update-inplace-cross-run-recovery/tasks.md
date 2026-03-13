## 1. Implementation
- [x] 1.1 Extend atomizer inplace pass strategy to try cross-run passes (`mergeAcrossRuns: true`) before rebuild fallback
- [x] 1.2 Update reconstruction attempt diagnostics type to include new pass IDs

## 2. Regression Coverage
- [x] 2.1 Add OpenAgreements fixtures that previously triggered inplace safety fallback (`bonterms-mutual-nda`, `common-paper-mutual-nda`)
- [x] 2.2 Add integration test asserting `fail_on_rebuild_fallback: true` succeeds and tracked mode remains `inplace`
- [x] 2.3 Assert table structure is preserved for those tracked outputs

## 3. Verification
- [x] 3.1 Run targeted `docx-core` reconstruction metadata + stability tests
- [x] 3.2 Run targeted `docx-mcp` OpenAgreements E2E tests
- [x] 3.3 Validate OpenSpec change: `openspec validate update-inplace-cross-run-recovery --strict`
