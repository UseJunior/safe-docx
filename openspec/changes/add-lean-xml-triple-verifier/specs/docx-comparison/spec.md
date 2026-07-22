## ADDED Requirements

### Requirement: Inplace comparison outputs can be checked by a compiled Lean XML-triple verifier

The system SHALL provide a compiled Lean verifier for atomizer inplace comparison outputs that reads the actual `word/document.xml` triple: original input, revised input, and combined comparison output. The verifier SHALL parse the relevant WordprocessingML token subset itself, run a Lean-defined checker over the parsed XML token streams, and return a structured result naming the plain document properties checked. The verifier SHALL NOT rely on a TypeScript mirror of the checker for its pass/fail result.

#### Scenario: [LEAN-XML-CHECK-01] Lean verifier accepts a valid inplace comparison triple

- **GIVEN** original and revised DOCX inputs whose atomizer comparison result uses `reconstructionModeUsed === 'inplace'`
- **WHEN** the compiled Lean verifier receives the original, revised, and combined `word/document.xml` strings
- **THEN** it parses the relevant XML tokens from all three inputs
- **AND** it reports pass/fail for accepting preserving field structure, rejecting preserving field structure, accepting recovering revised text, and rejecting recovering original text

#### Scenario: [LEAN-XML-CHECK-02] Lean verifier failure is not converted into a verified claim

- **GIVEN** a comparison output whose XML cannot be parsed by the Lean verifier or does not satisfy the verifier checks
- **WHEN** the comparison result is returned to TypeScript callers
- **THEN** the document-integrity certificate status is `failed` or `not_run`
- **AND** no field in the response claims the document is verified

### Requirement: Lean checker soundness is machine-checked and axiom-audited

The system SHALL prove, in Lean, that a passing checker result implies the checked document properties over the parsed XML token streams: accepting the combined output preserves valid field structure, rejecting the combined output preserves valid field structure, accepting the combined output recovers the revised text projection after normalization, and rejecting the combined output recovers the original text projection after normalization. CI SHALL audit `#print axioms` for the checker soundness theorem and fail if it depends on the existing residual-obligation axioms for `compareDocumentXml`.

#### Scenario: [LEAN-XML-CHECK-03] Checker theorem does not depend on comparison residual axioms

- **WHEN** the Lean axiom audit runs for the checker soundness theorem
- **THEN** the observed axiom set does not include `LeanSpike.compareDocumentXml`, `LeanSpike.compareDocumentXml_output_preservation_friendly`, or `LeanSpike.compareDocumentXml_output_text_roundtrip`
- **AND** the build fails if a future edit introduces any project residual axiom dependency

### Requirement: CompareResult carries a plain document-integrity certificate

The system SHALL attach a plain-English document-integrity certificate to atomizer comparison results when the Lean XML-triple verifier is configured. The certificate SHALL use property names understandable without Lean knowledge, SHALL include input XML hashes and checker version metadata for local reproducibility, and SHALL avoid exposing internal invariant IDs or Lean theorem names in the normal response. The certificate SHALL distinguish `passed`, `failed`, `not_run`, and `not_applicable`.

#### Scenario: [LEAN-XML-CERT-01] Inplace comparison reports plain checked properties

- **GIVEN** an atomizer comparison result produced in inplace mode
- **AND** the compiled Lean verifier runs and passes on the XML triple
- **WHEN** the caller reads the `CompareResult`
- **THEN** the document-integrity certificate has status `passed`
- **AND** it names the four checked properties in plain language
- **AND** it includes hashes for the original, revised, and combined `document.xml` strings
- **AND** it does not require the caller to understand Lean theorem names or internal invariant IDs

#### Scenario: [LEAN-XML-CERT-02] Rebuild comparison does not overclaim

- **GIVEN** an atomizer comparison result produced in rebuild mode
- **WHEN** the caller reads the `CompareResult`
- **THEN** the document-integrity certificate status is `not_applicable`
- **AND** the certificate explains that the Lean XML-triple verifier currently applies only to inplace comparison output

### Requirement: Checker coverage is tracked as an explicit ECMA expansion ledger

The system SHALL maintain a checker coverage ledger that records which WordprocessingML tags, attributes, namespaces, and document surfaces the Lean verifier parses, ignores, or treats as out of scope. The ledger SHALL be reviewable and drift-checked so future ECMA-376 expansion can proceed incrementally without losing the definition of done.

#### Scenario: [LEAN-XML-COVERAGE-01] Parsed and out-of-scope XML surfaces are explicit

- **WHEN** a reviewer inspects the checker coverage ledger
- **THEN** it lists the XML token classes handled by the current Lean verifier
- **AND** it lists known unchecked areas such as rebuild mode, ancillary parts, rendering, formatting fidelity, comments, bookmarks, footnotes, endnotes, and relationships
- **AND** it provides a place to add future ECMA-376 checker obligations without changing the public certificate format
