# Change: Footnotes in generated documents

## Why

Annotated model forms, such as bar-association forms, put their drafting
guidance in footnotes, and legal memos cite authority in footnotes. A document
generated with `generateDocx` or `docx-markdoc create` cannot hold a
footnote: `InlineSpec` has no footnote kind, the generator never writes
`word/footnotes.xml`, and the creation grammar has no footnote syntax. The only
way to add one is `add_footnote` on the finished file, one note at a time and
plain text only (#1237).

## What Changes

- `InlineSpec` gains `FootnoteSpec`, `{ kind: 'footnote', blocks: ParagraphSpec[] }`.
  It is allowed in the body story, table cells included. The reference is a
  run in the `FootnoteReference` character style with superscript stated
  directly. The note body takes the same paragraph and run formatting as body
  text. Notes get ids 1, 2, 3, … in document order, which is how Word numbers
  them.
- When a document has a footnote, the generator writes `word/footnotes.xml`.
  The part holds the separator (id -1) and continuation-separator (id 0) notes,
  as Word and `add_footnote` write them, followed by one `w:footnote` per
  note. The first paragraph of each note opens with the `w:footnoteRef` mark
  and a space. A note paragraph without a `styleId` takes `FootnoteText`.
  `settings.xml` lists the two special notes in `w:footnotePr`. `styles.xml`
  adds Word's built-in `FootnoteText` and `FootnoteReference` styles unless
  the spec declares them. A document without footnotes compiles to the same
  bytes as before.
- Validation rejects a footnote in a header or footer, a footnote inside a
  footnote (§ 17.11.14), an empty footnote, a footnote block that is not a
  paragraph, and a drafting note, `pageBreakBefore` or page break inside a
  footnote. It also rejects a declared `FootnoteText` or
  `FootnoteReference` of the wrong style type.
- `add_footnote` and generation now share their OOXML shapes in
  `footnote-shapes.ts`. As a fix, `add_footnote` gives every paragraph of a
  multi-paragraph note the `FootnoteText` style; before, only the first had it.
- The creation grammar adds an inline `{% fnref id="…" /%}` reference and a
  top-level `{% footnote id="…" %}…{% /footnote %}` block. The block holds
  one line of text, or several paragraphs. The id only pairs a reference with
  its body. Notes are numbered by reference order, so a note can be moved
  without renumbering ids. Every reference needs exactly one body, and every
  body needs exactly one reference. Errors carry a code and a line.
- Create's verification covers footnotes. The read-back check compares each
  note and where its reference sits with the source projection, with a
  negative control. The round trip re-imports the notes as footnote
  annotations and compares their text, and the text around each anchor,
  with text read straight from the source. The PDF word check reads each note from the foot of the page
  (a note may continue onto the next page). It requires each note to start on
  the page that holds its reference. The text mirror lists the notes after
  the body.
- `docx-markdoc import` accepts the `w:bCs`/`w:iCs` complex-script twins that
  generation writes beside bold and italic, on text without complex-script
  characters. The complex-script test that decides this (and already decided
  it for `w:szCs`) now covers Indic and Southeast Asian scripts as well as
  Hebrew and Arabic. It also drops the single-space
  run after a note's number mark, so import then compile keeps a note's text
  unchanged.

Not included:

- `customMark` (`w:customMarkFollows`). The read side, import and compile do
  not carry a custom mark, so a symbol mark would not survive the round trip.
- Endnotes.
- The Markdown `[^1]` syntax. CommonMark and Markdoc do not define it: `[^1]: …`
  parses as a link reference definition, and a footnote plugin would change how
  existing sources parse.

## Impact

- Affected specs: `docx-generation` (ADDED requirement), `docx-markdoc`
  (ADDED requirement).
- Affected code: `packages/docx-core/src/generation/` (types, validation, run
  and footnotes-part emitters, styles and settings parts) and
  `src/primitives/footnote-shapes.ts` / `footnotes.ts`. In
  `packages/docx-markdoc/src/create/`: the validate, theme, lower, readback,
  oracle, create and cli-create modules. Also `src/import.ts`.
- Compatibility: additive. Specs and sources without footnotes produce the same
  bytes as before. In `docx-markdoc import`, footnote text that started with a
  space after the mark no longer keeps that space.
