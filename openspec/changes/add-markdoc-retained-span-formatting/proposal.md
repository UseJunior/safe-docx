# Change: Add Markdoc Retained-Span Formatting

## Why

Brownfield Markdoc can format newly generated replacement text, but it cannot
declaratively change formatting on text that remains common between `before`
and `after`. Completed placeholder text can therefore retain source
highlighting even when the intended clean document removes it. The current
workaround mutates clean OOXML and authors `w:rPrChange` outside the compiler,
breaking the canonical single-source workflow tracked by #998.

## What Changes

- Add an exact inline `retain-format` declaration for text preserved by the
  compiler's source/revised alignment.
- Represent explicit add/remove intent through a closed, domain-neutral
  formatting vocabulary; omission continues to mean “preserve”.
- Resolve scope by authored revised-text offsets and require the entire span to
  map to one common alignment interval and one coalesced source formatting
  class.
- Apply the clean mutation surgically without changing visible text or
  undeclared run properties.
- Require tracked output to express the property-only edit with native
  `w:rPrChange`, while accept-all equals clean and reject-all equals source in
  both text and semantic formatting.
- Fail before mutation for generated, deleted, ambiguous, overlapping, mixed-
  format, or structurally unsupported spans.

## Impact

- Affected spec: pending `docx-markdoc` capability from
  `add-brownfield-markdoc-authoring`. The bounded run-range helper is an
  implementation dependency of this capability, not a separately promised
  public `docx-primitives` capability.
- Affected code: `packages/docx-markdoc` parser, IR, compiler, certificates,
  documentation, and tests; `packages/docx-core` run-range primitive and
  conformance evidence.
- Compatibility: additive syntax and IR fields. Existing Markdoc and generated-
  text `run-format` behavior remain unchanged.
- Domain boundary: no placeholder, agreement, date, or form-field semantics are
  inferred; every property mutation is explicit.
- Related work: #998 and the already-shipped generated-text formatting and
  native `w:rPrChange` capabilities.
