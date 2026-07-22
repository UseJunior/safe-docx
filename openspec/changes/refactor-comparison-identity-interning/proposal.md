# Change: Intern atom identity for LCS, computing SHA1 lazily

## Why

Every atom (~70k across a base+filled NVCA pair) paid a native `createHash('sha1')`
round-trip at creation, and the LCS hot loops compared the resulting 40-char hex
*strings* — and, on every hash-equal cell, walked each atom's recursive
`textContent` twice. The digest was never used as a digest, only as an equality
token. Interning the identity to a small integer makes equality a single integer
compare and is strictly *more* correct than hashing (collision probability goes to
zero, not merely negligible). Measured on the NVCA pair, this cuts atomizer
`createHash('sha1')` calls by 93% (rebuild) / 98% (inplace) with byte-identical
output. Peer-reviewed for exactness in #583 (Track A); broken out as #585.

## What Changes

- `sha1Hash` on a `ComparisonUnit` is now computed **lazily** — materialized on
  first read and cached — rather than eagerly when the unit is created. Reads
  still return the same 40-character hex digest (extended by any identity salts).
- Content-identity comparison in the LCS no longer reads or recomputes `sha1Hash`.
  It compares **interned integer identity tokens** derived from each unit's
  pre-hash identity string and recursive text content. Two units get the same
  token exactly when they satisfy the established atom-equality relation (equal
  content hash, equal text, equal tag name).
- Paragraph-group coarse identities are likewise interned integers rather than
  per-group SHA1 hashes.
- **Not BREAKING**: the public `ComparisonUnit`/`ComparisonUnitAtom` shape is
  unchanged; the interned id is stored under a module-private symbol.

## Impact

- Affected specs: `docx-comparison` (Comparison Unit Base Interface)
- Affected code: `packages/docx-compare/src/atomizer.ts`,
  `packages/docx-compare/src/baselines/atomizer/{atomLcs,hierarchicalLcs,pipeline,numberingIntegration}.ts`
