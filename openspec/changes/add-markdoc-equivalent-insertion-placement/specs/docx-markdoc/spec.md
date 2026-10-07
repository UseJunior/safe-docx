## ADDED Requirements

### Requirement: Equivalent placement for boundary insertions

When a body-paragraph edit declares no formatting, compilation SHALL place a
pure insertion that lands on an ambiguous formatting boundary at an equivalent
offset (one producing identical text) inside a single formatting class when
such an offset exists, and SHALL still fail closed when none exists.

#### Scenario: [SDX-MDOC-155] a boundary insertion moves to an equivalent in-run offset
- **GIVEN** a paragraph with a plain run, a highlighted fill-in run and a plain run
- **WHEN** an edit inserts space-delimited words immediately before the fill-in without `format-source`
- **THEN** compilation SHALL succeed, and the inserted words SHALL inherit the plain run with no highlight
- **AND** the clean paragraph text SHALL equal the authored after text
- **AND** an insertion sharing no edge character with either neighbour SHALL still fail with `MIXED_FORMATTING_REQUIRES_DETAIL`
- **AND** an edit that names `format-source` SHALL keep the diff's exact offset and inherit the named source
