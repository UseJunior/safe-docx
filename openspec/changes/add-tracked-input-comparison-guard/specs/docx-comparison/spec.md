## ADDED Requirements

### Requirement: Tracked-Input Comparison Refusal

The comparison boundary SHALL refuse to compare when either input document already contains tracked-changes
markup, failing closed with a typed recoverable `TrackedInputRevisionError` instead of emitting an output that
merges two authors' revision markup into one document. The error SHALL name the offending operand (`original` or
`revised`), the package part in which markup was found, and the revision element names detected. The scan SHALL
cover `word/document.xml` plus every revision story part the package holds (footnotes, endnotes, comments, the
glossary document, and each numbered header or footer part) and SHALL detect the content markers `w:ins`, `w:del`,
`w:moveFrom`, and `w:moveTo` and the property-change records `w:rPrChange`, `w:pPrChange`, `w:sectPrChange`,
`w:tblPrChange`, `w:trPrChange`, and `w:tcPrChange`, including row-level `w:trPr > w:ins|w:del` markers. The
refusal SHALL apply to every supported comparison entry point (`compareDocuments` and the directly exported
`compareDocumentsAtomizer`) and every reconstruction mode. Missing story parts SHALL be skipped, and parts the
scan cannot parse SHALL be left to the package-level ancillary safety boundary's own diagnostics rather than
claimed by this guard. The package MAY export an explicitly named unguarded engine seam
(`compareDocumentsAtomizerUnguarded`) for engine tests over deliberately pre-tracked fixtures and as the
attachment point for a future accept-on-ingest opt-in; it is documented as not a supported comparison entry
point and performs no input validation.

#### Scenario: [SDX-TRKIN-01] a tracked original operand is refused with a typed recoverable error
- **GIVEN** an original document whose body already carries a `w:del` revision and a clean revised document
- **WHEN** the documents are compared through `compareDocuments`, in either reconstruction mode
- **THEN** the comparison SHALL throw `TrackedInputRevisionError` with `operand` = `original`, `partPath` =
  `word/document.xml`, and `markers` containing `w:del`
- **AND** the message SHALL tell the caller to accept or reject the original document's tracked changes and retry

#### Scenario: [SDX-TRKIN-02] a tracked revised operand is refused naming the revised operand
- **GIVEN** a clean original and a revised document that already carries a `w:ins` revision
- **WHEN** the documents are compared
- **THEN** the error SHALL carry `operand` = `revised` and `markers` containing `w:ins`

#### Scenario: [SDX-TRKIN-03] revision markup in a revision story part is refused with the part named
- **GIVEN** a document whose only tracked markup lives in a header, footer, footnotes, endnotes, comments, or
  glossary part
- **WHEN** that document is compared as either operand
- **THEN** the comparison SHALL be refused with `partPath` naming the story part holding the markup

#### Scenario: [SDX-TRKIN-04] every content and property revision kind trips the guard
- **GIVEN** one fixture per revision kind: `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`, `w:rPrChange`,
  `w:pPrChange`, `w:sectPrChange`, `w:tblPrChange`, `w:trPrChange`, `w:tcPrChange`, and a row-level
  `w:trPr > w:del` marker
- **WHEN** each fixture is compared as each operand
- **THEN** each comparison SHALL be refused and `markers` SHALL report that revision kind

#### Scenario: [SDX-TRKIN-05] clean inputs continue to compare unchanged
- **GIVEN** two clean documents with no revision markup and no ancillary story parts
- **WHEN** the pair is compared, identical or edited
- **THEN** the comparison SHALL succeed as before, with absent story parts skipped by the scan

#### Scenario: [SDX-TRKIN-06] the directly exported atomizer entry point is guarded
- **GIVEN** a tracked input that `compareDocuments` refuses
- **WHEN** the same pair goes through the directly exported `compareDocumentsAtomizer`
- **THEN** it SHALL raise the same `TrackedInputRevisionError` with the same `operand`, `partPath`, and `markers`

#### Scenario: [SDX-TRKIN-07] malformed revision story parts defer to the ancillary safety boundary
- **GIVEN** an original whose `word/footnotes.xml` is truncated mid-element and referenced from the body
- **WHEN** the documents are compared
- **THEN** the failure SHALL be the ancillary boundary's `AncillaryStorySafetyError`, not
  `TrackedInputRevisionError`

#### Scenario: [SDX-TRKIN-08] the comparison CLI refuses tracked inputs with the operand named
- **GIVEN** a tracked revised input staged on disk
- **WHEN** the `docx-comparison` CLI runs with its real compare dependency (no injected fake)
- **THEN** the run SHALL fail with a message naming the `revised` operand and SHALL write no output file
