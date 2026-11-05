## 1. Spec

- [x] 1.1 Add the `Relative cross-references in generated documents`
      requirement (`SDX-GEN-130`–`SDX-GEN-132`) to the `docx-generation` delta.
- [x] 1.2 Add the `Relative cross-references in created documents`
      requirement (`SDX-MDOC-XREFREL-01`–`SDX-MDOC-XREFREL-06`) to the
      `docx-markdoc` delta.

## 2. Word oracle

- [x] 2.1 Record Word 16.114's and LibreOffice 26.2's `\r` results from a
      different Article, the same Article and Section, a sibling clause, the
      target's own paragraph and its parent, numbered headings, plain
      paragraphs, unnumbered and numbered table cells, footnotes, and targets
      in earlier, restarted and separate lists.
- [x] 2.2 Record two created documents, and their references after a
      Section is inserted in Word.

## 3. docx-core

- [x] 3.1 `resolveReferenceNumber` relative form with a position context.
- [x] 3.2 `number: 'relative'`, the `\r` instruction, the resolver's
      position, and the footnote and start-value refusals.

## 4. docx-markdoc

- [x] 4.1 `number="relative"` on `{% xref /%}` with coded, line-numbered
      errors.
- [x] 4.2 Lowering and oracle relative numbers, the cross-reference check's
      result comparison and `relativeContext` control, and the CLI summary.
- [x] 4.3 README: the relative form.

## 5. Verify

- [x] 5.1 `openspec validate add-relative-cross-references --strict` passes.
- [x] 5.2 Tests: `generation-relative-cross-references.test.ts` and
      `relative-cross-references.test.ts`.
- [x] 5.3 Workspace build, lint, tests, spec coverage and conformance checks
      pass.
