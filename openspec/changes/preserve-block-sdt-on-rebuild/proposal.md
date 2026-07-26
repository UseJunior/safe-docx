# Change: Preserve direct body block content controls during rebuild

## Why

Forced comparison rebuild currently descends into direct `w:body/w:sdt`
controls and replaces each controlled paragraph in the original scaffold. That
silently rewrites complete cover-page controls in the ILPA corpus, dropping
DrawingML, relationship references, revision identifiers, and control metadata
even when the control itself is unchanged.

## What Changes

- Generalize the opaque passthrough descriptor with an explicit placement kind
  and contiguous paragraph-slot ownership while retaining the inline contract.
- Capture unchanged direct body-level block SDTs, pair them deterministically,
  and preserve the validated original subtree as one scaffold-owned block.
- Correlate row- and cell-scoped SDT wrappers by their container-relative
  scaffold placement while allowing their controlled paragraphs to rebuild.
- Bind every relationship-namespace attribute in a block to a memoized package
  closure covering relationship metadata, normalized targets, internal part
  hashes, and recursively referenced XML-part relationships.
- Reject wrapper mutation, movement, ownership loss, nesting, unsupported placement, or
  correlation loss before any lossy rebuilt XML is emitted.
- Replace the ILPA count-only measurement with forced-rebuild corpus evidence
  that makes real unrelated edits and validates the complete SDT subtree,
  relationship target, package-part change set, and accept/reject projections.
- Pin docx-platform-tests PR #57 merge `ba9936af06cc18249e892dc594ed9bcefaf98463`,
  refresh its reviewed capability registry, and retain oracle-specific outcome
  validation.

## Impact

- Affected specs: `docx-comparison`, `cross-implementation-conformance`,
  `spec-compliance`
- Affected code: opaque atom metadata/capture/correlation, hierarchical LCS
  identity, package relationship closure, rebuild scaffold, focused and ILPA
  corpus tests, ECMA registry, DPT pin and capability projection
- Ref: #582, #660
