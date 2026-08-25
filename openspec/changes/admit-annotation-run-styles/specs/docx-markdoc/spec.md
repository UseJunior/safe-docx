## ADDED Requirements

### Requirement: Annotation run style fidelity

The annotation importer SHALL admit named character styles whose complete
`basedOn` chain resolves in the source styles part, retain the original style
identifier and direct half-point font size in the canonical annotation body,
and re-emit those values when projecting the body as either a comment or a
footnote. Missing or cyclic style chains SHALL fail closed.

#### Scenario: [SDX-MDOC-101] inherited named style survives annotation projection

- **GIVEN** an annotation body run with a named character style inherited through `basedOn` and a direct `w:sz`
- **WHEN** the annotation is imported and projected as a comment or footnote
- **THEN** the canonical run SHALL retain the style identifier and half-point size
- **AND** each output SHALL contain the corresponding `w:rStyle` and `w:sz`

#### Scenario: [SDX-MDOC-102] invalid named style chains fail closed

- **GIVEN** an annotation body run whose style is missing or whose `basedOn` chain is cyclic
- **WHEN** the annotation is imported
- **THEN** import SHALL fail with `ANNOTATION_IMPORT_UNSUPPORTED`
- **AND** the error SHALL identify whether the chain is missing or cyclic

#### Scenario: [SDX-MDOC-103] real styled footnotes reach the next unsupported boundary

- **GIVEN** a real Word document containing FootnoteTextChar, FootnoteReference, and Hyperlink run styles
- **WHEN** its annotations are imported
- **THEN** named run styles and direct font sizes SHALL NOT cause rejection
- **AND** a later unsupported hyperlink container SHALL still fail closed explicitly

