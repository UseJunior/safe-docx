# Change: Preserve inline content controls during rebuild comparison

## Why

Rebuild comparison reconstructs each paragraph from leaf atoms. Inline `w:sdt`
ancestry is currently flattened, so an unrelated edit in the same paragraph can
silently remove a content control and its extension metadata. Minimal-save
restoration can mask this loss, but it does not repair the rebuild path.

## What Changes

- Add a small opaque-node descriptor to the comparison atom model so a supported
  container boundary can retain its semantic XML payload and effective namespace
  context without modeling unknown extension names.
- Capture unchanged inline `w:sdt` nodes as opaque boundaries and re-emit each
  boundary exactly once, in atom order, while applying edits outside the control.
- Define fail-closed ownership, collision, ordering, nesting, mutation, and
  namespace rules for opaque passthrough.
- Add forced-rebuild structural tests for inline SDTs and a separately labeled
  real-document no-regression corpus measurement for the repository's block-SDT
  documents.
- Pin the merged docx-platform-tests revision containing the two neutral content-
  control scenarios and refresh the capability projection.

## Impact

- Affected specs: `docx-comparison`, `cross-implementation-conformance`,
  `spec-compliance`
- Affected code: comparison atom types/atomizer/rebuild reconstructor, focused
  integration fixtures/tests, ECMA-376 registry, DPT pin and capability projection
- Ref: #582
