# Change: Preserve unchanged complex fields during rebuild comparison

## Why

Rebuild comparison collapses each same-paragraph complex field to its visible
result for matching, then expands the field leaves inside one synthesized run.
That preserves marker balance but silently loses the original run boundaries,
run properties, non-revision wrappers, attributes, namespaces, and extension
payload.

## What Changes

- Extend the opaque passthrough substrate with ordered inline ranges.
- Capture unchanged, self-contained PAGE, NUMPAGES, REF, and PAGEREF fields in
  the main document and preserve their complete direct paragraph-child topology.
- Pair original and revised field ranges deterministically and emit each range
  exactly once while rebuilding unrelated edits normally.
- Allow harmless direct-child position shifts caused by unrelated sibling edits,
  while rejecting changed, cross-paragraph moved, field-reordered, overlapping,
  malformed supported, tracked-revision-owned, or otherwise unsafe ranges before
  lossy output.
- Add focused positive and adversarial tests plus exact ECMA-376 registry and
  source/test citations.
- Keep inplace field fragmentation behavior unchanged and leave rebuild evidence
  outside the current Lean XML verifier.

## Impact

- Affected specs: `docx-comparison`, `spec-compliance`
- Affected code: comparison atom types, atomizer, opaque passthrough correlation,
  rebuild reconstruction, shared field fixtures, focused tests, ECMA registry
- Ref: #582
