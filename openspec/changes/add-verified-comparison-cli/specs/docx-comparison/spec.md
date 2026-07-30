## ADDED Requirements

### Requirement: Inert ZIP directory placeholders are accepted but never selected

The compiled verifier SHALL retain a ZIP directory placeholder in its trusted
inventory only when its safe name, attributes, stored method, zero CRC, zero
compressed and expanded sizes, matching local header, empty payload, bounds,
flags, extra fields, and non-overlap checks prove that it is inert and
unambiguous. Such entries SHALL count against archive limits but SHALL never be
eligible as selected XML parts. All other directory, symlink, and special-entry
shapes SHALL remain archive ambiguity and produce no passing certificate.

#### Scenario: [LEAN-ZIP-DIR-01] Conventional empty directory is inert

- **GIVEN** a classic single-disk DOCX containing a safe `word/` entry whose
  central and local records consistently describe an empty stored directory
- **WHEN** the compiled verifier indexes the package
- **THEN** it SHALL retain the entry for limits and span validation
- **AND** ordinary XML part selection and verification SHALL proceed

#### Scenario: [LEAN-ZIP-DIR-02] Directory cannot become a selected XML story

- **WHEN** a relationship target resolves to an accepted directory placeholder
- **THEN** selection SHALL fail closed
- **AND** the directory SHALL receive no parsed or passing XML evidence

#### Scenario: [LEAN-ZIP-DIR-03] Ambiguous or non-empty directory remains rejected

- **WHEN** a directory has inconsistent name/attributes, a nonzero CRC or size,
  a payload, compression, unsafe naming, a mismatched local header, or a special
  Unix file type
- **THEN** the executable SHALL publish no valid protocol response
- **AND** the public certificate SHALL be `not_run`
