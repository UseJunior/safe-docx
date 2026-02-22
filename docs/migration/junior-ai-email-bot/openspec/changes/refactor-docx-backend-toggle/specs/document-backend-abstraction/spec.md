## ADDED Requirements
### Requirement: Backend-Agnostic Document Operations
All .docx manipulation in workflows and services SHALL be performed through `app.shared.document_primitives` (DocumentProtocol, NodeType, adapters) and the active backend returned by `get_backend()`.

#### Scenario: Backend toggle applied without module changes
- **GIVEN** DOCUMENT_BACKEND is set to `docx`
- **WHEN** smart_edit, read, and grep are executed
- **THEN** document operations SHALL use the docx backend without direct Aspose calls in the caller modules

#### Scenario: Aspose backend remains default for full features
- **GIVEN** DOCUMENT_BACKEND is unset or set to `aspose`
- **WHEN** the same operations execute
- **THEN** the Aspose backend SHALL be used via the primitives layer

### Requirement: Aspose-Only Capabilities Are Isolated
Aspose-specific APIs (e.g., layout collector, track changes, comments) MUST be accessed via backend adapters or capability checks and SHALL NOT be called directly from workflow modules.

#### Scenario: Capability-gated layout collector
- **GIVEN** a backend that does not support layout collection
- **WHEN** a caller requests page layout information
- **THEN** the system SHALL return None or a safe fallback without raising

#### Scenario: Aspose-only operations remain available
- **GIVEN** the Aspose backend is active
- **WHEN** a caller requests a supported Aspose-only capability
- **THEN** the system SHALL execute it via the adapter without requiring raw Aspose types in the caller

### Requirement: No Direct Aspose Imports in Caller Modules
Modules outside backend implementations SHALL NOT import `aspose.words` directly.

#### Scenario: Enforcement in CI
- **WHEN** a new direct `aspose.words` import is introduced outside allowed modules
- **THEN** CI SHALL fail with a clear error message indicating the violation
