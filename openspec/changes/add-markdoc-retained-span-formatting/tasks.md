## 1. Core run-range formatting

- [x] 1.1 Add a bounded text-preserving run-range formatting primitive with a closed additive/subtractive property type.
- [x] 1.2 Split only admitted text-run boundaries and preserve undeclared properties, wrappers, embedded content, and neighboring runs.
- [x] 1.3 Add `@conformance` documentation, Allure conformance metadata, registry coverage, and native accept/reject tests for `w:rPrChange`; Markdoc integration stories SHALL carry this change's OpenSpec IDs without claiming a separate public primitive capability.
- [x] 1.4 Prove invalid, mixed-format, embedded-object, and unsupported-wrapper ranges fail transactionally.

## 2. Canonical syntax and IR

- [x] 2.1 Parse inline `retain-format` declarations into exact revised-text offsets without changing visible text.
- [x] 2.2 Add the closed `highlight`/`underline` set-or-remove vocabulary and stable validation diagnostics.
- [x] 2.3 Reject empty, nested, overlapping, unknown, and deterministic no-op declarations.
- [x] 2.4 Preserve backward-compatible IR serialization for documents without retained formatting.

## 3. Alignment and replay

- [x] 3.1 Derive exact common source/revised intervals as the complement of `textHunks`, including cumulative source/revised offset deltas and mid-token boundaries.
- [x] 3.2 Reject generated/deleted/cross-boundary scope and source intervals spanning multiple coalesced formatting classes.
- [x] 3.3 Apply all clean retained-format mutations before comparison without changing visible text.
- [x] 3.4 Support admitted paragraph edits inside existing physical table cells without broadening structural table topology.

## 4. Tracked output and certification

- [x] 4.1 Prove comparison emits native `w:rPrChange` with the prior direct properties and no text-revision wrapper overlapping any character of a mapped format-only interval.
- [x] 4.2 Verify source/reject and clean/accept text plus semantic formatting projections.
- [x] 4.3 Add bounded certificate diagnostics for declared spans, changed properties, emitted property ranges counted from overlapping `w:rPrChange` markup (not comparator statistics), and format-only text-revision overlaps.
- [x] 4.4 Make every retained-format scope or projection failure block delivery.

## 5. Regression evidence and documentation

- [x] 5.1 Prove yellow highlight can be removed from one retained completed value while identical neighboring text remains untouched.
- [x] 5.2 Prove repeated visible strings are disambiguated by authored offsets, including a wrong-occurrence negative control.
- [x] 5.3 Prove add, remove, no-op, mixed-format, and combined text-plus-retained-format cases.
- [x] 5.4 Document `run-format` versus `retain-format`, table-cell support, and fail-closed boundaries.
- [ ] 5.5 Run package tests, full pre-submit gates, strict OpenSpec validation, Claude Fable review, and real-DOCX post-merge smoke.
- [x] 5.6 Dry-run archive this change together with the pending `docx-markdoc` deltas and restore the tree, proving no requirement or scenario loss regardless of archive order.
