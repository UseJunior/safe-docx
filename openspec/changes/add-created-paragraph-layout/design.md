## Context

`create` renders body text in the `BodyText` style, which the default profile
justifies. Before this change no body paragraph carried direct `w:jc` or
`w:ind`, and `word/settings.xml` held only the `compatibilityMode` setting.
The `format_layout` tool (#1199) already sets alignment on existing documents,
but it records the change as a tracked `w:pPrChange`, which a new document
must not carry, and it has no indents.

## Decisions

- **One tag with a closed vocabulary, not named blocks.** `{% paragraph-layout %}` takes
  three attributes whose values come from fixed lists, as `header-align` and
  `footer-align` do. Named blocks (`{% flush %}`, `{% indent level=1 %}`)
  would each need their own grammar, oracle and `pull` entries, and would not
  combine (an indented flush-left block).
- **`paragraph-layout`, not `para`.** The issue sketched `{% para %}`, but
  the brownfield editing Markdoc that `docx-markdoc import` writes already
  uses `{% para id="…" %}` for every anchored paragraph, and `create` runs
  that import for its round trip. One tag name with two meanings in one
  package would mislead authors and agents moving between the two formats.
- **`justify`, not `both`.** The alignment words follow docx-core's
  `ParagraphSpec.alignment` and the profile's `justify` key. The OOXML value
  `both` stays inside the emitter and the oracles.
- **Indents in inches, quarter-inch steps up to 2.** Legal drafting indents in
  these steps, and a closed list keeps values that cannot be authored by
  mistake (0.3, 12) out of the document. `indent-hanging` needs an
  `indent-left` at least as large, so the first line never starts in the
  margin.
- **A `{% paragraph-layout %}` paragraph is a body paragraph.** Its block kind stays
  `body`, so the neighbour rules (keep-with-next before a legend or signer)
  treat it as body text.
- **Two layout comparisons.** The read-back compares the lowering's
  projection with the DOCX, paragraph by paragraph, as it does for text. The
  round trip reads the expected layout straight from the source tag and
  compares it with the layout each DOCX paragraph sets directly, position by
  position over the non-empty body paragraphs (empty ones are generated after
  tables and as section breaks), so a lowering that changes or moves a layout
  in both its spec and its projection still fails, even onto a paragraph with
  the same text. Comparing only the laid-out paragraphs would miss that move.
  The import IR has no paragraph formatting, so the round trip reads the
  layout from the created DOCX's `w:pPr` rather than through `import`.
- **`doNotExpandShiftReturn` for every created document (#1196).** ECMA-376
  Part 1 §17.15.3.5 defines the setting as exactly this behaviour: a line of
  a fully justified paragraph that ends in a soft line break is not
  justified. LibreOffice 26.2 honours it on import: in a repro, "to:" of
  "Return to:\" moved from x = 528 pt (the right margin) to 105 pt. It is
  written whatever the profile, because a `{% paragraph-layout align="justify" %}` can
  justify a paragraph in a ragged profile too. The alternative, giving every
  paragraph that holds a line break a non-justified alignment, would also
  leave its last full line ragged and make the read-back depend on content.

## #1425: a section break on a justified paragraph's mark

`create` binds each non-final section's `w:sectPr` to its last paragraph
(`breakPlacement: 'lastParagraph'`, #1165), so the break adds no empty
paragraph. The issue reports that Word then justifies that paragraph's last
line as if it ended in a line break. LibreOffice does not, so the build's PDF
cannot show it.

- `doNotExpandShiftReturn` is the cheap candidate, but §17.15.3.5 covers lines
  that end in a soft line break, and a section break is not one. Whether Word
  applies it to a line ended by a section mark was not verified: Word could
  not be driven in the background on the build machine, so this change makes
  no claim either way.
- Giving the paragraph a non-justified alignment would make all of its lines
  ragged, which is wrong for a justified document.
- A real fix ends such a section with its own empty paragraph
  (`breakPlacement: 'ownParagraph'`), as a section ending in a table already
  does. The read-back, round trip and `pull` already treat that paragraph as
  generated for tables. But the empty paragraph prints as a blank line at the
  foot of the section and, on a full page, spills onto a blank page: the
  regressions #1165 removed. Making it harmless needs a collapsed break
  paragraph (no spacing, a 1 pt mark) in docx-core and a Word check of the
  result, so #1425 stays open.

## Risks / Trade-offs

- Every created document's bytes change once (one element in
  `word/settings.xml`). Certificates from earlier builds carry a different
  `docxSha256`; `--replace` still recognises the previous build by its own
  certificate.
