# Changelog

## Unreleased

- `buildParagraphIndex` now also returns `fields`: each complex field in the
  paragraph with its instruction, whether it has a cached result (`separate`
  marker), and its `begin` / `end` marker nodes; and it classifies
  `w:endnoteReference` as `endnote-reference` (previously `other`). The
  `replace_text` warning for a removed result-less field or note reference
  (#1097) is now derived from that index. When a nested field sits inside the
  instruction of a result-less field, the warning's instruction text now
  includes the nested field's cached result, as Word evaluates it.

## 0.22.1

- A `.docx` whose XML parts begin with a UTF-8 byte-order mark, or with
  whitespace before the `<?xml` declaration, now opens and compares exactly
  like the same package without it. Previously `DocxDocument.load()`, the
  `read_file` / `compare_documents` tools, and `compareDocuments()` threw a raw
  xmldom `ParseError` (`processing instruction at position 1 is an xml
  declaration…`) — for example on Word ISO-Strict exports and on a cached copy
  of the NVCA Voting Agreement whose `word/_rels/document.xml.rels` starts with
  a BOM. Parts the library re-serializes are written without the BOM. A part
  that still fails to parse now raises `XmlPartParseError`, whose message and
  `partName` name the part (and, from a comparison, whether it was the
  original or revised document). (#1024)
- **Client-visible (MCP):** a failed tool call now sets `isError: true` on the
  MCP `CallToolResult`, so clients and agent frameworks that branch on the
  transport flag stop treating failures as successes. The tool JSON in the text
  content is unchanged (`success: false` with the same `error.code` /
  `error.message`), and successful calls still omit `isError`. A tool that
  throws instead of returning an error now also comes back as a `CallToolResult`
  with `isError: true` and the standard envelope under code `INTERNAL_ERROR`,
  rather than as a JSON-RPC protocol error. `grep` with a pattern that is not a
  valid regular expression now fails with `INVALID_PATTERN` (and `isError: true`)
  instead of returning `success: true` with zero matches and an `error` string.
  (#1085)
- Accepting all changes in a comparison redline no longer leaves a stray
  section break where the revised document removed a section break that had
  its own page settings. The document's final section settings are unchanged.
  (#981)
- `accept_ai_edits` / `reject_ai_edits` called with `revision_ids` that match
  no revision no longer report `persistence_required: true` or a save
  `next_step`, no longer echo the unknown ids in `selected_revision_ids` (now
  `[]`), and no longer record a selective action on the session, so a following
  `save` with `save_format: 'clean'` succeeds instead of failing with
  `SELECTIVE_REVISIONS_WOULD_BE_DISCARDED`. When only some of the requested ids
  exist, `selected_revision_ids` lists just those. A real selective
  accept/reject still blocks a clean save that would discard the remaining AI
  revisions. (#1099)
- `replace_text` now warns when the replaced range removes a construct the
  paragraph text does not show: a field with no result (for example an `XE` or
  `TC` entry), named by its instruction, or a footnote/endnote reference, named
  by its note id. One warning per construct removed, in the same style as the
  existing symbol-character warning; in tracked mode the warning says it was
  deleted as a tracked change. Fields with a cached result are not reported.
  (#1097)

## 0.22.0

Migration: in `.mdoc` revision files, rename `operation=` to `edit=` and
`operations=` to `edits=`. The old spellings now fail with `REMOVED_EDIT_ATTRIBUTE`.

- **Breaking:** docx-markdoc no longer accepts the `operation=` edit-name
  attribute or the `operations=` attribute on `change-set`, deprecated in
  0.21.2. A file that uses either now fails validation with
  `REMOVED_EDIT_ATTRIBUTE`, and the message names the replacement ("operation=
  was renamed to edit=", "operations= was renamed to edits="). To migrate,
  rename the attribute: `operation=` to `edit=`, `operations=` to `edits=`.
  `DEPRECATED_EDIT_ATTRIBUTE` and `CONFLICTING_EDIT_ATTRIBUTES` are no longer
  produced. (#1106)

## 0.21.3

- The `@usejunior/safe-docx` npm package README now covers installing, configuring
  an MCP client and the available tools, with links that resolve on npmjs.com;
  it previously shipped a stub whose repository-relative links were broken there.

## 0.21.2

0.21.0 and 0.21.1 were tagged but not published; their release preflights
failed on test timeouts. 0.21.2 is the first published release of the changes
below and of the 0.21.0 changes, including its breaking changes; upgrade notes
for both sections apply when moving from 0.20.x.

- DOCX comparison now gives a whole-paragraph move whose terminal endpoint is
  the last paragraph of a block content control that closes the body story the
  same Word-native break ownership as a body-level terminal move (#1055): the
  removed and created breaks carry ordinary `w:del`/`w:ins` paragraph-mark
  revisions on the stable predecessor, and the moved content stays in paired
  move ranges. LibreOffice Accept All and Reject All no longer leave an extra
  empty paragraph after `control([A,B,C]) -> control([C,A,B])` or
  `-> control([B,C,A])`; safe-docx's own projections remain exact, and a
  control that another block follows keeps the middle-move topology. (#1101)
- DOCX comparison no longer emits a `w:sectPrChange` whose snapshot equals
  the live section properties when two sections differ only in their header
  or footer references (a footer removed or added, a header retargeted to
  another part). The `CT_SectPrBase` snapshot never carries those references
  (#944), so the revision changed nothing and `stats.formatChanges` counted
  it. The comparison now decides on the contents the snapshot would hold. A
  reference difference that no story revision represents is still disclosed
  through `unrepresentedChanges` (a retargeted header whose new text is
  tracked inside the header story needs no entry), and a section whose page
  setup also changes still gets one `w:sectPrChange`. Aligned section
  properties are now carried whole, so `stats.modifications` no longer counts
  a paragraph whose only difference is inside its `w:sectPr` (the ILPA
  differential row drops from 496 to 491). (#1100)

- Blanking a whole paragraph with `replace_text` (`new_string: ""`) now gives
  the same document in tracked and clean modes when the paragraph carries a
  bookmark or a comment range. The tracked edit used to delete the paragraph
  mark as well, so accept-all dropped a bookmark whose whole content was
  deleted (a lost cross-reference target) or moved the comment's markers into
  the next paragraph, while the clean edit kept an empty paragraph with the
  markers. The tracked edit now keeps the paragraph mark whenever the paragraph
  still carries such markers, the rule the clean path already applied;
  accept-all then equals the clean output and reject-all the original. A
  paragraph with nothing left in it still has its mark deleted. (#1098)
- DOCX comparison no longer writes `w:ins`/`w:del` inside `w:sdtPr` when an
  aligned content control's properties differ (a changed `w:tag`, an added
  `w:alias`, a side-only `w:sdtPr`). `CT_SdtPr` admits no revision elements,
  so that output failed the ECMA-376 schema gate silently. The redline now
  carries the revised properties whole and discloses the difference as an
  `unrepresentedChanges` entry with `scope: 'contentControl'` (plus the
  control's ordinal, `w:id`, `w:tag` and `w:alias`), which the CLI and MCP
  surfaces render as a warning. Text edits inside the control are still
  tracked normally, and stats no longer count the property difference. (#1095)

- A tracked `replace_text` whose range covers a footnote or endnote reference
  that sits alone in a `w:rStyle` run (the shape Word writes) now deletes the
  reference inside the same `w:del` as the surrounding text, so reject-all
  restores the note and accept-all removes it with the text. The reference
  used to be dropped untracked. (#1094)
- `replace_text` keeps zero-length run content that sits at a range boundary
  — a result-less field's `w:fldChar`/`w:instrText` markers, a note
  reference, a drawing — outside the range when it shares a run with the
  matched text, in tracked and clean modes: a replace starting right after an
  `XE` entry, or ending right before one, leaves the entry live and in place,
  and a replacement now lands before, not after, a drawing that trailed the
  matched text in its run. A range that spans the field still deletes it.
  (#1096)
- `docx-markdoc` import now produces the same anchored source, `source sha256`
  and Markdoc every time it is given the same `.docx`. The anchored package was
  serialized with wall-clock ZIP entry times (2-second resolution), so two
  imports of one file could disagree on the hash. Every entry is now written
  with the fixed `ZIP_EPOCH` date that document generation already uses;
  `DocxZip.toBuffer()` and `DocxDocument.toBuffer()` take an optional `fileDate`
  for this, and `ZIP_EPOCH` is exported from `@usejunior/docx-core`. The hash
  still names the anchored bytes that `compile` receives, so existing
  Markdoc/anchored pairs keep compiling. (#1110)

- Comparing large documents is faster. The tagged-tree comparison rebuilt each
  element's alignment key inside its paragraph-alignment loop and re-split each
  candidate's text into words for every move-candidate pair, so both costs grew
  with the product of the two documents' lengths; each is now computed once per
  element. The move matcher also skips candidates with no eligible pairing.
  Output is unchanged. One ILPA-sized comparison drops from about 84s to 37s of
  CPU time. (#1116)

## 0.21.0

- `compileMarkdoc` no longer stamps the compile time on a source comment that
  had no `w:date` when an author, initials, anchor or thread-parent change
  forces it to be re-emitted; the output comment and its replies carry no
  `w:date`, as the source did. Dated source comments keep their date and newly
  authored comments are still dated. `DocxDocument.addComment` and
  `addCommentReply` accept `date: null` to write no `w:date`; leaving `date`
  out keeps the existing default. (#1103)

- The `docx-markdoc` CLI now reports why a `.mdoc` was rejected. When a
  command fails with a `DocxMarkdocError`, stderr prints one
  `ERROR <code>: <message> (line N)` line per validation issue (for example
  `MISSING_EDIT_NAME` or `DUPLICATE_EDIT`), or a single
  `ERROR <code>: <message>` line when the error carries no issues, matching
  the existing `WARNING: … (line N)` lines. The stack trace prints only when
  `DEBUG` is set; other exceptions still print theirs. Exit code stays 1.
  (#1107)

- Markdoc names an edit with `edit=` on `change`, `replace-source`,
  `delete-source`, `insert-before`, `insert-after`, `insert-table-rows`,
  `delete-table-row` and `annotation`, and a `change-set` lists its members
  with `edits=`; `rationale for=` and `requirement satisfied-by=` keep pointing
  at that name. The former `operation=`/`operations=` spelling still parses for
  this minor version with a non-fatal `DEPRECATED_EDIT_ATTRIBUTE` warning,
  surfaced through `parseMarkdoc(...).warnings`, `requireMarkdoc`'s new
  `onWarning` option, the certificate's `markdocWarnings` and CLI stderr;
  setting both spellings on one tag fails with `CONFLICTING_EDIT_ATTRIBUTES`.
  Import emits only `edit=`. Validation codes that named operations now name
  edits (`DUPLICATE_EDIT`, `ORPHAN_ANNOTATION_EDIT`, `MISSING_EDIT_NAME`,
  `EMPTY_REQUIREMENT_EDITS`, `DUPLICATE_REQUIREMENT_EDIT`,
  `DUPLICATE_CHANGE_SET_EDIT`, `RUN_FORMAT_REQUIRES_EDIT`,
  `RETAINED_FORMAT_REQUIRES_EDIT`). (#1104)

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
- DOCX comparison now pairs a block-level content control whose boundary
  moves (a paragraph enters or leaves it) when the control keeps the same
  properties. The moved paragraph is tracked at paragraph level inside and
  outside the control, so accept-all yields the revised document, reject-all
  yields the original, and LibreOffice keeps the control's content. The
  comparison previously refused it as a whole-control insertion and deletion.
  (#1028)
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
- **Breaking:** library `CompareResult` now reports the sole implementation as
  `engine: 'tagged-tree'` and removes requested/used strategy, reconstruction
  mode, and fallback metadata for the deleted comparison spine. Callers should
  handle typed publication errors instead of branching on fallback fields.
- **Breaking:** `AncillaryStorySafetyError.attempts` and the exported
  `AncillaryStorySafetyAttempt` type are removed because tagged publication does
  not make reconstruction-mode attempts. Deep imports of the internal result
  type should migrate from `AtomizerCompareResult` to `TaggedCompareResult`.

## 0.20.1 and earlier

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
- Migration note: DOCX comparison and redline generation moved from
  `@usejunior/docx-core` to `@usejunior/docx-compare`. Update comparison
  imports such as `compareDocuments` to use the new package name.

This project uses [GitHub Releases](https://github.com/UseJunior/safe-docx/releases)
as the canonical changelog. Each release is auto-categorized from PR labels.

Browse the full history:

- **GitHub Releases:** <https://github.com/UseJunior/safe-docx/releases>
- **Trust site changelog:** <https://safedocx.com/trust/changelog/>
