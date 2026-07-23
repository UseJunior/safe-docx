## ADDED Requirements

### Requirement: Neutral unchanged-field evidence precedes rebuild implementation

The repository SHALL pin a reviewed docx-platform-tests commit containing an
implementation-neutral scenario with a complete unchanged complex field and a
same-paragraph outside edit. The SafeDocX adapter SHALL execute that scenario
before the forced-rebuild preservation implementation is treated as complete.

#### Scenario: [XIMPL-FIELD-01] Reviewed neutral field scenario runs at the pinned commit

- **GIVEN** the reviewed docx-platform-tests field scenario and its pinned commit
- **WHEN** the scenario runs through the SafeDocX adapter
- **THEN** the result SHALL use the registry's oracle-specific pass status
- **AND** unsupported or error outcomes SHALL remain non-pass
- **AND** the scenario SHALL verify that the field remains complete and the
  outside edit is applied
- **AND** the capability projection SHALL identify this as neutral evidence, not
  proof that SafeDocX forced rebuild was used
