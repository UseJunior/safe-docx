# Changelog

## Unreleased

- **Breaking:** DOCX comparison now has one public behavior: tagged revisions
  are assembled into the revised archive and publication fails closed if its
  safety gates do not pass. `CompareOptions` no longer accepts `engine`,
  `comparisonStrategy`, `reconstructionMode`, `premergeRuns`, or
  `maxWordRefinementChangeRanges`; the library throws when JavaScript callers
  pass one of those retired keys, and the CLIs and MCP schemas no longer expose
  them.
- Migration: callers that selected `reconstructionMode: 'rebuild'` previously
  received an original-based package. Output now retains revised-side package
  provenance, including rsids, section properties, headers and footers,
  relationships, and content types. Update metadata assertions and integrations
  that assumed original-side package identities.
- CLI and MCP comparison results now report `package_base: 'revised'` instead
  of engine, strategy, mode, or fallback metadata.
- **Breaking:** library `CompareResult` now reports the sole implementation as
  `engine: 'tagged-tree'` and removes requested/used strategy, reconstruction
  mode, and fallback metadata for the deleted comparison spine. Callers should
  handle typed publication errors instead of branching on fallback fields.
- **Breaking:** `AncillaryStorySafetyError.attempts` and the exported
  `AncillaryStorySafetyAttempt` type are removed because tagged publication does
  not make reconstruction-mode attempts. Deep imports of the internal result
  type should migrate from `AtomizerCompareResult` to `TaggedCompareResult`.
- Migration note: DOCX comparison and redline generation moved from
  `@usejunior/docx-core` to `@usejunior/docx-compare`. Update comparison
  imports such as `compareDocuments` to use the new package name.

This project uses [GitHub Releases](https://github.com/UseJunior/safe-docx/releases)
as the canonical changelog. Each release is auto-categorized from PR labels.

Browse the full history:

- **GitHub Releases:** <https://github.com/UseJunior/safe-docx/releases>
- **Trust site changelog:** <https://safedocx.com/trust/changelog/>
