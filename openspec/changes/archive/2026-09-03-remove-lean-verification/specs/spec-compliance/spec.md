## REMOVED Requirements

### Requirement: Relationship-selected Lean evidence keeps conformance claims bounded

**Reason**: Safe DOCX is removing Lean verification entirely.

**Migration**: Conformance claims SHALL cite maintained TypeScript structural, package, and integration evidence only.

#### Scenario: Current conformance surface has no Lean evidence

- **WHEN** conformance registries and generated reports are validated
- **THEN** no current claim SHALL depend on Lean sources, protocols, binaries, or audits
