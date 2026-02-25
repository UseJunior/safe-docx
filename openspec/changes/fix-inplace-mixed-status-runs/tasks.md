## 1. CLI Mode Reporting
- [x] 1.1 Add `mode_requested` and `fallback_reason` to `CompareCommandResult` interface
- [x] 1.2 Update `runCompareCommand` to use `reconstructionModeUsed` from compare result

## 2. Pre-Split Mixed-Status Runs
- [x] 2.1 Export `splitRunAtVisibleOffset`, `visibleLengthForEl`, `getDirectContentElements` from `text.ts`
- [x] 2.2 Implement `preSplitMixedStatusRuns()` with cross-run safety guard, field character exclusion, and R-to-L split ordering
- [x] 2.3 Wire `preSplitMixedStatusRuns` into `modifyRevisedDocument` between `attachSourceElementPointers` and `processAtoms`

## 3. Tests
- [x] 3.1 Unit tests for pre-split logic (11 tests: no-op, 3-way split, boundary cases, field exclusion, cross-run guard)
- [x] 3.2 CLI test for mode fallback reporting

## 4. Verification
- [x] 4.1 Build both packages (`docx-core`, `docx-mcp`) with zero errors
- [x] 4.2 Run new split tests (11/11 pass)
- [x] 4.3 Run CLI tests (5/5 pass)
- [x] 4.4 Run full `docx-core` suite — no new regressions (17 pre-existing failures in traceability/integration tests)
