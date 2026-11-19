## ADDED Requirements
### Requirement: Portable editing and comparison entry points
The core and comparison default entry points SHALL bundle and execute without Node built-ins or Node global polyfills. Node-only oracle and filesystem helpers SHALL be available through `/node` entry points. Existing digest outputs SHALL remain byte-identical.

#### Scenario: Browser execution without polyfills
- **WHEN** a browser bundle generates, edits, saves and compares DOCX bytes
- **THEN** it completes without Buffer, process, require or Node built-ins
- **AND** accepting and rejecting the comparison recovers the corresponding text

#### Scenario: Stable digest identity
- **WHEN** text or binary content is hashed in the portable runtime
- **THEN** SHA-256 and legacy SHA-1 hex digests match the previous Node implementation byte for byte
