# Change: Add the SafeDocX capability evidence projection

## Why

SafeDocX and the neutral DOCX platform suite currently describe related
conformance evidence in separate inventories. A pinned projection is needed so
SafeDocX can make per-axis support statements without owning or silently
rewriting the neutral capability definitions.

## What Changes

- Vendor the exact neutral capability, profile, and scenario-mapping inputs at
  a reviewed upstream commit, with version and content-hash provenance.
- Add a SafeDocX-owned per-capability/per-axis status and evidence manifest.
- Validate the upstream denominator, local evidence paths, status vocabulary,
  and formal-verification claim boundaries.
- Generate deterministic machine-readable and human-readable reports and wire
  their drift check into repository preflight.

## Impact

- Affected specs: `spec-compliance`
- Affected code: `spec-compliance/capabilities/`, `spec-compliance/generated/`,
  `scripts/`, root package scripts and CI preflight
- Runtime API compatibility: no runtime or published-package changes
