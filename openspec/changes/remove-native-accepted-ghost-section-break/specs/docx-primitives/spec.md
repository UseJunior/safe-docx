## ADDED Requirements

### Requirement: Native Accept Removes Tracked Paragraph Section-Break Removals

When accepting a selected `w:sectPrChange` whose paragraph-owned `w:sectPr` has no other element child and whose snapshot records at least one prior section property, the acceptance engine SHALL remove that paragraph-owned `w:sectPr`, so no ghost section break remains. It SHALL NOT remove the body-level final `w:sectPr`, a paragraph-owned `w:sectPr` with any live section-property child, or an empty paragraph-owned `w:sectPr` whose snapshot is also empty (the shape of an added default-property break). A selective accept SHALL remove only containers whose `w:sectPrChange` the filter selects. Native `acceptChanges` and docx-compare's `acceptAllChanges` SHALL apply the same rule.

#### Scenario: native accept removes a tracked paragraph section-break removal

- **GIVEN** a paragraph-owned `w:sectPr` whose only child is a `w:sectPrChange` whose snapshot holds prior section properties
- **WHEN** all changes are accepted
- **THEN** no paragraph-owned `w:sectPr` remains for that break
- **AND** the body-level final section properties are unchanged

#### Scenario: native accept keeps an added default section break

- **GIVEN** a paragraph-owned `w:sectPr` whose only child is a `w:sectPrChange` with an empty `w:sectPr` snapshot
- **WHEN** all changes are accepted
- **THEN** the paragraph-owned `w:sectPr` remains without its change record

#### Scenario: native accept preserves live and final section properties

- **GIVEN** a paragraph-owned `w:sectPr` with a live property child and a body-level `w:sectPr`, each carrying a `w:sectPrChange`
- **WHEN** all changes are accepted
- **THEN** both section-properties containers remain with their live properties

#### Scenario: selective accept leaves foreign section-break history untouched

- **GIVEN** tracked section-break removals by a target author and a foreign author
- **WHEN** only the target author's revisions are accepted
- **THEN** the target break's paragraph-owned `w:sectPr` is removed
- **AND** the foreign paragraph, including its `w:sectPrChange`, is byte-identical

#### Scenario: native accept and comparison accept agree on section-break removals

- **GIVEN** a document with a tracked section-break removal and an added default section break
- **WHEN** it is accepted by native `acceptChanges` and by docx-compare's `acceptAllChanges`
- **THEN** both projections keep the same paragraph-owned section breaks
