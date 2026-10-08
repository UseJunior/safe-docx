## ADDED Requirements

### Requirement: Document defaults and four-slot fonts

`generateDocx` SHALL accept optional document-wide run and paragraph defaults
and SHALL emit them as `w:docDefaults`, so a house font, size and paragraph
spacing are declared once and inherited by every paragraph and run. An
explicit run font SHALL be written to all four `w:rFonts` channels (`ascii`,
`hAnsi`, `eastAsia`, `cs`) wherever generation emits run properties.

#### Scenario: [SDX-GEN-110] declared document defaults set the house font, size, and spacing once
- **GIVEN** a document spec whose `defaults.run` sets `font` to one typeface and `sizePt` to 11, whose `defaults.paragraph` sets spacing after and an auto line rule, and which also sets a direct run font and a numbering-level font
- **WHEN** the document spec is compiled
- **THEN** `w:rPrDefault` SHALL carry `w:rFonts` with that typeface on `ascii`, `hAnsi`, `eastAsia` and `cs`, and `w:sz`/`w:szCs` of 22 half-points
- **AND** `w:pPrDefault` SHALL carry the declared `w:spacing`
- **AND** a body paragraph without direct formatting SHALL carry no `w:rPr` or `w:pPr`
- **AND** the direct run font and the numbering-level font SHALL each emit `w:rFonts` with exactly the four channels `ascii`, `hAnsi`, `eastAsia` and `cs`
- **AND** omitting `defaults` SHALL emit the Calibri 11pt baseline on all four channels, and a partial `defaults.run` SHALL merge over that baseline
- **AND** `word/fontTable.xml` SHALL list the declared default typeface first
- **AND** an explicitly `undefined` default font or size SHALL fall back to the baseline rather than omit it
- **AND** a style or paragraph that sets `keepNext`, `keepLines` or `pageBreakBefore` to false SHALL emit the property with `w:val="0"`, overriding a true document default, while an omitted property SHALL emit nothing and inherit
- **AND** empty typeface names, non-positive sizes and negative before/after spacing SHALL be rejected before emission
