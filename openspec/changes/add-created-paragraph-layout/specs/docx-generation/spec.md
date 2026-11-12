## ADDED Requirements

### Requirement: Opt-in compatibility settings

`generateDocx` SHALL accept `DocumentSpec.compatibility`, an object of named
boolean compatibility settings, and SHALL write each setting that is true
into the `w:compat` element of `word/settings.xml`. The only setting is
`doNotExpandShiftReturn`, written as an empty `w:doNotExpandShiftReturn`
element (ECMA-376 5th edition Part 1 §17.15.3.5). Settings SHALL precede the
`compatibilityMode` custom setting, in the `CT_Compat` sequence. A false or
absent setting SHALL write nothing, so a spec without the key compiles to the
same bytes as before. An unknown setting or a non-boolean value SHALL be
refused before compilation with a `GenerationSpecError`.

#### Scenario: [SDX-GEN-135] doNotExpandShiftReturn is written into w:compat only on request
- **GIVEN** a spec with `compatibility: { doNotExpandShiftReturn: true }` and the same spec without the key
- **WHEN** both are compiled
- **THEN** the first package's `w:compat` SHALL hold `w:doNotExpandShiftReturn`, with no attributes, followed by the `compatibilityMode` `w:compatSetting`
- **AND** the second package's `w:compat` SHALL hold only the `compatibilityMode` `w:compatSetting`, and a spec with the setting false SHALL compile to the same bytes
- **AND** both packages SHALL pass the structural checks and compile byte-identically across two runs
- **AND** a spec with an unknown compatibility setting, or with `doNotExpandShiftReturn` set to a non-boolean, SHALL be refused with a `GenerationSpecError`
