# Changelog

## Unreleased

- Experimental `mergeAware: true` row insertion/deletion now admits validated
  horizontal `w:gridSpan` tables while vertical merges and row offsets still
  fail closed. Row-marker accept/reject removes a now-empty `w:trPr`; an
  authored-empty one is normalized to absence. Default row edits now also
  reject legacy `w:hMerge` tables that were previously misread as separate
  cells; other default behavior is unchanged. (#1040)
- `DocxDocument.load` and `compareDocuments` now refuse an ISO/IEC 29500 Strict
  document (root element in `http://purl.oclc.org/ooxml/wordprocessingml/main`)
  with `UnsupportedConformanceClassError` (code `UNSUPPORTED_CONFORMANCE_CLASS`)
  instead of reading it as empty text. The MCP tools and the CLI return the same
  structured error, with a hint on re-saving as Transitional; a Transitional
  document is unaffected. Strict support remains out of scope. (#1025)
- **Breaking:** Markdoc now always emits bounded readable-whitespace revision
  grouping after token-minimal validation. Remove the short-lived
  `revision-grouping` Markdoc declaration, `--revision-grouping` CLI flag, and
  `revisionGrouping` API option; legacy values fail before comparison or
  mutation. The exported `RevisionGroupingPolicy` and
  `RevisionGroupingSource` types are removed, while certificate grouping
  evidence retains literal `policy: 'readable-whitespace'` and
  `source: 'default'` fields. The lower-level comparator keeps its internal
  token-minimal default for non-Markdoc callers.
- Selected header/footer projection checks now ignore serialization-only XML
  indentation after admitted paragraphs are removed, so real Word-authored
  running stories do not fail closed solely because their whitespace layout
  differs from the assembled comparison part.
- DOCX comparison now pairs relationship-selected header/footer stories by
  complete semantic binding closure, emits native revisions for admitted
  ordinary paragraph text (including existing table cells), preserves fields
  and structural scaffold, reserves generated revision IDs package-wide, and
  removes only represented selector aliases from `unrepresentedChanges`.
- Paragraph primitives can now bookmark, look up, replace, insert, and delete
  content in relationship-selected header/footer stories while reserving
  bookmark identities package-wide and enforcing story-local table-cell safety.
- Accept/reject, selective revision processing, validation, and revision-ID
  seeding now include relationship-selected header/footer stories while
  leaving orphan header/footer package parts untouched.
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
