## 1. Spec

- [x] 1.1 Add the `Text cross-references in generated documents` requirement
      (`SDX-GEN-127`–`SDX-GEN-129`) to the `docx-generation` delta.
- [x] 1.2 Add the `Text cross-references in created documents` requirement
      (`SDX-MDOC-XREFTEXT-01`–`SDX-MDOC-XREFTEXT-06`) to the `docx-markdoc` delta.

## 2. Word oracle

- [x] 2.1 Record Word 16.114's after-update results, text and formatting,
      for text references to headings, clauses, plain paragraphs, a decimal
      item and a table cell, with emphasis, a fill and footnote references
      in the targets, from a generated probe and a created document.
- [x] 2.2 Record Word's own heading-text and bookmark-text cross-reference
      instructions.
- [x] 2.3 Record the bookmark and its references after typing at the start
      and end of the target, rewording inside it and typing over it.

## 3. docx-core

- [x] 3.1 `show` on `CrossReferenceSpec`, its validation and the text-target
      rules.
- [x] 3.2 The REF instruction without a number switch, and a cached result
      that copies the target's text runs.
- [x] 3.3 Document the bookmark editing behaviour on `ParagraphSpec.bookmark`.

## 4. docx-markdoc

- [x] 4.1 `show="text"` on `{% xref /%}` with coded, line-numbered errors.
- [x] 4.2 Lower, project and verify text references: oracle target texts,
      read-back bookmark text, the cross-reference check and its
      `textExtent` control, and the CLI summary.
- [x] 4.3 README: the text form and the bookmark editing behaviour.

## 5. Verify

- [x] 5.1 `openspec validate add-text-cross-references --strict` passes.
- [x] 5.2 Tests: `generation-text-cross-references.test.ts` and
      `text-cross-references.test.ts`.
- [x] 5.3 Workspace build, lint, tests, spec coverage and conformance checks
      pass.
