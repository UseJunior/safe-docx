## ADDED Requirements

### Requirement: Comparison refuses WML Strict inputs

Comparison SHALL apply the same conformance-class gate as document load to both
inputs before any Transitional-only stage reads them. A WML Strict input SHALL
throw `UnsupportedConformanceClassError` (code `UNSUPPORTED_CONFORMANCE_CLASS`)
that names the offending side; comparison SHALL NOT return a redline built from
an empty reading of a Strict document.

#### Scenario: [SDX-CONF-03] Comparison refuses a WML Strict input with the same typed error as load

- **GIVEN** a Transitional package and its Strict-namespace rewrite
- **WHEN** `compareDocuments` runs with the Strict package as the original, the revised, or both
- **THEN** each comparison SHALL reject with `UnsupportedConformanceClassError`
- **AND** the error SHALL name the conformance class and the side (`original` or `revised`) whose `word/document.xml` is Strict
