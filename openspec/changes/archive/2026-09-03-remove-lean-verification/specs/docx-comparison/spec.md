## REMOVED Requirements

### Requirement: Round-trip text preservation across track-change resolution is formally proved, with a single named residual obligation

**Reason**: Safe DOCX no longer includes or invokes Lean verification.

**Migration**: Consumers SHALL rely on the maintained TypeScript accept/reject projection and artifact verification checks.

#### Scenario: Formal verifier is absent

- **WHEN** Safe DOCX is built, packed, installed, or used
- **THEN** no Lean compiler, source, executable, option, certificate, or runtime invocation SHALL be present

### Requirement: Protocol v4 independently selects relationship-addressed stories

**Reason**: The requirement describes the removed compiled Lean protocol.

**Migration**: Relationship and story integrity SHALL remain covered by TypeScript structural and package tests.

#### Scenario: Relationship checks remain TypeScript-native

- **WHEN** relationship-selected DOCX stories are validated
- **THEN** validation SHALL execute without a Lean process or Lean protocol

### Requirement: Public certificate v1 adds honest relationship-story evidence

**Reason**: The certificate fields are coupled to the removed Lean checker.

**Migration**: Callers SHALL consume the remaining artifact and structural certificate fields.

#### Scenario: Certificate has no formal-verifier fields

- **WHEN** a comparison certificate is produced
- **THEN** it SHALL contain no Lean status, executable, protocol, or evidence fields

### Requirement: Relationship-story verification has compiled and real-DOCX evidence

**Reason**: Compiled Lean evidence is removed.

**Migration**: Real-DOCX TypeScript and renderer integration tests remain the supported evidence.

#### Scenario: Test suite has no compiled formal-verifier dependency

- **WHEN** the Safe DOCX test suite runs
- **THEN** it SHALL not build or execute Lean
