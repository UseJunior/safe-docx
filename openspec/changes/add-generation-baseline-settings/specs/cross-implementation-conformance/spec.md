## ADDED Requirements

### Requirement: Compatibility-mode generation adapter support

The SafeDocX DPT adapter SHALL implement
`composeDocumentWithCompatibilityMode` through the public `generateDocx` API.
It SHALL validate the operation's numeric `compatibilityMode` and string
`bodyText`, generate mode 15 with the requested body text, and exit 2 without
output for other well-formed requested modes rather than approximating them.
The suite self-check SHALL require every scenario within a supported operation
and document shape to pass while retaining explicit `unsupported` outcomes for
operations and revision shapes outside the adapter's implemented set. Deleted
and inserted table-row resolution SHALL remain honestly unsupported while that
core topology operation is a documented conformance gap. Passing local
scenarios SHALL NOT create a positive capability-projection row without a
measured pinned neutral result.

#### Scenario: [XIMPL-07] Compatibility mode generation validates and declines honestly
- **WHEN** the adapter receives `composeDocumentWithCompatibilityMode` with mode 15 and string body text
- **THEN** it SHALL generate through `generateDocx` and exit 0 with the requested text and compatibility setting
- **AND** malformed mode or body-text fields SHALL exit 1
- **AND** a well-formed mode other than 15 SHALL exit 2 without an output package

#### Scenario: [XIMPL-08] Supported and unsupported suite outcomes remain honest
- **GIVEN** the DPT suite pinned to commit `19f051ed645cbc8613a5967e02d7f87ef7824454`
- **WHEN** every neutral scenario runs through the SafeDocX adapter
- **THEN** every scenario within the adapter's supported operation and document shape set SHALL pass
- **AND** every scenario using any other operation or a known unsupported table-row revision shape SHALL report `unsupported`
- **AND** every scenario required by the prior pin SHALL remain required to pass
- **AND** `composeCompatibilityMode15WritesCompatSetting` SHALL explicitly pass
- **AND** the compatibility-mode projection rows SHALL remain `untested` while that scenario is unmeasured in the pinned neutral summary
