# Change: Paragraph layout in created documents

## Why

A document built with `docx-markdoc create` cannot give one body paragraph
its own layout (#1424). In the default justified profile there is no way to
set a single address block, notice line or caption flush left, and no way to
indent a paragraph so its wrapped lines line up: no profile key or tag writes
`w:ind`. A definitions list indented under a hanging first line, or an
address block indented half an inch, needs a literal tab, which indents the
first line only. The only switch is `"justify": false` for the whole
document.

A second defect makes the address-block case worse (#1196). In a justified
paragraph, a line that ends in a manual line break (Markdoc `\`) is stretched
to the full text width, so "Return to:" puts "to:" at the right margin and
"1 Main Street" is spread edge to edge. Word and LibreOffice both stretch it
unless the document sets `w:doNotExpandShiftReturn` (ECMA-376 Part 1
§17.15.3.5), which created documents never did.

## What Changes

- Add a block tag `{% paragraph-layout %}…{% /paragraph-layout %}` to the creation grammar. Each
  paragraph inside it is a body paragraph with direct formatting from a closed
  vocabulary:
  - `align`: `left`, `center`, `right` or `justify` (written as `w:jc` `left`,
    `center`, `right`, `both`);
  - `indent-left`: `0.25` to `2` inches in quarter-inch steps (`w:ind w:left`);
  - `indent-hanging`: the same steps (`w:ind w:hanging`), never more than
    `indent-left`, so the first line never starts in the margin.
  The tag needs at least one attribute and some text. It takes the inline
  content `{% center %}` takes, line breaks included, in its one-line or
  block form. A malformed tag fails with `INVALID_PARAGRAPH_LAYOUT`.
- Verify the layout two ways, each with negative controls:
  - the read-back compares every body paragraph's direct `w:jc` and `w:ind`
    with the lowering's projection (`checks.readback.layouts`);
  - the round trip compares each `{% paragraph-layout %}` paragraph's text and the layout
    its attributes call for, read straight from the source, with every body
    paragraph of the DOCX whose own `w:pPr` sets `w:jc` or `w:ind`
    (`checks.roundTrip.paragraphLayout`). A missing, misplaced, changed or
    extra layout fails the build.
- `pull` maps a wording edit inside a `{% paragraph-layout %}` paragraph back into the
  tag, and can delete one of its paragraphs on its own.
- Add `DocumentSpec.compatibility.doNotExpandShiftReturn` to `generateDocx`.
  When true, `w:compat` holds `w:doNotExpandShiftReturn` before the
  `compatibilityMode` setting, in the `CT_Compat` order. Specs without the key
  compile to the same bytes as before.
- Every document `create` builds sets `doNotExpandShiftReturn`, so a justified
  line that ends in `\` keeps normal word spacing in Word and LibreOffice.

## Impact

- Affected specs: `docx-markdoc` (ADDED requirements), `docx-generation`
  (ADDED requirement).
- Affected code: `packages/docx-core/src/generation/types.ts`,
  `validate-spec.ts`, `emit/settings-part.ts`;
  `packages/docx-markdoc/src/create/validate.ts`, `theme.ts`, `lower.ts`,
  `readback.ts`, `oracle.ts`, `create.ts`, `pull-source.ts`, `pull.ts` and
  `src/cli-help.ts`.
- Compatibility: additive for the grammar. Every created document's
  `word/settings.xml` gains one element, so its bytes (and the certificate's
  `docxSha256`) change once; the body is unchanged.
- Not included: #1425. A section break bound to a justified paragraph's mark
  (`breakPlacement: 'lastParagraph'`) can make Word stretch that paragraph's
  last line. See `design.md` for why neither the compatibility setting nor a
  per-paragraph alignment is a verified fix, and what a real fix needs.
