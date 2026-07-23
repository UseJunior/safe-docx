## 1. Specification and conformance

- [x] 1.1 Validate this OpenSpec proposal and both capability deltas.
- [x] 1.2 Add bounded REF/PAGEREF registry entries and update the field non-goal.
- [x] 1.3 Add leading JSDoc and structured test citations without overclaiming topology preservation.

## 2. Ordered field passthrough

- [x] 2.1 Generalize opaque passthrough descriptors and emission to ordered inline ranges.
- [x] 2.2 Capture and classify self-contained PAGE, NUMPAGES, REF, and PAGEREF ranges before field collapse.
- [x] 2.3 Reuse counterpart, fingerprint, ownership, contiguity, and emit-once validation.
- [x] 2.4 Fail closed for supported-field mutation, cross-paragraph movement, tracked ownership, malformed/nested/spanning/shared ranges, overlap, and correlation loss.
- [x] 2.5 Keep inline-SDT ownership authoritative and leave inplace behavior unchanged.
- [x] 2.6 Pair field ranges by paragraph-local sequence rather than shifting direct-child positions.
- [x] 2.7 Restrict malformed preflight errors to identifiable supported instructions and enforce REF switch arity.

## 3. Evidence

- [x] 3.1 Add shared decorated complex-field fixtures for all four instructions.
- [x] 3.2 Add forced-rebuild tests for same/other paragraph edits and multiple fields.
- [x] 3.3 Add adversarial fail-closed tests for every bounded exclusion.
- [x] 3.4 Assert the Lean rebuild evidence remains `not_applicable`.
- [x] 3.5 Add sibling-shift, unsupported DATE, REF `\d`, revision-wrapper, and direct-inplace regressions.

## 4. Verification

- [x] 4.1 Run focused tests and TypeScript build/lint.
- [x] 4.2 Run strict OpenSpec and conformance checks.
- [x] 4.3 Run the mandatory repository pre-submit suite and review the final diff.
