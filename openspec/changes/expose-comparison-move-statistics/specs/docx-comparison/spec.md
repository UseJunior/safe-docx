## ADDED Requirements

### Requirement: Comparison statistics report detected moves

The comparison result SHALL report detected moves in `CompareStats` with `moves` (balanced source/destination move pairs whose named move ranges are both emitted), `movedParagraphs` (moves whose source is a whole paragraph), and `moveFromRanges`/`moveToRanges` (comparison-generated move revision ranges, counted from final serialized markup by the same rule as `insertedRanges`/`deletedRanges`). Moved content SHALL NOT also be counted in insertion, deletion, inserted-atom, or deleted-atom totals. Existing fields SHALL keep their meanings.

#### Scenario: A pure move is distinguishable from an unchanged document

- **GIVEN** two documents whose only difference is a detected paragraph move
- **WHEN** the documents are compared with move detection enabled
- **THEN** `moves` and `movedParagraphs` SHALL each be one and `moveFromRanges`/`moveToRanges` SHALL equal the emitted move wrappers
- **AND** every insertion, deletion, and modified-paragraph field SHALL be zero

#### Scenario: A move and an edit are reported separately

- **GIVEN** a detected paragraph move plus an insertion in another paragraph, or a paragraph split elsewhere
- **WHEN** the documents are compared
- **THEN** the move SHALL be reported in the move fields
- **AND** the edit or split SHALL be reported in the insertion and deletion fields without counting the moved content

#### Scenario: Move fields are zero without detected moves

- **GIVEN** identical documents, or a reordering compared with move detection disabled
- **WHEN** the documents are compared
- **THEN** `moves`, `movedParagraphs`, `moveFromRanges`, and `moveToRanges` SHALL be zero
