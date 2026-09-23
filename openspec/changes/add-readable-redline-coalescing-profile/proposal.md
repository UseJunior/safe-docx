# Change: Add Readable Redline Coalescing Profile

## Why

Markdoc's `textHunks()` emits one hunk per exact-token LCS gap, so a multi-word
replacement can serialize as alternating word-level deletion/insertion pairs
separated by ordinary spaces. Issue #42 and PR #43 solved the same readability
problem in the since-deleted comparison spine. Markdoc needs an equivalent,
bounded hunk transform: review readability sometimes requires deliberately
cloning preservable inter-word spaces into adjacent deletion and insertion
ranges.

## What Changes

- Use bounded readable-whitespace grouping for every Markdoc compilation. Do
  not expose a grouping selector through Markdoc, the TypeScript API, or CLI.
- Keep exact accept-all and reject-all projections invariant under grouping.
- Permit only bounded plain-space bridges between
  compatible adjacent replacement fragments; do not absorb lexical tokens,
  punctuation, tabs, line breaks, or protected structural boundaries.
- Keep the independent verifier's single `authored-zero-loss` gate: common
  lexical, punctuation, anchored whitespace, and structural tokens remain
  mandatory, while eligible unanchored coalesced spaces are separately
  disclosed from finished tracked markup.
- Record the fixed grouping behavior, grouped-chain totals, and coalesced-space
  evidence in compilation/release certificates.

## Impact

- Affected specs: `docx-markdoc`, `release-verification`
- Affected code: Markdoc schema/IR/compiler/CLI, docx-compare's internal
  grouping interface, tracked replacement emission, independent minimality
  evidence, certificates, README, and tests
- Related issues and precedent: #998, #846, #42, and merged PR #43
- Compatibility: **BREAKING** existing `revision-grouping` declarations,
  `revisionGrouping` compile options (including JavaScript callers), and
  `--revision-grouping` CLI flags are rejected before mutation; callers remove
  them and receive readable grouping by default.
