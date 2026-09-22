# Change: Add Readable Redline Coalescing Profile

## Why

Markdoc now preserves common lexical and punctuation tokens in dense rewrites,
but it has no supported equivalent of the former whitespace-bridged replacement
grouping. Treating raw zero-token-loss as the only acceptable shape can produce
an alternating word-by-word redline that is technically minimal and materially
harder to review. Review readability sometimes requires deliberately cloning a
preservable inter-word space into adjacent deletion and insertion ranges.

## What Changes

- Add an explicit `revision-grouping` compile policy with `token-minimal` and
  `readable-whitespace` values to canonical Markdoc, the TypeScript API, and the
  CLI.
- Keep exact accept-all and reject-all projections invariant under both modes.
- Under `readable-whitespace`, permit only bounded plain-space bridges between
  compatible adjacent replacement fragments; do not absorb lexical tokens,
  punctuation, tabs, line breaks, or protected structural boundaries.
- Make the independent verifier policy-aware: common lexical, punctuation, and
  structural tokens remain mandatory, while eligible coalesced spaces are
  disclosed rather than falsely reported as zero-loss minimality.
- Record the resolved policy, its provenance, and coalesced-space evidence in
  the compilation/release certificate.

## Impact

- Affected specs: `docx-markdoc`, `release-verification`
- Affected code: Markdoc schema/IR/compiler/CLI, tracked replacement emission,
  independent minimality verification, certificates, README, and tests
- Related issues and precedent: #998, #846, #42, and merged PR #43
- Compatibility: `token-minimal` remains the default; readable grouping is an
  explicit deterministic opt-in

