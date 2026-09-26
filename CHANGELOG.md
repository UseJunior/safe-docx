# Changelog

## Unreleased

- **Client-visible (MCP):** a failed tool call now sets `isError: true` on the
  MCP `CallToolResult`, so clients and agent frameworks that branch on the
  transport flag stop treating failures as successes. The tool JSON in the text
  content is unchanged (`success: false` with the same `error.code` /
  `error.message`), and successful calls still omit `isError`. A tool that
  throws instead of returning an error now also comes back as a `CallToolResult`
  with `isError: true` and the standard envelope under code `INTERNAL_ERROR`,
  rather than as a JSON-RPC protocol error. (#1085)
- **Breaking (CLI):** a mutating `safe-docx` tool subcommand (`replace-text`,
  `insert-paragraph`, `add-comment`, `batch-edit`, `accept-changes`, ...) or
  `safe-docx edit` run without an output path no longer reports `success: true`
  for an edit it then discards. It exits non-zero with `success: false`
  (code `UNSAVED_EDITS_DISCARDED`) and a hint to pass `-o, --output <path>`,
  which these subcommands now accept to save the edited document (with an
  optional `--save-format <clean|tracked|both>`). `safe-docx edit --help` now
  prints help instead of failing. Read-only
  subcommands are unaffected. (#1048)
- DOCX comparison now marks a header or footer as a tracked deletion when the
  revised document removes the section, or the section slot, that selected it:
  every paragraph of the removed story carries a `w:del` paragraph mark and its
  runs become `w:delText`, VML/DrawingML carriers stay unwrapped, accept-all
  drops the story while reject-all restores it, and the story no longer appears
  in `unrepresentedChanges`. Lifecycle story markers (inserted and removed) now
  also cover runs inside hyperlinks, fields and table cells.
- DOCX comparison now fails closed with a typed diagnostic when an entire
  block-level content control or custom-XML container is inserted or deleted,
  instead of publishing a schema-invalid run-revision wrapper. Inline
  containers and text edits inside an aligned block control remain supported.
  (#1075, #998)
- DOCX comparison now reports generated table-row insertion/deletion counts,
  emits native row revisions for supported whole-table changes (including
  nested tables), and rejects unsupported body-table grid, cell, and
  container-topology changes with a typed diagnostic before publication.
  The comparison uses the docx-core table-occupancy reader, now exported from
  the core package root. (#1043, #998)
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
