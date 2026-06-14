## ADDED Requirements

### Requirement: Cover-terms table house style

`coverTermsTable` SHALL support optional house-style table rows and vertical
rhythm while preserving the existing full-grid label/value table when the new
options are omitted.

#### Scenario: [SDX-GEN-106] cover-terms tables support house-style rows and rhythm
- **GIVEN** a cover-terms table authored in horizontal-rules mode with a group row, a subrow, and an authored row height
- **WHEN** `coverTermsTable` builds the `TableSpec` and the document is generated
- **THEN** the produced table SHALL rule `top`, `bottom`, and `insideH` borders while emitting `left`, `right`, and `insideV` borders as `none`
- **AND** the group row SHALL span both columns, render bold text, and emit no shading
- **AND** the subrow SHALL render italic soft-ink text with an indented label cell
- **AND** body rows SHALL carry the authored minimum `w:trHeight`
- **AND** omitting the new options SHALL preserve the existing full-grid label/value behavior
- **AND** the generated package SHALL remain structurally valid and well-formed
