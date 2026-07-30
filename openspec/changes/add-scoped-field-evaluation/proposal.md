# Change: Add scoped field evaluation and comparison semantics

## Why

Safe Docx preserves supported Word fields and suppresses volatile TOC
PAGEREF caches during comparison, but it cannot refresh even deterministic
bookmark-backed REF results after an edit. Callers therefore cannot distinguish
a refreshed deterministic result, a layout-dependent stale cache, and an
unsupported field without inspecting OOXML themselves.

## What Changes

- Add one shared, switch-aware field-instruction classifier for PAGE,
  NUMPAGES, REF, PAGEREF, TOC, and SEQ.
- Add a fail-closed main-story field refresh primitive that evaluates a narrow
  REF allowlist from unique, well-formed bookmark ranges.
- Mark admitted layout-dependent PAGE, NUMPAGES, PAGEREF, and TOC fields dirty
  for host recalculation without fabricating pagination results.
- Return structured per-field outcomes for evaluated, dirtied, unchanged, and
  unsupported fields.
- Reuse the shared classifier in comparison cache semantics so instruction
  recognition cannot drift between preservation, evaluation, and comparison.
- Add ECMA-376 citations, focused fixtures, and explicit non-goals.

## Impact

- Affected specs: `docx-primitives`, `docx-comparison`, `spec-compliance`
- Affected code: shared field semantics, DOCX primitives, comparison field
  projections, package exports, conformance registry, focused tests
- Public API: additive
- Ref: #762
