## 1. Spec

- [x] 1.1 Add the `Footnotes in generated documents` requirement with
      scenarios `SDX-GEN-118`–`SDX-GEN-121` to the `docx-generation` delta.
- [x] 1.2 Add the `Footnotes in created documents` requirement with scenarios
      `SDX-MDOC-FOOTNOTE-01`–`SDX-MDOC-FOOTNOTE-06` to the `docx-markdoc` delta.

## 2. docx-core

- [x] 2.1 Move the footnote OOXML shapes (template, reference run, mark run,
      ids, style ids) into `primitives/footnote-shapes.ts` and build
      `add_footnote` notes from them; give continuation paragraphs
      `FootnoteText`.
- [x] 2.2 Add `FootnoteSpec` to `InlineSpec`; validate story placement,
      nesting, emptiness, block kinds, page breaks, drafting notes and
      declared footnote style types.
- [x] 2.3 Emit references from `buildInlineRuns`, collect notes in document
      order, and write `word/footnotes.xml`, `w:footnotePr`, and the built-in
      footnote styles only when a footnote is used.

## 3. docx-markdoc

- [x] 3.1 Admit `{% fnref id /%}` and the top-level `{% footnote id %}` block,
      with pairing and nesting errors that carry a line.
- [x] 3.2 Lower references to `FootnoteSpec` inlines; project, read back and
      certify footnotes (read-back, round trip, PDF word check, text mirror).
- [x] 3.3 Import: admit `w:bCs`/`w:iCs` twins and drop the space run after a
      note's number mark.

## 4. Conformance registry

- [x] 4.1 Add the § 17.11 footnote entries the new citations name and
      regenerate `CONFORMANCE.md` and the conformance explorer.

## 5. Tests

- [x] 5.1 `packages/docx-core/src/generation/generation-footnotes.test.ts`
      (`SDX-GEN-118`–`SDX-GEN-121`).
- [x] 5.2 `packages/docx-markdoc/src/create/footnotes.test.ts`
      (`SDX-MDOC-FOOTNOTE-01`–`SDX-MDOC-FOOTNOTE-06`).

## 6. Verify

- [x] 6.1 `openspec validate add-generated-document-footnotes --strict` passes.
- [x] 6.2 A generated document with a multi-paragraph note and a note that
      continues onto the next page renders in LibreOffice with each note at
      the foot of its page and the right numbers.
- [ ] 6.3 The same document opens in Word for Mac without a repair prompt.
- [x] 6.4 Workspace build, lint, tests, spec coverage and conformance checks
      pass.
