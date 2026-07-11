## ADDED Requirements

### Requirement: Compiled verifier checks fixed WordprocessingML stories from DOCX packages

The system SHALL pass the original, revised, and compared DOCX packages to the compiled Lean verifier. The verifier process SHALL extract and independently check `word/document.xml`, `word/footnotes.xml`, and `word/endnotes.xml`, without a TypeScript implementation of its verification predicates.

#### Scenario: [LEAN-STORY-01] Fixed stories pass together
- **GIVEN** a valid inplace package triple with main, footnote, and endnote stories
- **WHEN** the compiled verifier runs
- **THEN** it returns a passing report for every supplied story

#### Scenario: [LEAN-STORY-02] Side-story state is isolated
- **GIVEN** a malformed field sequence in one optional story
- **WHEN** markers in another story would balance the aggregate counts
- **THEN** the verifier rejects the malformed story and the collection

### Requirement: Fixed story presence is fail closed

The verifier SHALL require `word/document.xml` in all three packages. It SHALL check an optional note story only when present in all three packages and SHALL fail when an optional story is present in only part of the package triple.

#### Scenario: [LEAN-STORY-03] Optional presence mismatch fails
- **WHEN** a footnote or endnote part is missing from only one package
- **THEN** the verifier returns a failed collection report identifying that story

### Requirement: Reserved note entries have an explicit proved projection

The Lean verifier SHALL exclude reserved separator and continuation-separator note entries from user-visible note text equivalence through a Lean-defined projection whose key properties are machine-checked.

#### Scenario: [LEAN-STORY-04] Reserved separator text is excluded
- **GIVEN** differing reserved separator entries and equal user note text
- **WHEN** the note story is checked
- **THEN** reserved entry differences do not cause text divergence

### Requirement: Fixed-story certificates state their boundary

The document-integrity certificate SHALL report per-story results and SHALL not imply validation of relationships, note references, comments, headers, footers, rendering, or full ECMA-376 conformance.

#### Scenario: [LEAN-STORY-05] Side-story divergence is visible
- **WHEN** accept or reject text diverges in a supplied note story
- **THEN** the certificate is failed and identifies the failed story checks
