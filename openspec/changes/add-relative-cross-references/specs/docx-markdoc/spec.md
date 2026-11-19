## ADDED Requirements

### Requirement: Relative cross-references in created documents

The creation grammar SHALL admit `number="relative"` on `{% xref /%}`. It
SHALL become a REF field with the `\r` switch, showing the target's number
relative to where the xref sits, as Word shows it. `number="relative"` SHALL
take no `format`. `docx-markdoc create` SHALL fail closed, with a code and a
line, where LibreOffice would number the field differently from Word or
Word's result is not measured, and SHALL verify each relative reference
against a number the oracle reads from the source and the xref's place.

#### Scenario: [SDX-MDOC-XREFREL-01] number="relative" cross-references show the numbers Word shows from where they sit
- **GIVEN** the two created sources recorded in the #1258 oracle evidence: one with `heading-numbers: legal` and relative references from another Article, the same Section, a sibling clause, the target itself, a heading's paragraph, a table cell, a footnote and a preface list, and one of plain ordered lists
- **WHEN** each source is created
- **THEN** the certificate SHALL pass, and each field's cached result SHALL equal the result Word showed after updating fields
- **AND** the cross-reference check SHALL count every reference as relative and detect every negative control, the relative-context control included

#### Scenario: [SDX-MDOC-XREFREL-02] relative cross-references follow a Section inserted in Word as create numbers it
- **GIVEN** Word's after-update results once a Heading 2 paragraph was inserted before a Section, and between a reference and its target's clauses
- **WHEN** the source with the same Section added is created
- **THEN** each field's cached result SHALL equal Word's result after the insertion

#### Scenario: [SDX-MDOC-XREFREL-03] relative cross-references Word and LibreOffice would number differently fail closed with a code and a line
- **GIVEN** relative references after a restarted list or another list, to a clause directly under an Article from outside that Article's clauses, with `format`, with `show="text"`, and to a bullet item
- **WHEN** each is created
- **THEN** creation SHALL fail with `XREF_RELATIVE_ACROSS_LISTS`, `XREF_FULL_NUMBER_UNDER_ARTICLE`, `INVALID_CROSS_REFERENCE` or `XREF_TARGET_NOT_NUMBERED` and the line of the reference
- **AND** relative references before every list, in a continuing list, in a footnote, or after the next heading SHALL be created

#### Scenario: [SDX-MDOC-XREFREL-04] verification checks each relative cross-reference against the number the oracle reads from where it sits
- **GIVEN** a lowering that writes a relative reference as a full-context one and projects its number consistently
- **WHEN** it is verified
- **THEN** the read-back SHALL pass but the round trip and the cross-reference check SHALL fail on the instruction
- **AND** with every relative reference showing its full number the relative-context control SHALL be not applicable

#### Scenario: [SDX-MDOC-XREFREL-05] the CLI summary counts relative cross-references and the PDF checks expect LibreOffice numbers
- **GIVEN** a source with a number, a relative and a text reference, and the plain-list source
- **WHEN** they are created and projected for LibreOffice
- **THEN** the summary SHALL read `cross-references ok (3 references: 1 number, 1 relative, 1 text; negative controls ok)`
- **AND** a relative number that keeps level 0 SHALL be expected as `2.(b)` in the PDF, and one that drops it as `(b)`

#### Scenario: [SDX-MDOC-XREFREL-06] a real LibreOffice PDF of relative cross-references passes the PDF checks
- **GIVEN** the two recorded created sources
- **WHEN** each is created with `--require-pdf`
- **THEN** the PDF render and the PDF word check SHALL pass

#### Scenario: [SDX-MDOC-XREFREL-07] relative cross-references in or after clauses directly under an Article show the numbers Word shows
- **GIVEN** `heading-numbers: legal` clauses directly under an Article, which show the Section level at its start value, holding and followed by relative references to a clause of an earlier Section, to their Article, and to those clauses themselves
- **WHEN** the source is created
- **THEN** the certificate SHALL pass, and each cached result SHALL be the number Word shows per the #1284 oracle evidence (the start-value Section level compared at its value: `(a)`, `(a)(i)` among the Article's clauses; `Section 1.01(a)` and `ARTICLE II` elsewhere)
- **AND** a relative reference to such a clause from another Article SHALL still fail with `XREF_FULL_NUMBER_UNDER_ARTICLE`, because there Word shows `ARTICLE II(a)` and LibreOffice `Section 2.01(a)`
