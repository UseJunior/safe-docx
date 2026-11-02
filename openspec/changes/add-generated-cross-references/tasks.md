## 1. Spec

- [x] 1.1 Add the `Cross-references in generated documents` requirement with
      scenarios `SDX-GEN-122`–`SDX-GEN-126` to the `docx-generation` delta.
- [x] 1.2 Add the `Cross-references in created documents` requirement with
      scenarios `SDX-MDOC-XREF-01`–`SDX-MDOC-XREF-05` to the `docx-markdoc`
      delta.

## 2. Word oracle

- [x] 2.1 Record Word 16.114's after-update result for 97 REF fields covering
      legal, decimal, letter, roman, bullet, `none`, literal-punctuation and
      `isLgl` level texts, in the body, a table cell and a footnote, with
      LibreOffice's result alongside. Also record the instructions Word's
      own Insert → Cross-reference writes, and the results after a section is
      inserted above the targets. Record letter numbers past `z` and a level
      text naming a deeper level.

## 3. docx-core

- [x] 3.1 Add `renderReferenceNumber` (full-context and paragraph forms) beside
      `renderListLevelText`.
- [x] 3.2 Add `ParagraphSpec.bookmark`, `CrossReferenceSpec`, the
      bookmark-name mapping and its validation.
- [x] 3.3 Emit bookmarks and REF fields, sharing one annotation id sequence
      with comments, and fill cached results once the body is built.
- [x] 3.4 Check bookmark pairing in the generated-package structural check.

## 4. docx-markdoc

- [x] 4.1 Admit `{% #id %}` on headings and list items and the `{% xref /%}`
      tag, with coded, line-numbered errors.
- [x] 4.2 Lower ids to bookmarks and xrefs to cross-reference inlines; project
      their numbers, read back REF results, and expect LibreOffice's form in
      the PDF checks.
- [x] 4.3 Import: admit REF fields in footnotes as their result text.

## 5. Conformance registry

- [x] 5.1 Add the § 17.13.6 and § 17.16.5.51 entries the new citations name,
      and regenerate `CONFORMANCE.md` and the conformance explorer.

## 6. Tests

- [x] 6.1 `packages/docx-core/src/generation/generation-cross-references.test.ts`
      (`SDX-GEN-122`–`SDX-GEN-126`).
- [x] 6.2 `packages/docx-markdoc/src/create/cross-references.test.ts`
      (`SDX-MDOC-XREF-01`–`SDX-MDOC-XREF-05`).

## 7. Verify

- [x] 7.1 `openspec validate add-generated-cross-references --strict` passes.
- [x] 7.2 Every recorded cached result equals Word's result after updating
      fields, and inserting a section above the targets renumbers every
      reference in Word.
- [x] 7.3 Workspace build, lint, tests, spec coverage and conformance checks
      pass.
