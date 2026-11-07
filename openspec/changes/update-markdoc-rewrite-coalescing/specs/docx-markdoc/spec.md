## ADDED Requirements

### Requirement: Dense rewrites coalesce into one deletion and one insertion

Markdoc compilation SHALL coalesce a heavily rewritten paragraph within one
operation, after token-minimal validation and readable-whitespace grouping. A
paragraph qualifies when its changed share, one minus twice the common
lexical tokens over the sum of source and revised lexical tokens, is at least
0.5. In a qualifying paragraph, an unchanged island strictly between two
change hunks SHALL be copied to both revision sides when it contains fewer than
N lexical tokens, with N defaulting to 3. Leading and trailing unchanged text,
tabs, line breaks, retained-format intervals, incompatible run formatting,
protected structure, existing revisions, and operation or paragraph boundaries
SHALL NOT be absorbed. Accept-all and reject-all projections SHALL be
unchanged, and the compilation certificate SHALL disclose each coalesced chain
and the absorbed token counts by class.

#### Scenario: [SDX-MDOC-157] Heavy rewrite reads as one deletion and one insertion
- **GIVEN** a rewrite whose changed share is at least 0.5 and whose interior unchanged islands each hold fewer than N lexical tokens
- **WHEN** it compiles
- **THEN** the paragraph SHALL contain one content-bearing deletion followed by one content-bearing insertion after any unchanged prefix
- **AND** accept-all SHALL equal the revised text and reject-all SHALL equal the source text

#### Scenario: [SDX-MDOC-158] Light edits stay granular
- **GIVEN** a rewrite whose changed share is below 0.5
- **WHEN** it compiles
- **THEN** no unchanged lexical token SHALL be copied into a revision

#### Scenario: [SDX-MDOC-159] Islands at or above the bound are kept
- **GIVEN** a qualifying paragraph with an interior unchanged island of N or more lexical tokens
- **WHEN** it compiles
- **THEN** that island SHALL remain ordinary text between separate revision groups
