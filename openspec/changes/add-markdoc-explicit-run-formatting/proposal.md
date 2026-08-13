# Change: Add Explicit Markdoc Run Formatting

## Why

Brownfield Markdoc can inherit character formatting from source runs, but it
cannot express a deliberate new character format that does not exist in the
pinned source. A completed replay needed newly authored fill-in text to be
yellow-highlighted and singly underlined. The source contained ordinary dates,
so `format-source` correctly produced plain replacement text; treating that as
formatting loss would confuse inheritance with new authoring intent.

The same replay also showed that exact accept/reject text verification does not
prove formatting fidelity. A redline can reproduce both clean text states while
dropping direct run properties during tracked-change reconstruction.

## What Changes

- Add a domain-neutral, explicitly scoped run-format declaration for generated
  replacement text in canonical brownfield Markdoc and its serialized IR.
- Keep `format-source` limited to selecting an existing source run as the base
  template; it never creates formatting implicitly.
- Overlay only declared run properties using Safe DOCX's existing additive
  `ReplacementPart.addRunProps` primitive.
- Preserve the concise operation-level declaration for exactly one generated
  hunk, and add inline `run-format` spans for explicitly styling two or more
  independently identified generated spans in one clean `after` state.
- Fail closed when a formatting span overlaps unchanged text, crosses generated
  hunk boundaries, is empty or nested, or overlaps another formatting span.
- Add formatting-aware projection checks to the verification certificate:
  pinned source versus reject-all, and clean output versus accept-all.
- Keep expected formatting explicit: the certificate verifies declared and
  generated states but does not infer desired styling from text such as blanks,
  dates, signatures, or underscores.

## Impact

- Affected specs: pending `docx-markdoc` capability from
  `add-brownfield-markdoc-authoring`.
- Affected code: `packages/docx-markdoc` schema, IR, compiler, certificate, CLI,
  tests, and documentation; existing formatting-fidelity APIs in
  `packages/docx-compare` are consumed rather than duplicated.
- Compatibility: additive Markdoc syntax and certificate fields. Existing
  documents without explicit run formatting retain inheritance-only behavior.
- Domain boundary: no legal-document concepts or Hawthorn-specific tags are
  introduced.
