## ADDED Requirements
### Requirement: Save Artifacts Match Selected Format and Generation
The save implementation SHALL discriminate clean, tracked and both artifacts,
requiring every selected buffer and tracked statistics before writing outputs.
Outputs, validation, statistics, edit metadata and revision-policy reporting SHALL
describe one captured document generation. Format precedence, aliases, bookmark
policy and existing response fields SHALL remain compatible.

#### Scenario: Requested cached artifact is missing
- **GIVEN** a cache entry whose selected redline buffer or statistics are absent
- **WHEN** a tracked or both save reuses that entry
- **THEN** save fails with SAVE_ERROR before writing any output
- **AND** no successful response silently omits a requested artifact

#### Scenario: Mutation overlaps artifact generation
- **GIVEN** a save captures revision N and begins isolated serialization
- **WHEN** a mutation advances the session to N+1 before export completes
- **THEN** all returned artifacts and statistics describe N
- **AND** edit metadata and the package-change manifest describe N
- **AND** the in-flight export does not repopulate the invalidated current cache
- **AND** a subsequent save captures N+1

#### Scenario: Format compatibility and cache reuse
- **WHEN** saves select clean, tracked or both using explicit formats or aliases
- **THEN** explicit format wins over tracked path, which wins over the boolean alias
- **AND** the default remains both with the existing warning and response fields
- **AND** repeated saves at the same revision reuse byte-identical artifacts
