## 1. Canonical syntax and IR

- [ ] 1.1 Define a closed, domain-neutral run-format schema and versioned IR representation.
- [ ] 1.2 Validate explicit underline/highlight values and reject unknown properties or values.
- [ ] 1.3 Keep `format-source` inheritance semantics separate from additive run-format intent.
- [ ] 1.4 Reject run-format declarations when alignment produces zero or multiple non-empty replacement hunks.

## 2. Replay

- [ ] 2.1 Apply declared formatting only to generated replacement text through `ReplacementPart.addRunProps`.
- [ ] 2.2 Preserve every undeclared property inherited from the selected source run.
- [ ] 2.3 Support a single zero-width insertion with explicit formatting.
- [ ] 2.4 Preserve transactional failure: no document mutation or output on invalid scope or values.

## 3. Formatting-aware certification

- [ ] 3.1 Compare pinned source with reject-all using semantic formatting fidelity.
- [ ] 3.2 Compare clean output with accept-all using semantic formatting fidelity.
- [ ] 3.3 Add certificate fields and bounded diagnostics for both formatting projections.
- [ ] 3.4 Make either formatting-projection failure block `projectionPassed`, `passed`, and `deliveryReady`.
- [ ] 3.5 Add tamper tests that independently remove highlight and underline from tracked output and prove certification fails.

## 4. Regression evidence

- [ ] 4.1 Prove a plain source date can become one explicitly yellow-highlighted, singly-underlined blank.
- [ ] 4.2 Assert direct OOXML properties in clean and accept-all outputs and exact source restoration under reject-all.
- [ ] 4.3 Prove an unformatted `format-source` without a run-format declaration remains unformatted.
- [ ] 4.4 Prove the overlay preserves unrelated inherited font, size, color, bold, and italic properties.
- [ ] 4.5 Prove mixed-format unchanged spans retain their properties and only the replacement receives the overlay.
- [ ] 4.6 Prove a multi-hunk replacement with operation-level run formatting fails closed.

## 5. Documentation and validation

- [ ] 5.1 Document inheritance versus explicit formatting with domain-neutral examples.
- [ ] 5.2 Document certificate semantics and formatting-fidelity diagnostic limits.
- [ ] 5.3 Run focused package tests, builds/typechecks, strict OpenSpec validation, conformance checks, and `git diff --check`.
- [ ] 5.4 Re-run the downstream completed-matter experiment out of band before merge; keep auto-merge disabled until it passes.
