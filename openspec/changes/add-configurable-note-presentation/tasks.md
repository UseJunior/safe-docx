## 1. Comment-to-footnote slice

- [x] 1.1 Define presentation, selection, and conversion-report types.
- [x] 1.2 Preflight root comments and reject unsupported ranges or threads.
- [x] 1.3 Convert at the visible range endpoint without changing operative text.
- [x] 1.4 Preserve existing substantive footnotes.
- [x] 1.5 Add independently styled prefix, separator, and body runs.
- [x] 1.6 Emit explicit superscript reference markers in both stories.
- [x] 1.7 Add CLI options and focused synthetic regression tests.

## 2. Canonical Markdoc annotations

- [x] 2.1 Define a first-class annotation IR with stable ID, editable structured
  body, optional operation association, source metadata, source presentation,
  semantic role, explicit audience, and range-or-point anchor union.
- [x] 2.2 Normalize existing authored rationales into canonical annotations
  without requiring imported annotations to bind to an edit operation.
- [x] 2.3 Import supported Word comment bodies, metadata, reply relationships,
  and exact range or point anchors into readable canonical Markdoc.
- [x] 2.4 Import supported Word footnote bodies and metadata at their exact point
  references without inventing range starts.
- [x] 2.5 Fail closed with structured diagnostics when an imported annotation
  body or topology cannot be represented without loss.
- [x] 2.6 Default imported footnotes to substantive semantics and require an
  explicit per-annotation choice before converting or omitting them.

## 3. Presentation profiles and export

- [x] 3.1 Normalize API, JSON, Markdoc, and CLI presentation profiles for
  internal, external-facing, and unspecified audiences.
- [x] 3.2 Support `preserve`, `comment`, `footnote`, and `omit`, with explicit
  per-annotation presentation taking precedence over the audience profile.
- [x] 3.3 Export ranges as exact ranged comments or end-anchored footnotes and
  export points as point footnotes or point comments without guessed expansion.
- [x] 3.4 Preserve canonical anchor geometry and reply topology when an output
  projection is lossy, so later exports can choose a different presentation.
- [x] 3.5 Emit independently styled footnote prefix, separator, and body from the
  canonical annotation without mutating its semantic body.
- [x] 3.6 Record note dispositions, lossy projections, and profile digest in the
  verification certificate.

## 4. Follow-up and verification

- [x] 4.1 Migrate visible/structural coordinates to the paragraph index in #904.
- [x] 4.2 Add synthetic round-trip tests for ranged comments, point comments,
  point footnotes, edited bodies, profile switching, and style-only recompiles.
- [x] 4.3 Add anchor-remapping tests for text edits and fail closed when an
  anchor becomes ambiguous or unresolvable.
- [x] 4.4 Cite registry entries `ECMA-PART1-17-13-4-4`,
  `ECMA-PART1-17-13-4-3`, `ECMA-PART1-17-13-4-5`, and
  `ECMA-PART1-17-11-14` through `testAllure.conformance(...)` in every test
  that exercises the corresponding OOXML construct, and add matching source
  JSDoc citations where the implementation makes a conformance claim.
- [x] 4.5 Complete repository pre-submit checks.
- [x] 4.6 Record Word and LibreOffice manual compatibility observations.
