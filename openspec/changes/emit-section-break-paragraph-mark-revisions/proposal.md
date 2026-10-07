# Change: Emit section-break inserts and deletes as paragraph-mark revisions

## Why

docx-compare records a paragraph that gains or loses its `w:sectPr` as a
`w:sectPrChange` on a live `w:sectPr`. The snapshot is `CT_SectPrBase`, which
cannot carry `w:headerReference`/`w:footerReference`, so Reject All of a
removed break loses the removed section's header/footer bindings; and an
added break restored from an empty snapshot is still a live section, so
Reject All leaves one section too many (#1144). Word 16 and Aspose record the
same edits on the paragraph mark that owns the full live `w:sectPr`, and
docx-core's tracked `insertSectionBreak` already emits that shape.

## What Changes

- When an aligned paragraph gains or loses its section break, the comparison
  emits a split-mark pair instead of a `w:sectPrChange`:
  - the content paragraph keeps the revised properties and an inserted
    paragraph mark (`w:pPr/w:rPr/w:ins`), plus the revised full `w:sectPr`
    when the break was added;
  - an empty boundary paragraph after it keeps the original base properties,
    the original mark formatting and a deleted paragraph mark
    (`w:pPr/w:rPr/w:del`), plus the original full `w:sectPr`, header/footer
    references included, when the break was removed.
- A `w:pPrChange` is emitted on the content paragraph only when its base
  paragraph properties also changed; a mark-formatting change keeps its
  `w:rPrChange`.
- `w:sectPrChange` remains the representation for page-setup changes to a
  section present on both sides. Whole inserted or deleted section-bearing
  paragraphs already carry a paragraph-mark revision and are unchanged.
- `acceptedSectionBreakRemovalContainer` is unchanged and still resolves
  documents emitted by earlier versions.

## Impact

- Affected specs: `docx-comparison`
- Affected code: `packages/docx-compare/src/tagged/taggedTreeSerializer.ts`
- Not in scope: carrying header/footer references forward when Accept or
  Reject removes a section boundary whose following section is
  linked-to-previous (#1144 part B).
