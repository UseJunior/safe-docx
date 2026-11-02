# Change: Underline inline text in created documents

## Why

US agreements use underline, not bold, for three things:

- run-in headings ("Section 2.04⇥<u>Closing Deliveries and Payments</u>.",
  with the period not underlined);
- defined terms where they are defined (the "<u>Purchase Price</u>");
- operator words in formulas ("<u>less</u> the Closing Debt Amount").

`docx-markdoc create` cannot underline. Its closed grammar admits inline
`**bold**`, `*italic*`, `{% fill %}` and `{% literal %}` only, and the generic
markdocx engine renders `strong`, `em` and `field` only. An author has to use
bold instead, so the generated document does not look like a law-firm
document (#1238). docx-core runs already support `underline`.

## What Changes

- Add an inline `{% u %}…{% /u %}` tag. Its content is singly underlined
  (`w:u w:val="single"`) and nothing outside the tag is.
- The markdocx engine renders `{% u %}` itself, so every theme and consumer
  gets it without a plugin. `InlineStyle` gains `underline`, and the default
  preset and the creation theme copy it onto the runs they emit.
- The creation grammar admits `{% u %}` with no attributes. It nests with
  `**bold**`, `*italic*`, `{% fill %}`, `{% literal %}` and other `{% u %}`
  tags, and may appear wherever inline text may: headings, body, lists,
  quotes, table cells, centred text, legends and signer names.
- An empty `{% u %}` fails with `INVALID_UNDERLINE`. Inline `<u>` HTML still
  fails with `UNSUPPORTED_HTML`, and the message now names `{% u %}`.
- The round-trip oracle treats `{% u %}` as inline text. A paragraph whose
  only content is `{% u %}Defined Term{% /u %}` is a body paragraph with that
  text, not a block tag.
- Not included: a `style="double"` variant, and a theme switch that renders
  `**bold**` as underline. Both can be added later without changing this
  syntax.

## Impact

- Affected specs: `docx-markdoc` (ADDED requirement).
- Affected code: `packages/docx-markdoc/src/markdocx/engine.ts`,
  `src/markdocx/default-theme.ts`, `src/create/validate.ts`,
  `src/create/theme.ts` and `src/create/oracle.ts`.
- Compatibility: additive. Sources without `{% u %}` build the same bytes.
- Verification: the certificate still compares text only. Underline, like
  bold and italic, is not part of the read-back or round-trip projection, and
  `docx-markdoc import` does not write run formatting back as Markdoc.
