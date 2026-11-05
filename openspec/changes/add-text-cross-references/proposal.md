# Change: Text cross-references

## Why

`{% xref %}` can only show a number. Agreements also refer to a heading by
its text ("see *Purchase Price Adjustment*"). Word does this with a plain
`REF <bookmark> \h`, which has no number switch: it shows the bookmarked
text and follows the heading when it is reworded. Neither generation nor
`create` could ask for that form (#1259). Since #1273 numbers Article and
Section headings, those headings are the main targets. A text reference to
"Section 1.01 Purchase Price Adjustment" must show "Purchase Price
Adjustment", without the number.

## What Changes

- `CrossReferenceSpec` gains `show?: 'number' | 'text'` (`CROSS_REFERENCE_SHOWS`).
  The default is `'number'`, which behaves as before. `show: 'text'` emits
  ` REF <name> \h `. This is the instruction Word's Insert > Cross-reference
  writes for "Bookmark text". `number` does not apply to it. Each `show`
  value has its own instruction shape: a number switch (`\w`, `\n`) for
  `'number'`, none for `'text'`. An import can therefore restore the form
  from the instruction alone (#1260). A relative number (`\r`, #1258) is a
  new `number` value, and a page reference would be a new `show` value.
- The cached result of a text reference is a copy of each text run that the
  target's bookmark encloses, with that run's own formatting. Word writes
  the same result when it updates the field. Measured in Word 16.114
  (`scripts/oracle/word/evidence/issue-1259-word-16.114.json`), Word:
  - leaves the list label out ("Purchase Price Adjustment.", not "Section 2.01 Purchase Price Adjustment.");
  - leaves footnote reference marks out, whether they sit inside the target or at its end;
  - keeps an italic word, a highlighted fill and a bold run as they are;
  - does not carry the heading style's own formatting;
  - drops formatting set on the field itself.

  So a text reference carries no run formatting of its own. The target
  paragraph may hold text runs and footnote references only. A tab, break,
  field or nested cross-reference in it is refused, because Word's result
  for one is not measured. A blank target is refused. A text reference
  needs no number, so it may name any bookmarked body paragraph.
- Bookmark placement is unchanged: the bookmark starts after the paragraph
  properties and ends before the paragraph mark. Word measurements:
  - Text typed at the start of the paragraph, or inside it, stays inside
    the bookmark, and references follow it.
  - Word's own "Heading text" cross-reference reuses a bookmark with this
    extent instead of adding a hidden `_Ref` bookmark.
  - Text typed at the very end of the paragraph lands after the bookmark,
    and so does a word typed over the paragraph's last word.
  - Typing over the whole text deletes the bookmark. Every reference to it
    then shows "Error! Reference source not found."

  No placement inside the paragraph would catch text typed at its end.
  Ending the bookmark after the paragraph mark would put the mark into
  every text reference. Both behaviours are documented in the
  `ParagraphSpec.bookmark` doc comment and the README.
- The creation grammar adds `show="number" | "text"` on `{% xref /%}`
  (`XREF_SHOWS`). `show="text"` may name any heading or list item that
  carries an id, numbered or not. It takes neither `number` nor `format`,
  and it may not sit inside bold, italic or underline.
  The following fail with a code and a line:
  - an unknown `show` value, `number` or `format` with `show="text"`, or
    emphasis around a text reference: `INVALID_CROSS_REFERENCE`;
  - a text target that holds an xref or a line break, or has no text:
    `XREF_TEXT_TARGET_UNSUPPORTED`.
- Create verification covers the text form. The independent oracle reads
  each target's text from the source with its own walker. It writes a fill
  in its brackets, drops footnote marks and the number, and drops the
  whitespace an `{% #id %}` leaves. The round trip checks what each text
  reference shows. The cross-reference check compares the instruction (no
  switch). The read-back now records the text each bookmark encloses. The
  check requires that text to equal the target's source text, and the
  field's cached result to equal it. A new `textExtent` negative control
  shortens one bookmark by a character. `references.text` counts the text
  references. The CLI summary reads
  `cross-references ok (12 references: 4 number, 8 text; negative controls ok)`.
  The LibreOffice PDF form adds a period after a leading number only for
  full-context number references.

## Impact

- Affected specs: `docx-generation` (ADDED requirement), `docx-markdoc`
  (ADDED requirement).
- Affected code:
  - `packages/docx-core/src/generation/`: `types.ts`, `validate-spec.ts`,
    `emit/run.ts`, `emit/emit-context.ts`;
  - `packages/docx-markdoc/src/create/`: `validate.ts`, `theme.ts`,
    `lower.ts`, `oracle.ts`, `readback.ts`, `create.ts`, `cli-create.ts`.
- Compatibility: additive. Specs and sources without text references give
  the same bytes as before. The certificate's cross-reference check gains
  `references.text` and `negativeControls.textExtent` (`'not applicable'`
  without text references).
