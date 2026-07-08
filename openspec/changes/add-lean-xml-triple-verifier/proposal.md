# Change: Add a compiled Lean XML-triple verifier for inplace comparison output

## Why

Increment 1 made verification status machine-readable and pinned the Lean axiom set, but it does not yet give a consumer a useful answer to the core trust question: whether a real DOCX comparison output satisfies the stated invariants. A TypeScript mirror of a Lean checker would still leave the uncomfortable "trust that TS matches Lean" gap.

This change makes Lean the verifier, not a sidecar model only: the TypeScript comparison engine remains the producer, and a compiled Lean executable independently checks the `original`, `revised`, and `combined` `word/document.xml` triple that the producer emits. The public claim becomes per-output validation by a machine-checked verifier, not universal verification of the whole TypeScript engine.

## What Changes

- Add a Lean XML-token verifier surface under `verification/lean/Tier2/` that parses the relevant WordprocessingML token subset from raw `document.xml` strings.
- Add a Lean checker theorem showing that a passing checker report implies the first verified inplace comparison properties:
  - accepting the combined output preserves valid field structure,
  - rejecting the combined output preserves valid field structure,
  - accepting the combined output recovers the revised text projection after normalization,
  - rejecting the combined output recovers the original text projection after normalization.
- Add a compiled Lean executable, tentatively `leanDocxChecker`, that reads a JSON request containing the three XML strings and returns a plain JSON report.
- Add a TypeScript invocation layer that extracts `word/document.xml` from original, revised, and output DOCX buffers, calls the Lean executable when available/enabled, and attaches a plain-English document-integrity certificate to `CompareResult`.
- Add tests and CI gates that:
  - require the Lean verifier theorem to stay zero-`sorry`,
  - audit `#print axioms` for the checker theorem,
  - compare the Lean verifier output against existing TS safety-check expectations on fixtures,
  - prove the certificate does not overclaim when the checker is unavailable, fails, or reconstruction mode is not `inplace`.
- Add a durable ECMA coverage ledger for future verifier expansion. This ledger records which XML namespaces/elements are parsed, ignored, or explicitly out of scope so long-form ECMA-376 work can proceed without context drift.

## Impact

- Affected specs: `docx-comparison`
- Affected code:
  - `verification/lean/Tier2/*` and `verification/lean/lakefile.lean`
  - `packages/docx-compare/src/compare-types.ts`
  - `packages/docx-compare/src/baselines/atomizer/pipeline.ts`
  - `packages/docx-core/src/integration/*` verifier tests
  - `.github/workflows/lean-build.yml`
  - `spec-compliance/` or `verification/registry/` ledger surfaces for checker coverage
- No claim that rebuild mode, rendering, formatting fidelity, comments, bookmarks, footnotes, endnotes, relationships, or all ECMA-376 namespaces are verified by this first checker.
- No TypeScript implementation equivalence claim. The Lean executable checks the produced XML triple directly.
