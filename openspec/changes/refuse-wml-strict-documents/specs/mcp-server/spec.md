## ADDED Requirements

### Requirement: WML Strict Documents Are Refused With a Typed Tool Error
Document tools SHALL surface docx-core's conformance-class refusal as a structured tool error with code `UNSUPPORTED_CONFORMANCE_CLASS`, the document-level message naming "WML Strict", and the re-save hint. Tools SHALL NOT report a generic read failure, return empty content, or leak a stack trace for such a file, and the CLI SHALL print the same structured error without a stack.

#### Scenario: [SDX-CONF-04] Document tools refuse a WML Strict file with UNSUPPORTED_CONFORMANCE_CLASS
- **GIVEN** a `.docx` whose `word/document.xml` root element is in the Strict WordprocessingML namespace
- **WHEN** `read_file`, `open_document`, `grep`, or two-file `compare_documents` is called on it
- **THEN** the response SHALL be `success: false` with `error.code` `UNSUPPORTED_CONFORMANCE_CLASS`
- **AND** `error.message` SHALL name "WML Strict" and `error.hint` SHALL say how to re-save as Transitional
- **AND** multi-file `grep` SHALL report the refusal per file with `error_code`
- **AND** no session SHALL remain open for the refused file
