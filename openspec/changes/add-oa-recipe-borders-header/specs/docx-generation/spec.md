## ADDED Requirements

### Requirement: Cover-terms rule color and weight

`coverTermsTable` SHALL support optional color and weight for its single-style
borders (the horizontal rules, or the full grid in `grid` mode), while preserving
its current output byte-for-byte when the options are omitted.

#### Scenario: [SDX-GEN-112] cover-terms rule color and weight
- **GIVEN** a cover-terms table authored with `borderMode: 'horizontal-rules'`, a `ruleColorHex`, and a `ruleSizeEighthPt`
- **WHEN** `coverTermsTable` builds the `TableSpec` and the document is generated
- **THEN** the table's top, bottom, and inside-horizontal borders SHALL carry the authored color and weight
- **AND** the left, right, and inside-vertical borders SHALL remain `none`
- **AND** omitting both options SHALL preserve the existing borders byte-for-byte (single style, `w:sz="4"`, `w:color="auto"`)
- **AND** the generated package SHALL remain structurally valid and well-formed

### Requirement: Signature OA stacked-ruled border and header styling

The `oa-stacked-ruled` `signatureBlock` layout SHALL support an optional bold and
sized party header, an optional color and weight for the ruled signing line, and a
per-party fillable decision for the Print Name and Title values, without changing
the existing single-column and two-column layouts and preserving current
`oa-stacked-ruled` output byte-for-byte when the options are omitted.

#### Scenario: [SDX-GEN-113] signature header weight, ruled-line styling, and per-value fillable
- **GIVEN** an `oa-stacked-ruled` block authored with `headerBold`, a `headerSizePt`, a `lineColorHex`, a `lineSizeEighthPt`, block `fillable: true`, and a party whose `titleFillable` is `false`
- **WHEN** `signatureBlock` builds its blocks and the document is generated
- **THEN** each party header SHALL render bold at the authored point size
- **AND** each ruled signing line SHALL carry the authored bottom-border color and weight
- **AND** the Print Name value SHALL emit `w:highlight` and bold (block `fillable` applies)
- **AND** the Title value SHALL NOT emit a highlight (per-party `titleFillable: false` overrides the block flag)
- **AND** omitting every new option SHALL preserve the existing `oa-stacked-ruled` output byte-for-byte
- **AND** selecting `single-column` or `two-column` SHALL preserve those layouts unchanged
- **AND** the generated package SHALL remain structurally valid and well-formed
