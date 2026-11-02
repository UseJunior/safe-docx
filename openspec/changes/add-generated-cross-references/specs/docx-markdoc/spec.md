## ADDED Requirements

### Requirement: Cross-references in created documents

The creation grammar SHALL admit a `{% #id %}` annotation on a heading or list
item and an inline self-closing `{% xref to="id" /%}` tag with optional
`number="full" | "paragraph"` and `format="section"`. An id SHALL become a
bookmark on its paragraph. An xref SHALL become a REF field to a numbered list
item, showing the number Word shows. `docx-markdoc create` SHALL verify each
reference's number in its read-back, round-trip and PDF checks.

#### Scenario: [SDX-MDOC-XREF-01] ids and xref tags create bookmarks and REF fields with the numbers Word shows
- **GIVEN** a source with ids on a heading and on nested list items, and xrefs in both number forms, with `format="section"`, in a body paragraph, a table cell and a footnote
- **WHEN** the source is created
- **THEN** each id SHALL be a bookmark on its paragraph, named with hyphens mapped to underscores
- **AND** each xref SHALL be a ` REF <name> \w \h ` or ` REF <name> \n \h ` field whose cached result is the number Word shows (`2(a)(i)`, `(i)`, `2`)
- **AND** `format="section"` SHALL write `Section ` as literal text before the field
- **AND** the read-back SHALL read each field as its cached result and record where it sits, and the certificate SHALL pass
- **AND** a source without ids or xrefs SHALL produce no bookmark

#### Scenario: [SDX-MDOC-XREF-02] malformed ids and cross-references fail closed with a code and a line
- **GIVEN** sources with an xref to an unknown id, to a heading, to a bullet item, a duplicated id, an id that is not kebab-case, an id on a plain paragraph, an unknown `number` or `format`, an xref with content or without `to`, and an xref inside `{% fill %}` or `{% literal %}`
- **WHEN** each is created
- **THEN** creation SHALL fail before writing any output, with `XREF_UNKNOWN_ID`, `XREF_TARGET_NOT_NUMBERED`, `DUPLICATE_ID`, `INVALID_ID`, `ID_PLACEMENT` or `INVALID_CROSS_REFERENCE`, and with the source line where the error is
- **AND** the message for an unknown id SHALL name the id

#### Scenario: [SDX-MDOC-XREF-03] the round trip checks each cross-reference number against the source
- **GIVEN** a created document, and the same source built through a lowering that points a reference at the wrong item and projects that consistently
- **WHEN** each is verified
- **THEN** the first SHALL pass
- **AND** the second SHALL pass the read-back check but fail the round trip, which numbers the targets from the source

#### Scenario: [SDX-MDOC-XREF-04] the PDF checks expect the number as LibreOffice renders it
- **GIVEN** a source with full-context references to nested list items
- **WHEN** its PDF expectations are projected
- **THEN** the word check and the required-text needles SHALL expect LibreOffice's form, which keeps the period of `1.` before `(` (`2.(a)(i)`), while the DOCX checks expect Word's form (`2(a)(i)`)
- **AND** a real LibreOffice PDF of the source SHALL pass the PDF checks

#### Scenario: [SDX-MDOC-XREF-05] cross-references survive import and compile as their numbers
- **GIVEN** a created document with cross-references in the body and a footnote
- **WHEN** it is imported to Markdoc and compiled back, preserving annotations
- **THEN** each reference SHALL import as its number text, and the footnote SHALL keep its text
- **AND** a footnote holding a field other than REF, or an unbalanced field, SHALL fail closed with `ANNOTATION_IMPORT_UNSUPPORTED`
