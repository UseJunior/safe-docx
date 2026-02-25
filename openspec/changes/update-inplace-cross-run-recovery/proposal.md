# Change: Update inplace reconstruction with cross-run recovery passes

## Why
Some OpenAgreements templates split unchanged text across run boundaries differently between original and revised documents. The existing inplace pass ladder (`mergeAcrossRuns: false` only) could misclassify unchanged content as inserted/deleted, fail round-trip reject safety checks, and fall back to rebuild mode. Rebuild fallback for these templates could flatten table structure in tracked outputs.

## What Changes
- MODIFIED: atomizer inplace pass ladder now includes cross-run recovery passes before rebuild fallback
- MODIFIED: reconstruction attempt diagnostics pass enum includes cross-run pass identifiers
- NEW: integration regression coverage for run-fragmented OpenAgreements templates (`bonterms-mutual-nda`, `common-paper-mutual-nda`) with `fail_on_rebuild_fallback: true`
- NEW: fixture documents for the above templates in `tests/test_documents/open-agreements/`

## Impact
- Affected specs: `docx-comparison`
- Affected code:
  - `packages/docx-core/src/baselines/atomizer/pipeline.ts`
  - `packages/docx-core/src/index.ts`
  - `packages/docx-mcp/src/tools/open_agreements_e2e.test.ts`
  - `tests/test_documents/open-agreements/bonterms-mutual-nda.docx`
  - `tests/test_documents/open-agreements/common-paper-mutual-nda.docx`
