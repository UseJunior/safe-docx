# Change: Add an ECMA-376 coverage denominator

## Why

The conformance registry can trace selected claims to extracted schemas, but it
does not preserve the complete official publications or provide a reproducible
path from those publications to runtime vocabulary. This leaves artifact
identity and unreviewed standard surface implicit.

## What Changes

- Vendor unchanged official ECMA-376 Parts 1-4 ZIP publications with checksums
  and copyright documentation.
- Add machine-readable artifact, spec-reference, and vocabulary seed manifests.
- Generate a WordprocessingML vocabulary registry and TypeScript constants from
  the official Part 4 transitional schema archive.
- Add source-level `@ooxmlSpec` links and a drift-checked coverage report.

## Impact

- Affected specs: `spec-compliance`
- Affected code: `spec-compliance/`, `scripts/`, `packages/docx-core`,
  `packages/docx-compare`, root CI scripts
- Runtime API compatibility: additive only
