## ADDED Requirements
### Requirement: Refuse revision-fidelity violations before publication
Tracked mutation and comparison tools SHALL return structured fidelity failures without publishing candidate session state or writing output files.

#### Scenario: Broken edit preserves active state
- **WHEN** an edit preview fails revision fidelity
- **THEN** the active document, revision allocations and source file remain unchanged

#### Scenario: Compare refuses before writing output
- **WHEN** final comparison output fails revision fidelity
- **THEN** the tool returns structured diagnostics and writes no output
