## ADDED Requirements

### Requirement: Equivalent placement for boundary insertions

When a body-paragraph edit declares no formatting, compilation SHALL place a
pure insertion that lands on an ambiguous formatting boundary at an equivalent
offset (one producing identical text) inside a single formatting class when
such an offset exists and every such offset inherits the same formatting,
moving only across U+0020 spaces and never across a range marker, and SHALL
still fail closed otherwise.

#### Scenario: [SDX-MDOC-155] a boundary insertion moves to an equivalent in-run offset
- **GIVEN** a paragraph with a plain run, a highlighted fill-in run and a plain run
- **WHEN** an edit inserts space-delimited words immediately before the fill-in without `format-source`
- **THEN** compilation SHALL succeed, and the inserted words SHALL inherit the plain run with no highlight
- **AND** the clean paragraph text SHALL equal the authored after text
- **AND** an insertion with no adjacent space to move across, a move that would cross a bookmark or other range marker, or equivalent offsets that inherit different formats SHALL still fail with `MIXED_FORMATTING_REQUIRES_DETAIL`
- **AND** an edit that names `format-source` SHALL keep the diff's exact offset and inherit the named source
