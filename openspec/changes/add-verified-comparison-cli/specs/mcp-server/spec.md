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
