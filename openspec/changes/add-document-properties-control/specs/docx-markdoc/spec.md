## ADDED Requirements

### Requirement: Document properties of created documents

The creation frontmatter SHALL admit `modified` (`YYYY-MM-DD` or a UTC ISO
timestamp, not earlier than `date`), `last-modified-by` (text) and
`application` (text, or `none`). `author` SHALL remain the `dc:creator`.
`modified` SHALL be written as `dcterms:modified` in place of `date`;
`last-modified-by` as `cp:lastModifiedBy`; `application` as the
`Application` element of `docProps/app.xml`, which `application: none`
SHALL leave out. Without `application`, `Application` SHALL be `safe-docx`,
and a source without the new keys SHALL build the bytes it built before.
Building SHALL stay deterministic: the same source SHALL build the same
bytes.

The build SHALL verify the properties: `checks.properties` SHALL read them
back from the DOCX and compare them with the values read straight from the
source's frontmatter (never from the lowering), with a negative control that
changes the expected `Application`. A mismatch SHALL fail the build with
`CREATION_VERIFICATION_FAILED`. The CLI summary SHALL name the document
dates and, when the frontmatter has no `date`, SHALL say that both dates are
the fixed default 2006-01-01T00:00:00Z.

#### Scenario: [SDX-MDOC-DOCPROPS-01] frontmatter chooses the modified date, last author and application
- **GIVEN** a source with `author`, `date`, a later `modified`, `last-modified-by` and `application: Acme Drafting`, and the same source with `application: none`
- **WHEN** each is created twice
- **THEN** the first DOCX SHALL carry `dc:creator`, `dcterms:created`, `dcterms:modified`, `cp:lastModifiedBy` and `Application` with those values
- **AND** the second DOCX SHALL have no `Application` element
- **AND** each source SHALL build byte-identical DOCX files on both runs

#### Scenario: [SDX-MDOC-DOCPROPS-02] the properties are read back with a negative control and the 2006 default is reported
- **GIVEN** a source without `date` or the new keys
- **WHEN** it is created through the CLI
- **THEN** `checks.properties` SHALL pass with its negative control detected, and record created and modified 2006-01-01T00:00:00Z and `Application` `safe-docx`
- **AND** the summary SHALL say that the created and modified dates are 2006-01-01T00:00:00Z because the frontmatter has no `date`
- **AND** a lowering transformed to write a different `Application` SHALL fail with `CREATION_VERIFICATION_FAILED`

#### Scenario: [SDX-MDOC-DOCPROPS-03] invalid property keys are refused
- **WHEN** the frontmatter has a `modified` that is not a date or is earlier than `date`, or an empty `application` or `last-modified-by`
- **THEN** creation SHALL fail with `UNSUPPORTED_CREATION_FRONTMATTER` before anything is written
