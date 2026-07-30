## ADDED Requirements

### Requirement: CLI comparisons can require a passing verifier certificate

The installed Safe DOCX CLI SHALL expose an opt-in verified comparison mode.
When verification is requested, the CLI SHALL run the compiled Lean verifier
over the original, revised, and compared packages, SHALL expose the complete
public document-integrity certificate in its JSON result, and SHALL publish no
redline or certificate artifact unless the certificate status is `passed`.
Verification SHALL remain disabled when it is not explicitly requested.

#### Scenario: [CLI-VERIFY-01] Verified comparison returns a passing certificate

- **GIVEN** a supported inplace document pair and an available compiled checker
- **WHEN** the user runs `safe-docx compare` with `--verify`
- **THEN** the comparison SHALL run the compiled verifier
- **AND** the CLI JSON SHALL include its passing public certificate
- **AND** the redline SHALL be written only after that passing result exists

#### Scenario: [CLI-VERIFY-02] Certificate path implies verified comparison

- **WHEN** the user supplies `--certificate <path>`
- **THEN** verification SHALL be enabled
- **AND** the CLI SHALL atomically write the same public certificate returned in
  its JSON result

#### Scenario: [CLI-VERIFY-03] Requested verification fails closed

- **WHEN** the checker is missing, times out, returns malformed output, reports
  `failed`, `not_run`, or `not_applicable`, or the comparison falls back to an
  unsupported reconstruction mode
- **THEN** the command SHALL fail before publishing the redline or certificate
- **AND** the error SHALL identify the non-passing verification status or reason

#### Scenario: [CLI-VERIFY-04] Ordinary comparison remains unchanged

- **WHEN** neither `--verify` nor `--certificate` is supplied
- **THEN** the CLI SHALL not invoke the compiled verifier
- **AND** its existing comparison output contract SHALL remain compatible

### Requirement: Verified CLI comparisons use a ten-second assurance budget

The production verifier default timeout SHALL be 10,000 milliseconds. A focused
end-to-end gate SHALL compare and certify a committed public NVCA-derived DOCX
pair within 10 seconds, excluding checker compilation from the timed region.

#### Scenario: [CLI-VERIFY-05] Public real-document verification meets the budget

- **GIVEN** the compiled checker and committed public NVCA-derived fixture
- **WHEN** the focused verified comparison gate runs
- **THEN** the certificate SHALL pass using protocol v7
- **AND** total comparison plus certificate latency SHALL not exceed 10 seconds

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
