# Change: Fix docx-comparison inplace bookmark semantics

## Why

The atomizer inplace reconstruction path had two regression risks:

1. It treated bookmark round-trip equality as strict `w:id` set equality, which can fail on valid documents where WordprocessingML remaps bookmark IDs but preserves bookmark semantics.
2. When inplace synthesis created deleted or moved-source paragraphs, paragraph-boundary bookmark markers could be dropped, causing structural bookmark mismatches and unnecessary fallback to rebuild mode.

These regressions caused false downgrades from inplace mode and weakened confidence in comparator correctness invariants.

## What Changes

- Update inplace round-trip safety checks to compare bookmark semantics instead of strict bookmark ID identity:
  - bookmark start names
  - bookmark reference targets from `REF` / `PAGEREF` fields
  - unresolved reference set
  - duplicate / unmatched bookmark start-end diagnostics
- Preserve paragraph-level bookmark boundary markers when inplace creates paragraphs for deleted or moved-source content.
- Add integration regression coverage in Allure style for:
  - semantic bookmark parity in inplace mode on a golden corpus pair
  - read_text parity (`Accept All == revised`, `Reject All == original`)
  - fallback diagnostics on a corpus pair that still requires downgrade

## Impact

- Affected specs:
  - `docx-primitives`
- Affected code:
  - `packages/docx-comparison/src/baselines/atomizer/inPlaceModifier.ts`
  - `packages/docx-comparison/src/baselines/atomizer/pipeline.ts`
  - `packages/docx-comparison/src/index.ts`
  - `packages/docx-comparison/test/integration/*.test.ts`
