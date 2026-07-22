## ADDED Requirements

### Requirement: Full-Mode Highlight Color Tags

When the document view is built with `formattingMode: 'full'`, TOON highlight tags SHALL carry
the source `w:highlight` value as a `color` attribute (`<highlight color="green">`), and the
shared tokenizer grammar (`TOON_INLINE_TAG_RE`) and highlight strip helpers SHALL accept the
attributed form. Compact-mode output SHALL remain byte-identical to the value-less form,
including the merging of adjacent highlight runs whose colors differ.

#### Scenario: [HLCOLOR-01] Full mode emits the highlight value, compact mode does not
- **WHEN** a paragraph with a `green`-highlighted run is rendered with `formattingMode: 'full'` and again with the default compact mode
- **THEN** the full-mode `tagged_text` contains `<highlight color="green">…</highlight>` while compact mode contains the value-less `<highlight>…</highlight>`, and `tokenizeToonInline` yields the attributed open tag as a single `tag` token

#### Scenario: [HLCOLOR-02] Adjacent different-color highlights stay merged in compact mode
- **WHEN** two adjacent runs highlighted with different colors are rendered in compact mode
- **THEN** the emitted tags collapse to one `<highlight>…</highlight>` span exactly as before the value plumbing existed

### Requirement: Style-Chain Run Formatting Extraction

`@usejunior/docx-core` SHALL export `extractStyleRunFormatting(styles, styleId)` resolving a
style's `basedOn` chain into tri-state run formatting (`bold`/`italic` as `boolean | null`,
`fontName`/`colorHex` as `string | null`, `fontSizePt` as `number | null`) where `null` means
the chain never specifies the property, and `DocxDocument` SHALL expose `getStylesModel()`
returning the parsed styles model of the loaded document.

#### Scenario: [STYLEFMT-01] Chain resolution distinguishes unspecified from false
- **WHEN** formatting is extracted for a style chain where `Heading1` is based on a `Heading` base that sets bold and a 20pt size, and `Heading1` itself sets only a color
- **THEN** the result carries `bold: true` and `fontSizePt: 20` from the base, the color from `Heading1`, and `italic: null` because no chain member specifies italics
