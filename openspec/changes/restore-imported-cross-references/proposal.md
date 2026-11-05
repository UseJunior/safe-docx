# Change: Restore cross-references on import

## Why

`create` writes each `{% xref %}` as a REF field to a bookmarked paragraph.
Importing that document back to Markdoc read every REF field as its cached
text, in body paragraphs and in footnote and comment bodies, and compile
then wrote plain text where the field had been (#1260). The footnote lost
its field outright, because compile writes each footnote again. A document
round-tripped through import and compile therefore lost its live
references, and a later Word field update no longer followed a renumbered
target. `[SDX-MDOC-XREF-05]` and `[SDX-MDOC-XREFTEXT-05]` pinned that loss
("import as number text").

## What Changes

- Import restores a REF field whose bookmark marks one paragraph as an
  inline `{% xref %}…{% /xref %}` tag over the field's cached result, in
  the anchored dialect:
  - ` REF <name> \w \h ` → `{% xref to="id" %}`;
  - ` REF <name> \n \h ` → `{% xref to="id" number="paragraph" %}`;
  - ` REF <name> \r \h ` → `{% xref to="id" number="relative" %}` (#1258,
    #1278), over the cached number Word showed where the field sits;
  - ` REF <name> \h ` → `{% xref to="id" show="text" %}` (#1277);
  - a field without `\h` adds `hyperlink=false`.

  The tag names the target by `to="id"` where `bookmarkNameForSlug` maps
  the id back to the bookmark name. Otherwise it keeps the bookmark name as
  `bookmark="name"`, as for Word's hidden `_Ref…` bookmarks and for a
  shortened, hashed name. The number switches live in one table,
  `XREF_NUMBER_SWITCHES` in `packages/docx-markdoc/src/xref.ts`.
- A REF field the dialect cannot carry stays text, as before, and import
  reports it in `ImportResult.crossReferences.keptAsText` with a reason
  (and the CLI prints `warning XREF_KEPT_AS_TEXT`). The reasons are:
  - an unknown or repeated switch (`\p`, `\* MERGEFORMAT`, two number
    switches);
  - a bookmark that is missing, repeated, or marks no paragraph;
  - a nested field, an unterminated field, or a field without a result;
  - a result that is empty or holds anything but text (a tab, a tracked
    change, a drawing).

  Real Word documents (`REF _Ref… \r \h \* MERGEFORMAT`) import unchanged.
  An edit of a paragraph whose REF marker shares its run with text outside
  the field fails with `XREF_EDIT_UNSUPPORTED` (`shared-marker-run`): Word
  writes each marker in its own run, and the redline could not mark the
  shared text without splitting it.
  Compile refuses to rewrite a paragraph or note that holds such a field,
  with `XREF_SOURCE_UNSUPPORTED`, so the field is never flattened. A note
  holding one fails even unedited, since compile writes every note again.
- Compile writes each xref back as the source's field: same instruction,
  bookmark and target. An edit may change the text around a reference,
  including text typed directly before or after it, but not the reference.
  Compile fails closed with:
  - `XREF_DRIFT` when a `{% para %}` or `before` state's tags disagree with
    the source's fields (retargeted, another form, removed);
  - `XREF_EDIT_UNSUPPORTED` when an `after` state changes, adds or drops a
    reference, or formats runs beside one;
  - `XREF_TARGET_MISSING` when a note's reference names no bookmarked
    paragraph, or an edit deletes a paragraph a reference points at;
  - `XREF_PROJECTION_FAILED` when the output's REF fields do not match;
  - `INVALID_MARKDOC` with `XREF_UNSUPPORTED_LOCATION` for an xref in an
    inserted paragraph or a header or footer paragraph, and with
    `INVALID_CROSS_REFERENCE` for a malformed tag.

  Compile does not refresh the cached result. Word recomputes it when it
  updates fields.
- docx-core, additively: `FootnoteStyledRun.field` and
  `CommentBodyRun.field` (`BodyRunField`). Consecutive body runs with the
  same field are written as one complex field (`begin`, `instrText`,
  `separate`, results, `end`). Footnote and comment bodies that compile
  writes again keep their REF fields.
- docx-compare: the tagged-tree serializer keeps a row's `w:tblPrEx` ahead of
  its `w:trPr` (ECMA-376 Part 1 § 17.4.78). It emitted them the other way
  round for kept or created row properties, so every edited compile of the
  Word-saved evidence document below was schema-invalid.
- `[SDX-MDOC-XREF-05]` and `[SDX-MDOC-XREFTEXT-05]` change from "imports as
  text" to "imports as an xref tag and compiles back to the same field".
- Word oracle: `scripts/oracle/word/evidence/issue-1260-word-16.114.json`
  records Word 16.114.3 inserting a clause before a referenced one,
  updating fields, and saving. The saved copy (beside it) imports with the
  renumbered results and compiles with every field intact.

## Impact

- Affected specs: `docx-markdoc` (MODIFIED `Cross-references in created
  documents`, MODIFIED `Text cross-references in created documents`, ADDED
  `Cross-references in imported documents`).
- Archive ordering: `add-generated-cross-references` and
  `add-text-cross-references` add the two modified requirements and MUST
  archive before this delta.
- Related change: `add-relative-cross-references` (#1278) creates the
  relative form this change imports.
- Affected code: `packages/docx-markdoc/src/` (`xref.ts`, `import.ts`,
  `markdoc.ts`, `compile.ts`, `presentation.ts`, `types.ts`, `cli.ts`) and
  `packages/docx-core/src/primitives/` (`body_fields.ts`, `footnotes.ts`,
  `comments.ts`), and `packages/docx-compare/src/tagged/taggedTreeSerializer.ts`.
- Compatibility: imports of documents with restorable REF fields now hold
  `{% xref %}` tags where they held plain text, and `ImportResult` gains
  `crossReferences`. Documents without REF fields import as before.
