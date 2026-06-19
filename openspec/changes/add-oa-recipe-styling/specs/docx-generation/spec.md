## ADDED Requirements

### Requirement: Cover-terms run styling and fillable values

`coverTermsTable` SHALL support optional run-level styling (font family, label and
value point sizes, per-row-kind colors), non-uniform cell margins, and a per-entry
fillable-value treatment, while preserving its current output byte-for-byte when
the new options are omitted.

#### Scenario: [SDX-GEN-110] cover-terms run styling and fillable values
- **GIVEN** a cover-terms table authored with `fontFamily`, `valueSizePt`, a `valueColorHex`, non-uniform `cellMarginsTwips`, and a body row whose value is marked `fillable: true`
- **WHEN** `coverTermsTable` builds the `TableSpec` and the document is generated
- **THEN** the styled cells SHALL emit the authored font family, size, and color on their runs
- **AND** the fillable value run SHALL emit `w:highlight` (default `yellow`) and bold
- **AND** the authored non-uniform `cellMarginsTwips` SHALL appear as the cell margins, with any subrow label indent added on top of the left margin
- **AND** omitting every new option SHALL preserve the existing cover-terms output byte-for-byte
- **AND** the generated package SHALL remain structurally valid and well-formed

### Requirement: Signature block OA stacked-ruled layout

`signatureBlock` SHALL support an `oa-stacked-ruled` layout in which each party
renders a centered muted-caps header over a label-column / ruled-line table with a
configurable signing row height and optional fillable pre-filled values, without
changing the existing single-column and two-column layouts.

#### Scenario: [SDX-GEN-111] signature block oa-stacked-ruled layout
- **GIVEN** two parties authored with `layout: 'oa-stacked-ruled'`, a `ruledRowHeightTwips`, and `fillable: true` pre-filled Print Names
- **WHEN** `signatureBlock` builds its blocks and the document is generated
- **THEN** each party SHALL render a centered uppercase header in the muted header color
- **AND** each selected field SHALL render as a row whose left cell is the bold field label and whose right cell is a bottom-bordered ruled line carrying the authored row height as an `atLeast` `w:trHeight`
- **AND** a fillable pre-filled Print Name SHALL emit `w:highlight` and bold on its value run
- **AND** the surrounding and inner table borders SHALL be `none` except the per-line bottom rule
- **AND** selecting `single-column` or `two-column` SHALL preserve those layouts unchanged
- **AND** the generated package SHALL remain structurally valid and well-formed
